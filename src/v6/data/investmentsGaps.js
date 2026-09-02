import { gapSlotFactory } from './slots.js'

/**
 * Named contract gaps for Wealth → Investments (SHR-202).
 *
 * Each entry is a position the frozen Command Center prototype fills with a
 * demo value that no approved contract publishes. The screen keeps the
 * position and states the reason where the prototype put the number, so the
 * composition survives without the figure being invented in React.
 *
 * None of these is a TODO. The gap text is the product surface, and the
 * `contract` field names the issue that owns closing it.
 */
export const INVESTMENTS_GAPS = Object.freeze({
  allocation: Object.freeze({
    id: 'investment-allocation',
    contract: 'SHR-174 — current investment positions, allocation and unrealized P&L',
    reason: 'Portfolio allocation is not available yet.',
    detail: 'The prototype splits the portfolio into asset classes with a percentage each. No approved contract publishes an asset class for a holding or an allocation share for one, and dividing each position’s AED value by the published portfolio total would make the browser the author of the allocation rather than its reader. The weight column and the allocation cards therefore stay empty rather than being filled with a number this screen computed.',
  }),
  assetClass: Object.freeze({
    id: 'investment-asset-class',
    contract: 'SHR-174 — current investment positions and instrument classification',
    reason: 'Asset-class grouping is not available yet.',
    detail: 'The prototype’s Global / UAE / India / Crypto filters are a classification of each instrument. The canonical contract publishes an account type of “investment” and nothing finer, and a class read off a ticker, an account name or a currency would be a guess presented as a portfolio fact. The filters stay visible and inert rather than grouping on a string match.',
  }),
  pnlPercent: Object.freeze({
    id: 'investment-pnl-percent',
    contract: 'SHR-174 — canonical unrealized P&L presentation contract',
    reason: 'Return percentage is not available.',
    detail: 'Canonical unrealized profit is published in AED, as an amount. A percentage is a different published fact with its own denominator — cost basis, average invested capital or opening value all give different answers — and no contract states which one this screen would be showing. The amount is stated; the percentage is withheld rather than divided out here.',
  }),
  dayChange: Object.freeze({
    id: 'investment-day-change',
    contract: 'SHR-176 — historical portfolio performance and attribution',
    reason: 'Daily change is not available.',
    detail: 'A change since yesterday needs a trustworthy prior valuation for every position. No contract publishes one, and the canonical view holds only the current price and the moment it was written. Comparing today’s value against anything reconstructed from transactions, snapshots or an earlier render would state a movement the database has never recorded.',
  }),
  performanceHistory: Object.freeze({
    id: 'investment-performance-history',
    contract: 'SHR-176 — historical portfolio performance and attribution',
    reason: 'Portfolio performance history is not available yet.',
    detail: 'The prototype’s range selector and performance curve need a position and cash-flow history with an agreed return methodology. SHR-176 owns that contract and is explicitly deferred. Nothing here is reconstructed from transactions, net-worth snapshots, balance-sheet history or contribution flows, and no point is interpolated: a convincing chart drawn from those inputs would be a fabricated track record, which is worse than an empty frame.',
  }),
  returnMetrics: Object.freeze({
    id: 'investment-return-metrics',
    contract: 'SHR-176 — return methodology and golden vectors',
    reason: 'Return figures are not available.',
    detail: 'Time-weighted return, money-weighted return, CAGR, IRR, XIRR, benchmark comparison and attribution each require a stated methodology and deterministic test vectors before a number may be shown. None is published, and none is computed in the browser.',
  }),
  scope: Object.freeze({
    id: 'investment-scope',
    contract: 'SHR-156 / SHR-173 — economic-party mapping and canonical wealth scope adapter',
    reason: 'Personal and shared portfolio scopes are not available yet.',
    detail: 'This screen is whole-household truth and every holding is counted exactly once. A Me / Partner view needs published economic-party semantics. A shared holding is never duplicated into two people and never divided in half, so no scope selector is offered until those semantics exist. The composition is built for any number of parties, not two.',
  }),
  ownership: Object.freeze({
    id: 'investment-ownership',
    contract: 'SHR-154 / SHR-156 — stable account ownership reference and economic-party semantics',
    reason: 'Holding ownership is not available yet.',
    detail: 'The prototype’s Owner column states who economically owns a holding. The legacy `accounts.owner` text is documented in migration 049 as presentation only — not an identity, not unique, freely mutable — so it is discarded at this screen’s data boundary and is never rendered as an ownership claim.',
  }),
  container: Object.freeze({
    id: 'investment-container',
    contract: 'SHR-174 / SHR-172 — instrument-to-container relationships and account valuation lifecycle',
    reason: 'Brokerage and account grouping is not available yet.',
    detail: 'The canonical contract models each investment as its own valued position; it publishes no parent brokerage, custodian or wrapper, and no relationship between a cash balance and the securities held beside it. Grouping these rows under a broker inferred from an account name would invent a container hierarchy, and nesting a position inside an account that is itself a published position would risk counting the same wealth twice.',
  }),
  brokerageCash: Object.freeze({
    id: 'investment-brokerage-cash',
    contract: 'SHR-174 — investment container and cash-position semantics',
    reason: 'Uninvested cash held at a broker is not identified here.',
    detail: 'No contract marks a canonical position as settled cash awaiting deployment. The prototype shows it as an allocation slice; this screen does not, because a cash balance treated as a security position, or a security position treated as cash, would misstate the portfolio in opposite directions.',
  }),
  priceProvenance: Object.freeze({
    id: 'investment-price-provenance',
    contract: 'SHR-172 — valuation provenance reconciliation and safe lifecycle',
    reason: 'Full price provenance is not available yet.',
    detail: 'The screen reports only what the contract already publishes for a price: the value, the currency it is denominated in, the timestamp it was written, and migration 028’s recorded source where one exists. No feed, vendor, venue or entry author beyond that is published, and none is inferred from the instrument’s name, its ticker or its transaction history.',
  }),
  freshness: Object.freeze({
    id: 'investment-freshness-judgement',
    contract: 'SHR-172 / SHR-173 — valuation lifecycle and canonical freshness semantics',
    reason: 'A live, delayed or stale price judgement is not available yet.',
    detail: 'Exact contract timestamps and the canonical freshness category are shown as published. No browser-side threshold turns a timestamp into “live”, “today”, “delayed” or “stale”: the canonical function accepts a staleness boundary as a caller policy and this consumer supplies none, because inventing one here would publish a policy the household never agreed.',
  }),
  maintenance: Object.freeze({
    id: 'investment-maintenance',
    contract: 'SHR-172 / SHR-174 — valuation lifecycle and investment position maintenance',
    reason: 'Portfolio maintenance is not available here.',
    detail: 'Adding a holding, editing a quantity or cost basis, recording a trade and refreshing prices all change wealth truth permanently and flow into every published balance sheet and snapshot. No approved contract states how such a write records its provenance or who may perform it, so the prototype’s controls stay visible and inert rather than being wired to a legacy writer.',
  }),
  access: Object.freeze({
    id: 'investment-access',
    contract: 'SHR-202 — Investments reads the household’s canonical investment set',
    reason: 'This holding is not available.',
    detail: 'The requested holding is not in the canonical investment set this household can read. Nothing is shown for it: an identifier in a link is not evidence that a position exists or that it may be disclosed.',
  }),
})

export const investmentsGapSlot = gapSlotFactory(INVESTMENTS_GAPS, 'Investments')
