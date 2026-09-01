# Overview — screen-specific contract gaps (SHR-155)

The fresh V6 Overview is built from the frozen Command Center prototype. The
prototype fills every slot with demo data; the implementation fills a slot only
when an approved canonical contract can supply it truthfully. This file records
what is connected, what is deliberately withheld, and which issue closes each
gap. `src/v6/data/gaps.js` is the machine-readable version of the second table
and is what the screen actually renders.

## Canonical values connected

| Overview slot | Canonical source |
|---|---|
| Net worth, assets, liabilities | `canonical_balance_sheet` |
| Investments value | `canonical_investment_metrics.investment_value_aed` |
| Income, spend, saved, savings rate | `canonical_period_metrics` for the selected period-to-date range |
| Cash-flow columns and savings-rate series | one `canonical_period_metrics` read per completed calendar month |
| Top spend by category | `canonical_budget_actuals`, shown only when the category actuals reconcile to `canonical_period_metrics.consumption_spend_aed` at two-decimal precision |
| Recent activity | `v_canonical_ledger_aed` |
| Account summary | `v_canonical_accounts_aed` (with the additive `name` column) |
| Data quality and freshness | each contract's own `quality_status`, `quality_metadata.fx_updated_at`, and account `valuation_as_of` |
| Data-health evidence (inside Data quality and freshness, **not** inside Needs attention) | `needs_review_count`, `zero_placeholder_count`, `missing_fx_count`, the three `*_incomplete_count` fields, `provisional_account_count`, `incomplete_account_count`, `stale_value_count`, `incomplete_value_count`, listed verbatim with the field each came from |

## Deliberately withheld, with the contract that would supply it

| Overview slot | Why it is withheld | Closing issue |
|---|---|---|
| Runway | No contract defines the household runway calculation. A months-of-cover figure computed in the browser would be a fabricated metric. | SHR-153 |
| Change this period / 12-month change | A change figure needs an approved comparison contract stating its anchor date and how snapshot gaps and quality are handled. Subtracting two stored `nw_daily` rows in React is not that contract. | SHR-153 |
| Equity share (per-person) | Whole-household truth is counted once. A personal share needs stable economic-party facts. The prototype's half-shared allocation is quarantined exception 1 and is never implemented. | SHR-156 / SHR-195 |
| Daily investment change | Requires trustworthy position and cash-flow history. Prototype investment history is quarantined exception 2. | SHR-176 |
| Budget left | Canonical actuals exist, but no versioned plan contract supplies the period's planned amounts. | SHR-166 |
| Next 30 days (upcoming obligations) | The legacy recurring schedule is not a canonical contract; projecting bills and expected income from it would present a non-canonical calculation as household truth. | SHR-171 |
| Needs attention (the whole surface) | No registry defines which conditions raise attention, who produces them, how they rank, or how they resolve. The section renders its gap and nothing else. | SHR-192 |
| Integration / sync status | Deployment or configuration alone is not evidence that an integration is healthy. Quarantined exception 6. | SHR-190 |

## Deliberate deviations from the prototype

* **Touch targets.** The prototype's controls use ~7px vertical padding. Every
  V6 control carries `min-height: 44px`, as `ACCESSIBILITY.md` requires. The
  prototype's own control size is explicitly not a compliant token.
* **Hero wrapping.** The prototype sets `white-space: nowrap` on the hero
  figure. The implementation allows wrapping so the value cannot clip at 320px
  or 200% zoom, as `MOBILE_PARITY.md` requires.
* **Semantic controls.** The prototype's clickable `div`s are real `button` and
  `a` elements with `aria-pressed` / `aria-current`, and the active segment
  carries an accent rule so selection is never colour-only.
* **Category share.** The prototype prints "31% of spend" per category. No
  contract publishes a share, so the bar carries the proportion visually and
  the row states the canonical AED value and transaction counts instead.
* **Cash-flow window.** Six *completed* calendar months. Including the current
  partial month would make the newest column read as a collapse in spending
  rather than a shorter window.
* **Title.** The prototype's "Three days left in the month." is a generated
  narrative. The implementation states what the screen knows: the scope and the
  period.

## Needs attention vs. data health

These are deliberately separate surfaces, and the separation is enforced by
tests in both `overviewModel.test.js` and `v6-overview.ui.test.jsx`.

Canonical read contracts return data-quality counters, and it is tempting to
list them under **Needs attention**. That would be a parallel,
frontend-authored attention interpretation: placing a counter inside that
surface *is* the claim that it warrants attention, which is precisely the
judgement SHR-192's producer/condition/lifecycle contract exists to make.

So **Needs attention** renders its gap and nothing else until SHR-192 lands.
The counters appear under **Data quality and freshness** as data-health
evidence, labelled as evidence about data completeness, unranked,
unprioritised, and carrying no resolve affordance — no row has an action link,
because offering one would assert an actionability the row cannot support.

## Prototype demo values

None are used. `src/v6/overview/v6-overview.ui.test.jsx` asserts that no value
from the prototype's Overview appears in the rendered screen, bounded so a
legitimate figure ending in the same digits is not a false positive.
