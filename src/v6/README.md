# V6 frontend boundary (SHR-155)

Everything under `src/v6/` is the fresh V6 application surface built from the
frozen Command Center prototype (`docs/v6/reference/Our Money - Command
Center.dc_v4.html`). It is **not** a restyle of the legacy screens in
`src/screens/`, and it does not import from them.

## Rules for this directory

1. **No legacy presentation imports.** Nothing here may import from
   `src/screens/**` or `src/components/**`. Those are the legacy composition
   and are deliberately not the starting structure for V6.
2. **No legacy global CSS ramps.** V6 markup styles itself through
   `src/v6/v6.css`, scoped under `.v6-surface`, using the SHR-151 semantic
   tokens (`--ds-*`). The legacy `@theme` ramps in `src/index.css`
   (`ink-*`, `brand-*`, `pos-*`, `neg-*`, `night`, `shadow-*`) must never
   appear in a V6 file. `v6-boundary.test.js` enforces both rules.
3. **No financial math in React.** Every monetary figure rendered here comes
   from an approved canonical contract read. Modules under `data/` may
   choose *which* canonical reads to make and *how to present* them; they
   may not derive a new financial metric, average, delta, projection, share
   or allocation.
4. **Missing contract ⇒ honest state.** When no approved contract can supply
   a value, the screen renders a deliberate unavailable/incomplete state
   naming the gap. Never a demo number, never a legacy non-canonical
   estimate, never a silent omission.
5. **Prototype demo values are non-contractual.** Fixtures under `fixtures/`
   exist only to make the deterministic visual/accessibility preview render;
   they are labelled non-contractual and are never used as an application
   fallback.

## What is deliberately reused (proven infrastructure, not presentation)

* `src/lib/routes.js`, `src/lib/useBrowserRouter.js` — routing, deep links,
  query sanitisation, detail/back semantics.
* `src/shell/**` — the SHR-152 responsive shell: landmarks, skip link, the
  five-destination IA, focus restoration, dirty-state safety, utility panel,
  and `DetailShell`'s drawer focus trap, background inertness and Escape
  handling.
* `src/lib/AuthContext.jsx`, `src/lib/NavigationSafety.jsx` — session and
  back/dirty-state safety.
* `src/lib/canonicalMetrics.js`, `src/lib/canonicalContracts.js`,
  `src/lib/canonicalPresentation.js` — canonical read contracts and their
  validating normalisers.
* `src/lib/period.js`, `src/lib/dates.js` — Asia/Dubai date boundaries and
  period ranges.
* `src/design-system/tokens.css` — the SHR-151 semantic token contract.

## What is deliberately **not** reused

* `src/screens/Home.jsx` — the legacy dashboard composition. It stays in the
  repository (nothing is deleted in SHR-155) but no longer renders at
  `/overview`.
* `src/screens/Transactions.jsx` — the legacy Activity composition. It stays in
  the repository (nothing is deleted in SHR-164) but no longer renders at
  `/money/activity`, and `src/App.jsx` no longer imports it.
* `src/screens/Budget.jsx` — the legacy Budget composition. It stays in the
  repository (nothing is deleted in SHR-199) but no longer renders at
  `/money/budget`, and `src/App.jsx` no longer imports it. Its derived
  `Remaining` column, its browser-side `toAED` conversion and its raw
  `listTransactions` reads are exactly the frontend financial truth SHR-167
  exists to remove, so none of it is carried forward.
* `src/screens/Recurring.jsx` — the legacy Recurring composition. It stays in
  the repository (nothing is deleted in SHR-200) but no longer renders at
  `/money/recurring`, and `src/App.jsx` no longer imports it. Recurring is a
  *plan* surface and no approved contract publishes plans, so the fresh screen
  renders the prototype's composition with every plan position failing closed
  under SHR-171 rather than carrying the legacy screen's non-canonical
  schedule forward. See `docs/v6/RECURRING_CONTRACT_GAPS.md`.
* `src/screens/Reports.jsx` — the legacy Reports/Insights composition. It stays
  in the repository (nothing is deleted in SHR-201) but no longer renders at
  `/money/insights`, and `src/App.jsx` no longer imports it. The fresh screen
  reads only canonical period metrics and canonical budget actuals; every
  analytical comparison, merchant/payee position and explanatory conclusion
  fails closed under SHR-169 instead of carrying forward legacy transaction
  grouping or browser-side arithmetic. See
  `docs/v6/INSIGHTS_CONTRACT_GAPS.md`.
* `src/components/**` — legacy chart/list/hero components whose composition
  encodes the old visual hierarchy.
* `src/lib/recurring.js`, `src/lib/budgets.js`, `src/lib/goals.js` and the
  other non-canonical readers — their values are not canonical contracts. For
  Budget specifically, `budgets.js` also carries the only *writer* the prototype
  would reach for; wiring it in would create plan rows outside the versioned
  plan contract (SHR-166), so every plan write is rendered as a named
  unsupported capability instead. See `docs/v6/BUDGET_CONTRACT_GAPS.md`.
  `recurring.js` is the same situation for Recurring, with one extra hazard:
  the Recurring screen could also *fabricate* a plan by reading posted rows and
  clustering them. It therefore makes no ledger, income or transaction read at
  all — the inference has nowhere to live — and `v6-boundary.test.js` fails the
  build if one appears. See `docs/v6/RECURRING_CONTRACT_GAPS.md`.
  Insights has the same structural guard: only `getPeriodMetrics` and
  `listBudgetActuals` may reach its composition, while raw rows, analytical
  heuristics and every legacy financial writer are rejected.
* `src/lib/PrefsContext`'s display-currency conversion — canonical values are
  AED and are rendered in AED rather than re-converted in the browser.
