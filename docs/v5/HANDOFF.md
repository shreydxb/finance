# SHR-155 implementation handoff

Status: fresh V6 frontend boundary and Overview Command Center implemented on a
bounded branch, with the independent review's one blocking finding remediated.
Ready for re-review at the remediation head. Not merged, not approved, not
deployed.

## Review round 1 — blocking finding, remediated

Independent UI review of head `bf17905b` returned BLOCKED on one semantic
boundary: the **Needs attention** surface must not be populated from raw
canonical quality counters before SHR-192 exists, because placing those
counters in that surface is itself the product interpretation SHR-192's
producer/condition/lifecycle contract is meant to own. "Unranked and verbatim"
was correctly judged insufficient.

Remediated exactly as required, with no new backend work and no change to
fail-closed behaviour:

- `attention` in the view model now carries **only** `registry`, its gap slot.
  `AttentionSection.jsx` renders that gap and nothing else.
- `buildQualitySignals` is renamed `buildCanonicalQualityEvidence` and its
  output moved to `quality.evidence`, rendered under **Data quality and
  freshness** and labelled as evidence about data completeness, explicitly not
  an attention feed.
- Every per-row action link was removed. Offering "Open in Activity" on a
  counter asserts an actionability the counter cannot support.
- The separation is enforced by tests on both sides: one asserts
  `Object.keys(model.attention)` is exactly `['registry']` even when counters
  exist, and one asserts the Needs attention section contains no counter, no
  `canonical_*` source string, and no link or button, while the quality
  section does contain the counters with no resolve affordance.

## Git and release boundary

- Issue: `SHR-155 — Fresh V6 app foundation and faithful Overview (desktop/mobile)`.
- Review-1 head: `bf17905b9575715ea1eca212d0f03722da077c30` (BLOCKED). Remediation head recorded in PR #31 after CI completes.
- Branch: `claude/shr-155-v6-foundation-6qazi7`.
- Base: `ab297555` — `origin/main` fetched and verified at implementation start.
- Migrations: **none**. No file under `supabase/` was created, edited or deleted.
- Supabase production: **untouched**. No migration was applied, no RPC deployed,
  no row read or written from this session. Production remains through
  migration 044 exactly as SHR-197's handoff recorded it.
- Netlify: **untouched**. No deploy was triggered and no project setting was
  changed. This branch is frontend-affecting, so the eventual merge to `main`
  will consume Netlify credits and must not carry `[skip netlify]`.
- No PR was merged or approved from this session.

## What was built

A clean V6 frontend boundary inside this repository at `src/v6/`, plus the
Overview Command Center composed fresh from the frozen prototype at
`docs/v6/reference/Our Money - Command Center.dc_v4.html`.

### Routes and components

| Path | Component |
|---|---|
| `/overview` (screen key `Overview`) | `src/v6/OverviewScreen.jsx` |
| `/overview?period=mtd\|qtd\|ytd` | same screen, period is part of the route contract |

New modules:

- Boundary: `src/v6/README.md`, `src/v6/v6.css`, `src/v6/format.js`
- Primitives: `src/v6/primitives/{Slot.jsx,slotState.js,Section.jsx,PeriodControl.jsx}`
- Data: `src/v6/data/{overviewModel.js,composeOverview.js,canonicalReads.js,periods.js,gaps.js,useOverviewData.js}`
- Screen: `src/v6/overview/{OverviewHeader,HouseholdSummary,PeriodKpis,CashFlowSection,AttentionSection,UpcomingSection,DetailColumns,QualitySection}.jsx`
- Deterministic preview: `v6-overview-preview.html`, `src/v6-overview-preview.jsx`,
  `src/v6/fixtures/canonicalFixture.js`
- Docs: `docs/v6/OVERVIEW_CONTRACT_GAPS.md`

Edited: `src/App.jsx` (mount `Overview`), `src/lib/routes.js` (+ `routes.test.js`)
for the `Overview` screen key and the `period` query rule,
`src/shell/AppShell.jsx` (optional `screenOwnsHeader`),
`src/lib/canonicalContracts.js` + `canonicalMetrics.js` (additive nullable
`accounts.name`), `vite.config.js` (preview entry).

### Boundary architecture

- Nothing under `src/v6/` imports `src/screens/**` or `src/components/**`.
- V6 markup styles itself through `src/v6/v6.css`, every rule scoped under a
  `.v6-` selector, consuming only the SHR-151 `--ds-*` tokens. No legacy
  `@theme` ramp (`ink-*`, `brand-*`, `pos-*`, `neg-*`, `night`, `shadow-*`)
  appears in a V6 file. The surface restates the element properties the legacy
  globals set (`th`, `td`, margins, list styles) so they cannot leak in.
- `overviewModel.js`, `composeOverview.js`, `periods.js`, `gaps.js` and
  `format.js` never import the Supabase client, so they load under
  `node --test`. `canonicalReads.js` is the single module that touches the
  Supabase-backed adapters.
