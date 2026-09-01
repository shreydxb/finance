# SHR-201 implementation handoff

Status: fresh V6 Money → Insights implemented on
`codex/shr-201-fresh-v6-money-insights`, cut from current `origin/v6` at
`d83fdad0653d1c6d14f65fd008d7c1edb781bd60`. That base is the required
SHR-200 Recurring integration commit. The final immutable feature SHA is
recorded in PR and Linear metadata after this handoff commit is created.

## Bounded result

`/money/insights` now mounts `src/v6/InsightsScreen.jsx`. The legacy
`src/screens/Reports.jsx` remains in the repository for history but is neither
imported nor mounted for this route. Overview, Activity, Budget and Recurring
routing is unchanged.

The screen is a fresh read-only V6 composition following the frozen Command
Center prototype:

- page and selected-period header;
- month, quarter and year controls;
- Breakdown, History and Compare URL-backed views;
- selected-period spend and posted-income summary positions;
- current category position;
- completed-month chart/table position;
- description/payee/merchant, comparison and explanatory positions;
- dedicated quality/completeness evidence;
- explicit loading, empty, incomplete and failed states; and
- desktop, tablet, 390px and 320px responsive layouts.

## Routes and modules

- Route: `/money/insights`
- Query state: `period`, `view`, `year`, `month`, `quarter`
- Screen: `src/v6/InsightsScreen.jsx`
- Presentation: `src/v6/insights/*`
- Pure data: `src/v6/data/{insightsPeriods,insightsGaps,insightsModel,composeInsights}.js`
- Bound hook: `src/v6/data/useInsightsData.js`
- Deterministic preview only: `src/v6/fixtures/insightsFixture.js`,
  `src/v6-insights-preview.jsx`, `v6-insights-preview.html`
- Contract record: `docs/v6/INSIGHTS_CONTRACT_GAPS.md`

Reused V6 primitives: `Section`, `FigureSlot`, `SlotNote`,
`UnavailableRegion`, slot-state helpers, AED/date formatting, the V6 shell,
canonical read adapter, realtime refresh infrastructure and scoped V6 tokens.
No legacy presentation component was reused or composed.

## Canonical truth displayed

The production composition calls only:

1. `canonicalReads.getPeriodMetrics`, backed by
   `canonical_period_metrics`; and
2. `canonicalReads.listBudgetActuals`, backed by
   `canonical_budget_actuals`.

Exact facts displayed:

- selected-period whole-household
  `canonical_period_metrics.consumption_spend_aed`;
- selected-period `canonical_period_metrics.posted_income_aed`, labelled
  exactly as posted income;
- selected-period `canonical_budget_actuals.actual_aed` with each contract-
  reported category label shown verbatim;
- six individual completed-month spend and posted-income period facts; and
- directly published period/category quality and completeness evidence.

Category labels are reported labels, not stable identity. Similar labels are
not merged. `Uncategorised` remains distinct from a household category named
`Other`. Category-row quality is shown row by row; no combined category-set
quality is inferred.

No description/payee analytical row is displayed. Raw descriptions are not
read, normalized or called merchants. The screen is whole-household only and
never reads recorded owner text as economic-party attribution.

## Positions deliberately withheld

- SHR-169: category comparison, category analytical identity, trend/delta/
  percentage/ranking meaning, description/payee analytics, merchant identity
  and aliases, anomaly/behaviour claims, explanations and recommendations.
- SHR-167: income breakdown, source semantics, comparison and any
  expected-versus-posted reinterpretation beyond the direct posted total.
- SHR-157 / SHR-198: stable category identity and lifecycle semantics.
- SHR-195 / SHR-156: per-person, shared-versus-personal and allocation truth.

The exact minimum later SHR-169 read model is documented in
`docs/v6/INSIGHTS_CONTRACT_GAPS.md`: stable category keys and label semantics;
explicit comparison/trend fields; description/payee rows with an identity kind;
optional merchant aliases only after a product identity decision; and
contract-published conclusions with quality evidence. SHR-169 was not started
or implemented here.

## Drawing-only geometry

Category bars use only reconciled canonical actuals and scale each published
value against the largest published value. History bars similarly scale a
complete six-month source set. These ratios are CSS drawing geometry only,
`aria-hidden`, and never exposed as percentages, shares, averages, deltas,
trends or semantic metrics. Geometry disappears when its canonical source set
is incomplete or cannot reconcile.

## Structural truth and safety

Boundary tests enforce that the Insights tree:

- imports no legacy Reports/Insights presentation;
- reads no transaction, raw ledger or income rows;
- calls no legacy or financial writer;
- contains no fuzzy matching or merchant normalization;
- contains no percentage-change, average, rolling-average, trend, anomaly,
  forecast or ranking engine; and
- cannot use the preview fixture as an application fallback.

Insights has no forms or enabled mutations and is explicitly read-only.
Quality counters remain evidence only; they never become anomalies, attention
items or behavioural conclusions. No unsupported financial arithmetic or
client-side insights engine was introduced.

## Validation evidence

- `npm run lint`: exit 0; warnings only, including pre-existing warnings and
  the same preview-entry Fast Refresh warning used by prior V6 previews.
- `npm run test:node`: 658 passed, 0 failed.
- `npm run test:ui`: 232 passed, 0 failed.
- Focused Insights/UI/boundary routing rerun: 46 node passed and 30 UI passed.
- `npm run build`: passed; 286 modules transformed.
- Focused Insights Playwright: 12 passed, covering 320, 390, tablet, desktop,
  wide desktop, 200% zoom, keyboard, 44px targets, light/dark, reduced motion,
  URL reload, honest states and axe.
- Full visual regression: 62 of 63 passed under the repository's default
  30-second timeout, including all Insights, Overview, Budget, Recurring,
  shell and foundation checks. The one existing Activity axe matrix timed out
  after 30 seconds without reporting a violation.
- Clean-base verification: the identical Activity test also timed out on clean
  `origin/v6` / `d83fdad` (32.9 seconds against the unchanged 30-second cap).
  The feature-head test passed unchanged with a validation-only 60-second
  runner timeout: 1 passed in 33.4 seconds. No test was weakened or edited.
- `npm audit`: 0 vulnerabilities.
- `git diff --check`: passed.
- DB tests: not run because no SQL, migration, backend or Supabase file changed.

## Production boundary

- PR target: `v6`, never `main`.
- Main: untouched.
- Supabase production schema, rows and settings: untouched.
- Netlify production and settings: untouched.
- No production deploy was triggered and no Netlify production deploy was
  consumed.
- The PR remains open for independent review; it is not merged or approved by
  the implementation agent.
