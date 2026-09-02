# Wealth → Investments — screen-specific contract gaps (SHR-202)

The fresh V6 Investments screen preserves the frozen Command Center
prototype's portfolio hero, its asset-class filters, its allocation cards, its
performance range selector and curve, its Holding / Owner / Units / Price /
Value / Change / Weight table and its holding drill-in. It fills only facts
directly supported by approved canonical reads. Every other prototype position
stays visible as an honest unavailable state naming the issue that owns the
future contract.

The screen makes exactly two reads — `canonical_investment_metrics` and
`v_canonical_accounts_aed` filtered to `type = 'investment'` — and no ledger
read at all. That is structural, not conventional: there are no posted rows in
scope for a valuation, a cost basis or a performance history to be
reconstructed from, and `v6-boundary.test.js` fails the build if one appears.

## What SHR-174 has and has not delivered

**SHR-174 is in Backlog and has delivered nothing.** Every fact this screen
shows therefore comes from the pre-existing SHR-111 Phase A contract
(`041_canonical_financial_metrics_phase_a.sql`, applied) plus migration 028's
price provenance columns. That contract turns out to publish considerably more
per-position truth than the Overview ever consumed — including cost basis and
unrealized profit, computed in Postgres — which is why those positions are
filled here rather than withheld.

What it does **not** publish is any classification or share: no asset class, no
allocation percentage, no return percentage, no price movement, no parent
brokerage container. Those are the SHR-174 gaps below, and they are the reason
the prototype's allocation cards and Weight column are empty.

No new SQL, view, function or migration was written for this issue. The only
backend change is a consumer adaptation over columns the approved view already
publishes: a `listCanonicalInvestmentPositions()` reader and a
`normalizeCanonicalInvestmentPositionRows()` normalizer, following exactly the
additive, optional pattern SHR-155 used for `name` and SHR-180 used for
`canonical_value_native` and `freshness_status`.

## Canonical values connected

| Screen position | Canonical source and exact meaning |
|---|---|
| Portfolio value | `canonical_investment_metrics.investment_value_aed` at `scope = household` |
| Portfolio cost basis | `canonical_investment_metrics.cost_basis_aed` |
| Portfolio unrealized profit | `canonical_investment_metrics.unrealized_pnl_aed` — the contract's own published amount |
| Holding name, ticker, currency | `v_canonical_accounts_aed` `name`, `ticker`, `currency` |
| Units | `v_canonical_accounts_aed.quantity` |
| Price | `v_canonical_accounts_aed.last_price`, rendered beside its own `currency` |
| Price written at | `v_canonical_accounts_aed.price_updated_at`, as an exact Asia/Dubai wall-clock timestamp |
| Recorded price source | `v_canonical_accounts_aed.price_source` (migration 028) — shown verbatim; null means entered by hand |
| Native value | `v_canonical_accounts_aed.canonical_value_native`, beside its own `currency` |
| Value AED | `v_canonical_accounts_aed.canonical_value_aed` |
| Per-holding cost basis | `v_canonical_accounts_aed.cost_basis_aed` |
| Per-holding unrealized profit | `v_canonical_accounts_aed.unrealized_pnl_aed` |
| Valuation method | `v_canonical_accounts_aed.valuation_method` |
| Valued as of | `v_canonical_accounts_aed.valuation_as_of` |
| Valuation timestamp basis | `v_canonical_accounts_aed.freshness_status` — the view's own category for *where* the timestamp comes from, not a verdict on how current it is |
| Per-holding quality | `v_canonical_accounts_aed.quality_status` and the separate `pnl_quality_status` |
| Published FX evidence | `v_canonical_accounts_aed.fx_rate_to_aed` and `fx_updated_at` |
| Portfolio quality evidence | `canonical_investment_metrics` `quality_status`, incomplete-value / incomplete-P&L / provisional / manual / missing-FX counts, `quality_metadata.fx_basis`, `fx_updated_at`, `oldest_valuation_at`, `newest_valuation_at`, `missing_fx_currencies` |
| Holding count, currency count | Counts of canonical rows and of the distinct canonical `currency` codes on them |

## The screen is not a valuation engine

`quantity`, `last_price` and `fx_rate_to_aed` are all published, and their
product is the AED value. The screen shows all three and multiplies none of
them. They are rendered as **evidence** about how the canonical valuation was
reached, so a reader can check the published figure against its inputs; the
figure itself arrives finished from Postgres.

`v6-boundary.test.js` and the UI suite both fail the build on any
quantity × price product, any FX multiplication or division, and any use of
`valuation_age_seconds`.

## The portfolio total is not a sum

Every portfolio figure comes from `canonical_investment_metrics`, which
aggregates over exactly the position set the table lists and counts a shared
holding once. None is a sum of the rows.

This matters most in the incomplete case, which is covered by a dedicated test:
when one position's inputs are incomplete the contract withholds **every**
monetary total while the other positions still publish AED values and still
render. A browser-side sum would have every operand it needed and would produce
a confident, plausible, quietly-too-low portfolio figure. The total stays
withheld instead.

