# Money → Insights — screen-specific contract gaps (SHR-201)

The fresh V6 Insights screen preserves the frozen Command Center prototype's
summary, category, description/payee, history, comparison and explanatory-card
positions. It fills only positions directly supported by approved canonical
reads. Everything requiring analytical meaning fails closed and names the
issue that owns the missing contract.

## Canonical values connected

| Insights position | Canonical source and exact meaning |
|---|---|
| Consumption spend | `canonical_period_metrics.consumption_spend_aed` for the selected calendar period, labelled as whole-household consumption spend |
| Posted income | `canonical_period_metrics.posted_income_aed` for the selected calendar period, labelled exactly as posted income |
| Category actuals | `canonical_budget_actuals.actual_aed` and its reported `category` label for the selected period |
| Completed-month facts | Six individual `canonical_period_metrics` results preceding the selected period; each spend and posted-income value remains an individual monthly fact |
| Quality and completeness | `quality_status`, `needs_review_count`, `missing_fx_count` and `quality_metadata.missing_fx_currencies` from each canonical period result |

The screen does not read raw or canonical ledger rows. It therefore has no
input from which to group transaction descriptions, infer merchants, infer
economic parties, or create a parallel analytical engine.

## Deliberately withheld

| Prototype position | Missing canonical truth | Owner |
|---|---|---|
| Category comparison, trend, delta, share and ranking meaning | A category analytical series with explicit stable identity and published comparison fields | SHR-169, with SHR-157 / SHR-198 for category identity |
| Description/payee analysis | A canonical analytical read that states the label kind, amount, ordering and period semantics | SHR-169 |
| Merchant ranking or merchant identity | An explicit merchant-identity decision and, if adopted, normalized alias semantics | SHR-169 |
| Month-over-month claims and trend judgements | Contract-published comparisons and direction/judgement fields | SHR-169 |
| Explanations, anomalies, recommendations and “Worth knowing” conclusions | Contract-published analytical conclusions with evidence and completeness semantics | SHR-169 |
| Income source breakdown, income comparison or posted-income reinterpretation | Posted-income consumer semantics beyond the directly published period total | SHR-167 |
| Per-person, shared-versus-personal, or household-allocation insights | Stable economic-party identity and allocation semantics | SHR-195 / SHR-156 |

The minimum later SHR-169 contract needed to complete the prototype is not a
bag of raw rows. It is a canonical Money Insights read model that publishes:

- a stable category key plus reported display label and lifecycle semantics;
- explicit current/comparison values and any approved delta, percentage,
  direction or ranking meaning;
- description/payee analytical rows with an explicit identity kind;
- merchant identity only if the product adopts and publishes normalized alias
  semantics; and
- explanatory conclusions as contract fields with quality/completeness
  evidence, rather than prose generated from browser-side heuristics.

## Category, description and attribution semantics

Category labels are rendered as **reported category labels**, not stable
identity. They are neither normalized nor merged. The canonical
`Uncategorised` bucket remains distinct from a household category literally
named `Other`.

No description/payee row is displayed because no approved analytical contract
publishes one. Raw transaction descriptions are never renamed merchants,
normalized, fuzzy matched, merged, ranked or scored.

The screen is whole-household only. Recorded owner text is not read and cannot
be promoted to economic-party attribution. Shared money is never duplicated or
divided.

## Quality is separate from insight

Quality status, review counts and missing-FX evidence appear in a dedicated
completeness section. They are not called anomalies, alerts, unusual spending,
attention items or recommendations, and they do not populate the explanatory
cards. Category-row quality is shown row by row exactly as published; because
the contract does not publish one category-set quality status, the browser does
not combine those rows into one.

## Drawing-only geometry

Two forms of drawing-only geometry are used, both `aria-hidden` and neither
exposed as a financial number:

- category bars scale directly published category actuals against the largest
  published category actual, only after the complete set reconciles to the
  canonical period consumption-spend amount; and
- history bars scale each directly published monthly spend/income value against
  the largest value in that same complete six-month source set.

The ratios exist only as CSS geometry. No percentage, share, average, delta,
trend or judgement is rendered or placed in the accessibility tree. Geometry
is withheld when the canonical source set is incomplete or misleading.

## Structural boundary

`composeInsights.js` may call only `getPeriodMetrics` and
`listBudgetActuals`. `insightsModel.js` accepts those canonical results and no
transaction-row collection. Boundary tests reject raw transaction/ledger
reads, legacy Reports presentation, legacy writers, merchant normalization,
similarity heuristics, client-side averages, trends, forecasts and unsupported
percentage calculations.

The screen is read-only. It imports no writer, exposes no financial mutation,
and does not reuse `src/screens/Reports.jsx` or its presentation hierarchy.
Prototype fixtures exist only in the deterministic preview entry point and
never serve as an application fallback.