- `v6-boundary.test.js` enforces all four rules above as tests, not convention.

### Proven infrastructure reused

Routing and deep links (`src/lib/routes.js`, `useBrowserRouter`), the SHR-152
responsive shell and its landmarks/skip link/focus restoration, dirty-state
navigation safety, `AuthContext`, the canonical read contracts and their
validating normalisers, `period.js`/`dates.js` Asia/Dubai boundaries, the
SHR-151 token contract, and `classes()`.

### Legacy deliberately not reused

`src/screens/Home.jsx` is retained in the repository but no longer mounted —
its composition is not the V6 starting structure. `src/components/**` legacy
hero/chart/list components, `CanonicalQualityIndicator` (legacy ramps), the
non-canonical readers (`recurring`, `budgets`, `goals`, `accounts`,
`snapshots`), and `PrefsContext`'s display-currency conversion are all unused
by the V6 surface.

## Data truth

Connected canonical values and every deliberately withheld slot, with the issue
that closes each gap, are tabulated in `docs/v6/OVERVIEW_CONTRACT_GAPS.md`.
Summary: net worth/assets/liabilities, investments value, period income/spend/
saved/savings rate, the six-month cash-flow series, reconciled category
actuals, canonical ledger rows and canonical account values are connected.
Runway, net-worth change, 12-month change, per-person equity share, daily
investment change, budget remaining, upcoming obligations, the ranked attention
feed and integration status render deliberate unavailable states naming their
contract.

No financial metric is computed in React. The only derived numbers are drawing
geometry (bar heights, a polyline, bar widths), and the category breakdown is
withheld entirely unless it reconciles to the canonical period total at
two-decimal precision.

All six semantic quarantines hold: no household split, no fabricated investment
history, no invented RBAC, no category-lifecycle semantics, no invented
Planning logic, and no integration-health claim from deployment or config.

## Validation actually run

| Command | Result |
|---|---|
| `npm run lint` | exit 0, warnings only (1 new, of the same class as existing data-fetch effects) |
| `npm test` | **661 passing** — 555 node (`# fail 0`, base 534, +21) and 106 vitest (base 91, +15) |
| `npm run test:visual` | 8 new V6 Overview tests pass; see the environment note below |
| `npm run build` | exit 0 |
| `npm audit --audit-level=high` | 0 vulnerabilities |
| `git diff --check` | clean |
| `npm run test:db` | **not run** — no local Postgres in this session, and this branch changes no SQL |

### Visual-test environment note

This container ships Chromium build 1194 while `@playwright/test@1.62.1`
expects 1234, so Playwright was pointed at `/opt/pw-browsers/chromium` through
a session-local config that is **not** committed.

At the exact base commit `ab29755`, three visual tests already fail in this
container — `foundation.spec.js` (both tests) and the `shell.spec.js`
screenshot comparison, the latter by 6,734 pixels (0.03 of the image). This was
verified in a clean worktree of the base and is therefore pre-existing and
environmental, not introduced by this branch.

Because of that, pixel baselines for the Overview were deliberately **not**
committed: baselines captured on the wrong browser build would fail everywhere
else. `tests/visual/v6-overview.spec.js` therefore asserts browser-build
independent facts — computed geometry at each breakpoint, page-level overflow
down to 320px and at 200% zoom, 44px target sizes, keyboard operation of the
period control, reduced-motion final state, and axe on desktop and phone in
both themes. A reviewer in the canonical environment can add baselines with
`npm run test:visual -- tests/visual/v6-overview.spec.js --update-snapshots`.

## Reviewer checks

1. Desktop at 1440×1200 and mobile at 390/320 against `DESKTOP_PARITY.md` and
   `MOBILE_PARITY.md`, in both themes. `/v6-overview-preview.html` renders the
   real screen against non-contractual fixtures with no Supabase session.
2. Every unavailable state: is the reason true, and is the named contract the
   right one? (`docs/v6/OVERVIEW_CONTRACT_GAPS.md`.)
3. Deep links: `/overview`, `/overview?period=qtd`, `/overview?period=decade`
   (must redirect), browser back after a period change.
4. Signed-in behaviour against real data — this session had no Supabase
   session, so the screen has never been rendered against the live database.
5. The additive `accounts.name` column on the canonical account adapter.

## Risks

- The Overview has not been rendered against live canonical data. Contract
  drift would surface as an honest unavailable state rather than a wrong
  number, but the happy path is unverified live.
- Review round 1 found the canonical counters too close to an attention feed
  and they have been moved out of that surface entirely; see the remediation
  section above. If the data-health list under quality is also judged to be a
  substitute registry, it is one component (`EvidenceList` in
  `QualitySection.jsx`) and one pure function (`buildCanonicalQualityEvidence`)
  to remove.
