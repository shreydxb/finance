# Wealth → Net Worth — screen-specific contract gaps (SHR-177)

The fresh V6 Net Worth screen preserves the frozen Command Center prototype's
current total, assets, liabilities, composition, scope, change, history,
quality and provenance positions. It fills only facts directly supported by
approved canonical reads. Missing semantics remain visible as unavailable and
name the issue that owns the future contract.

## Canonical values connected

Current truth and historical truth are deliberately separate reads:

| Screen position | Canonical source and exact meaning |
|---|---|
| Current net worth | `canonical_balance_sheet.net_worth_aed` for `scope = household` |
| Current assets | `canonical_balance_sheet.assets_aed` for the same household result |
| Current liabilities | `canonical_balance_sheet.liabilities_aed` for the same household result |
| Current quality evidence | `quality_status`, incomplete/provisional/missing-FX counts, and the exact `quality_metadata.fx_updated_at` timestamp from `canonical_balance_sheet` |
| Current position rows | `v_canonical_accounts_aed` account name, canonical classification, currency, `canonical_value_aed`, quality, valuation method and exact valuation/FX timestamps |
| Published history | Exact `nw_daily` rows, including their date, assets, liabilities, total, quality, run identity, timestamps, source version and quality evidence |
| Preserved legacy history | Exact pre-SHR-113 `nw_daily` rows identified by null `run_id`, labelled `Legacy` because authoritative provenance is unavailable |
| Skipped publication | Actual `nw_snapshot_runs` rows whose terminal status is `skipped_incomplete`, shown without any monetary point |

The current balance sheet is never substituted for a historical point. The
history reader returns only dates recorded by `nw_daily` or an actual terminal
`skipped_incomplete` run. It creates no calendar rows, interpolation,
extrapolation, previous-value copy, zero fallback or screen-open snapshot.

## Deliberately withheld

| Prototype position | Smallest missing canonical truth | Owner |
|---|---|---|
| Period AED/percentage change, growth, direction or trend | A published comparison value with anchor date, range, missing-observation policy and quality semantics | SHR-173 / SHR-153 |
| Wealth composition percentages | Canonical scope-aware classification totals and approved percentage fields | SHR-173 |
| Personal/shared or per-person positions | Stable economic-party identity, account-party mapping, and shared-allocation semantics | SHR-156 / SHR-173, founded on SHR-154 |
| Saved during a historical period | A published flow attribution whose meaning is distinct from snapshot differences | SHR-173 / SHR-153 |
| Full valuation provenance | Published provider/source identity and approved valuation freshness semantics | SHR-172 / SHR-173 |
| Fresh/stale or combined freshness judgement | A contract-published freshness status or threshold policy | SHR-173 |

No two snapshot values are subtracted in the browser. No percentage, CAGR,
average, forecast or trend is calculated. Account rows are not regrouped into
a browser wealth engine.

## Ownership and household scope

The current canonical balance-sheet result is whole-household truth and is
counted once. Account `owner` display text is deliberately discarded before
the V6 position model. It is never treated as economic ownership, copied into
a person position, used to duplicate shared wealth or used to divide a shared
position 50/50. SHR-154's stable identity foundation does not itself publish
the allocation semantics required by this screen; SHR-156 / SHR-173 remain the
owners of that unavailable position.

## Valuation, quality and freshness

Account rows display only the valuation method and timestamps already
published by `v_canonical_accounts_aed`. Ledger history is not read and cannot
become valuation provenance. A provider, basis or freshness interpretation is
not inferred. The exact FX timestamp is evidence, not a browser-authored stale
threshold.

`Complete`, `Provisional`, `Legacy` and `Skipped — incomplete` remain distinct
text labels as well as visual styles. Provisional is a quality fact, not an
error, anomaly or attention claim, and it is never promoted to Complete. A
skipped publication carries no monetary values and missing snapshot data never
becomes zero.

## Drawing-only geometry

The history drawing scales and positions exact published values only:

- horizontal point position uses the exact recorded snapshot/run date;
- asset and liability bar height uses the exact published values;
- net-worth point position uses the exact published total; and
- an actual skipped run receives a gap mark rather than a financial point.

The drawing exposes no financial number or trend and is `aria-hidden`. Its
accessible table lists every exact observation and status. No line connects
points, so missing intervals do not visually imply observations.

## Structural and side-effect boundary

The screen composition may call only `getBalanceSheet`, `listAccounts` and
`listNetWorthHistory`. The first two are current canonical reads; the third is
the read-only SHR-113 history adapter. Tests reject transaction reconstruction,
raw-reader imports, owner allocation, unsupported comparisons, legacy
presentation and financial writers.

Opening `/wealth/net-worth` performs no snapshot creation, refresh, mutation,
account write or valuation write. Prototype fixtures exist only in the
deterministic preview entry point and are never an application fallback.