## Unrealized profit is read, never derived

The published portfolio value and cost basis sit next to each other, so
`value − costBasis` is available to any component willing to compute it. It is
never computed. A locally derived figure would agree with the contract most of
the time and diverge silently exactly when the contract's own quality rules
said it should — the `pnl-withheld` fixture and its tests pin this case, where
both operands are present and the answer must still be withheld.

Per holding the same rule applies, gated by the contract's *separate*
`pnl_quality_status`: cost basis and profit are withheld **together**, because
publishing one without the other invites the subtraction.

Cost basis is never reconstructed from transaction history. There is no FIFO,
no LIFO, no lot matching, no weighted-average pass and no
contributions-minus-withdrawals approximation, and the ledger is not read on
this screen at all.

## Native value versus AED value

They are two separately published facts about the same holding, not two
renderings of one. The screen states both and derives neither. A holding whose
contract published a native value and no AED value — a currency
`settings.fx_rates` carries no rate for — renders the native figure and an
explicit *"No published FX rate for &lt;CCY&gt;, so the canonical contract
states no AED value. It is not converted here."*

The normalizer additionally refuses any row carrying an AED value, cost basis
or profit without published FX evidence, so the pairing cannot be broken
upstream either.

## Deliberately withheld

| Prototype position | Withheld because | Owning contract |
|---|---|---|
| Allocation cards, share percentages, Weight column | No contract publishes an asset class or an allocation share. Dividing each position's AED value by the published total would make the browser the author of the allocation — over a numerator and denominator whose quality rules differ, silently excluding every withheld holding, and summing to something other than 100% without saying so | SHR-174 |
| Asset-class filters (Global / UAE / India / Crypto) | The contract publishes an account type of `investment` and nothing finer. A class read off a ticker, a name or a currency would be a guess presented as a portfolio fact | SHR-174 |
| Return / gain percentage | Canonical unrealized profit is published as an AED amount. A percentage needs a stated denominator — cost basis, average invested capital or opening value all give different answers — and no contract names one | SHR-174 |
| Day change and "+1,840 today" | A change since yesterday needs a trustworthy prior valuation per position. The view holds only the current price and the moment it was written | SHR-176 |
| Performance range selector and curve | Needs position and cash-flow history with an agreed return methodology and golden vectors. SHR-176 is explicitly deferred. Nothing is reconstructed from transactions, net-worth snapshots, balance-sheet history or contribution flows, and no point is interpolated | SHR-176 |
| CAGR, IRR, XIRR, TWR, money-weighted return, benchmark, alpha, attribution | Same contract, same reason | SHR-176 |
| Owner column | `accounts.owner` is documented in migration 049 as presentation only — not an identity, not unique, freely mutable. It is discarded at the data boundary and never reaches a component | SHR-154 / SHR-156 |
| Personal / shared portfolio scope | Whole-household truth, each holding counted once. A Me/Partner view needs published economic-party semantics. A shared holding is never duplicated and never halved. The composition is N-party capable, not two-party | SHR-156 / SHR-173 |
| Brokerage / custodian grouping | The contract models each investment as its own valued position and publishes no parent container. Grouping under a broker inferred from a name would invent a hierarchy, and nesting a position inside an account that is itself a published position risks double counting | SHR-174 / SHR-172 |
| Uninvested brokerage cash as an allocation slice | No contract marks a canonical position as settled cash. Treating a cash balance as a security position, or the reverse, misstates the portfolio in opposite directions | SHR-174 |
| "Prices just now", "FX 6 days old", live / delayed / stale | A freshness verdict is a policy. `canonical_investment_metrics` accepts a staleness boundary as a *caller* input and this consumer supplies none, so inventing a threshold here would publish a policy the household never agreed. Exact timestamps and the published freshness category are shown instead | SHR-172 / SHR-173 |
| Price feed, vendor or venue | Only migration 028's recorded `price_source` is published. Nothing is inferred from an instrument name, a ticker or transaction history | SHR-172 |
| Refresh prices, + Holding, edit quantity / price, record trade | Each changes wealth truth permanently and flows into every published balance sheet, portfolio total and snapshot. No approved contract states how such a write records its provenance or who may perform it | SHR-172 / SHR-174 |

## The staleness counter

`canonical_investment_metrics.stale_value_count` counts positions older than a
boundary the caller passes. This consumer passes `null`, so the count is zero
**by construction**. Reporting that zero as "nothing is stale" would turn the
absence of a policy into a clean bill of health, so the screen renders it as
*"None applied"* with an explicit note.

## Not an advice engine

No overweight/underweight verdict, no rebalancing suggestion, no concentration
or risk score, no performer ranking. Quality evidence is presented as evidence:
provisional is stated as a quality fact, not an error, a warning severity or an
anomaly. Gains and losses carry a text label as well as a sign, so nothing is
communicated by colour alone.

## Read-only

Opening the screen performs two selects and no write of any kind: no snapshot,
no valuation stamp, no price fetch, no third-party market-data call. Every
prototype write control is rendered visible and inert with its owning contract
named beside it.
