# Our Money v5 handoff — SHR-116 Phase 2 application shell

Date: 28 August 2026

Branch: `shreydxb1/shr-116-phase-2-app-shell`

Exact production base: `bc3d43ee7325746337c713b62edc92571b6b9150`

Immutable implementation commit: `195f2b13bce9ab781ec07070dd95bf5bbf6ca59a`

Production application: **UNCHANGED**

Production Supabase / Auth / RLS / Edge Functions / SHR-113: **UNTOUCHED**

The immutable final PR head, PR URL, exact-head Netlify Deploy Preview URL,
deploy ID, CI conclusion, and post-push verification are recorded in the
SHR-116 Linear implementation handoff. They cannot be embedded in their own
commit without changing that commit's SHA.

## Scope and outcome

This branch implements the independently approved SHR-116 Phase 2 shell as one
bounded PR. Authenticated production screens now mount inside a responsive v5
application frame with exactly four primary destinations: Overview, Money,
Wealth, and Planning. Settings, display preferences, account identity, and
sign-out remain separate utility surfaces.

The shell provides:

- a 240px desktop sidebar from 1200px upward;
- a 72px tablet/compact-desktop rail from 768px through 1199px;
- a mobile app header and four-item bottom navigation below 768px;
- domain-aware secondary navigation with native anchors and `aria-current`;
- one route-owned PageHeader `h1` and named semantic content widths;
- a mobile full-screen / desktop right-drawer DetailShell for only the six
  existing UUID families: transaction, recurring, account, investment, goal,
  and debt;
- separated Settings and Preferences/profile/sign-out access;
- skip-link, landmark, focus-entry, focus-return, keyboard, forced-colors, and
  safe-area behavior.

Existing Home, Money, Wealth, Planning, and Settings bodies are reused. Their
financial calculations, data loading, controls, and capabilities were not
redesigned. Only redundant outer max-width/padding wrappers and duplicate page
titles were adapted so the route-owned frame controls composition.

## Architecture and approved refinements

- The existing custom History API router remains authoritative. React Router
  was not added.
- `src/lib/routes.js` owns primary/secondary presentation metadata alongside
  the unchanged canonical route, alias, query-sanitization, and UUID rules.
- `src/lib/useBrowserRouter.js` preserves the existing router behavior while
  making focus-return state explicit and independently testable.
- `AppShell` mounts only below the existing authenticated Gate. Login remains
  outside every shell landmark and navigation surface.
- `AppLink` renders real anchors. Only unmodified, same-origin primary clicks
  are intercepted; modified clicks keep native browser behavior.
- DetailShell is route-aware, not a modal migration. Existing local create and
  nested-edit overlays remain unchanged. No `/new` route or household switcher
  exists.
- Missing UUIDs render Record unavailable only after the owning loader settles;
  loader failures remain distinct errors and loading remains a real status.
- The DetailShell/Radix implementation is lazy. It is fetched only when a UUID
  detail opens and is not part of the normal initial application load.
- A deterministic `shell-preview.html` entry exists solely for responsive QA.
  It contains no production records and is isolated from normal app chunks.

Differences from the early SHR-116 concept are the approved review refinements:
tablet uses a rail instead of a second top-navigation model; Settings is a
utility, not a fifth destination; no new-route or broad modal migration was
introduced; actions stayed in existing bodies where lifting state would have
refactored mutations; and the current custom router was extended instead of
replaced.

## Route, history, dirty, and focus invariants

- All canonical routes and 12 aliases remain valid; alias query allowlists are
  unchanged.
- Query state is sanitized by the existing per-parent rules and preserved on
  detail open, refresh, Back, and Forward.
- The six route details retain immutable UUID identity and existing parent
  routes. Pushed details close with browser Back; direct-open details replace
  with the canonical parent.
- Primary, secondary, Settings, utility Settings, sign-out, browser popstate,
  and Detail Back all use the existing dirty-form confirmation path. A rejected
  transition does not clear form registrations or change the accepted route.
- Detail open focuses the detail title. Close restores the still-connected
  invoker; direct/dead-invoker closes deterministically fall back to the route
  `h1`. Ordinary route changes focus the new `h1`; query-only changes do not.
- Refresh/deep-link resolution remains URL-derived. No transient background
  location is required to render a detail.

## Exact implementation files

The immutable implementation commit changes exactly these 39 files; this
handoff document is the sole additional evidence file in the PR:

- `shell-preview.html`
- `src/App.jsx`
- `src/browser-router.ui.test.jsx`
- `src/components/AccountForm.jsx`
- `src/components/GoalForm.jsx`
- `src/components/RecurringForm.jsx`
- `src/components/TransactionForm.jsx`
- `src/design-system/Dialog.jsx`
- `src/index.css`
- `src/lib/routes.js`
- `src/lib/routes.test.js`
- `src/lib/useBrowserRouter.js`
- `src/screens/Accounts.jsx`
- `src/screens/Budget.jsx`
- `src/screens/Debts.jsx`
- `src/screens/Goals.jsx`
- `src/screens/Home.jsx`
- `src/screens/Investments.jsx`
- `src/screens/Recurring.jsx`
- `src/screens/Reports.jsx`
- `src/screens/Settings.jsx`
- `src/screens/Transactions.jsx`
- `src/shell-preview.jsx`
- `src/shell/AppLink.jsx`
- `src/shell/AppShell.jsx`
- `src/shell/ContentFrame.jsx`
- `src/shell/DesktopSidebar.jsx`
- `src/shell/DetailShell.jsx`
- `src/shell/MobileAppHeader.jsx`
- `src/shell/MobileBottomNav.jsx`
- `src/shell/PageHeader.jsx`
- `src/shell/RouteDetailShell.jsx`
- `src/shell/SecondaryNav.jsx`
- `src/shell/UtilityPanel.jsx`
- `src/shell/app-shell.ui.test.jsx`
- `src/shell/appLinkEvents.js`
- `src/shell/detail-shell.ui.test.jsx`
- `src/shell/shell.css`
- `vite.config.js`

The legacy ten-item header navigation and header-level display controls were
removed from `App.jsx`. Existing screen-local detail overlays were retained for
non-route fallback/create flows; only route-owned UUID details use DetailShell.

## Design-system reuse

Shell color, type, spacing, radius, elevation, control-height, breakpoint, and
container behavior consume the shipped SHR-117 semantic tokens. ContentFrame
uses `copy`, `form`, `detail`, `content`, and `dense` container tokens; the
shell uses `shell`. Existing SHR-117 Button, IconButton, LoadingState,
ErrorState, and overlay primitives are reused. No icon dependency or competing
shell token system was added.

## Automated validation

Final local gates before the implementation/evidence commits:

- `npm test`: **PASS — 525/525 Node/application/Edge tests and 74/74 UI tests
  (599 total)**;
- `npm run lint`: **PASS** with the same five pre-existing warnings and no new
  warning/error;
- `npm run build`: **PASS — 215 modules**, three isolated application entries;
- `git diff --check`: **PASS**.

New deterministic coverage verifies exact primary/secondary mapping, all six
UUID families, aliases and supported queries, direct-open and pushed detail
semantics, query replacement, dirty transition rejection/acceptance, modified
links, utility separation, one `h1`, route focus, connected-invoker/fallback
focus, mobile bottom-nav suppression, Detail loading/error/unavailable truth,
dialog semantics, and axe checks.

## Bundle and harness isolation

Exact production base (`bc3d43ee…`, recorded by the preceding SHR-117 handoff):

- normal app JS: **690.58 kB raw / 179.90 kB gzip**;
- shared CSS: **53.22 kB raw / 10.42 kB gzip**.

SHR-116 Phase 2 build:

- normal initial app JS: 278.43 + 193.47 + 232.63 + 2.20 =
  **706.73 kB raw / 185.65 kB gzip**;
- JS delta: **+16.15 kB raw / +5.75 kB gzip** (ceiling +12 kB gzip);
- shared CSS: **57.32 kB raw / 11.25 kB gzip**;
- CSS delta: **+4.10 kB raw / +0.83 kB gzip** (ceiling +3 kB gzip);
- on-demand UUID DetailShell + Radix: **40.64 kB raw / 13.93 kB gzip**,
  absent from initial `index.html` preloads;
- shell preview entry: **2.97 kB raw / 1.29 kB gzip**.

`index.html` references only its application/shared chunks. Searches of all
normal app-loaded JS chunks find zero shell-preview fixtures
(`SHR-116 Shell Preview`, `preview@example.com`, `Dirty-navigation fixture`),
zero design-system preview fixture strings, and zero Radix dialog markers.
Neither preview entry is referenced by `index.html`.

## Targeted browser and accessibility evidence

Local browser verification used deterministic shell fixtures plus the actual
unauthenticated app boundary:

- actual `/money/activity?search=rent` while signed out showed Login only, with
  no AppShell navigation;
- 390×844: mobile header and four-item bottom navigation visible, desktop rail
  absent, horizontal secondary navigation active, safe-area framing present;
- 768×900 and 1024×900: 72px rail visible, mobile header/bottom navigation
  absent;
- 1440×900: 240px sidebar visible with full labels and utility section;
- mobile detail: 390×844 full-screen, bottom navigation absent, detail title
  focused, UUID rendered, visible Back;
- desktop detail: 576px right drawer, title focused, visible Back;
- Detail Back restored the surviving invoker; fallback route-title focus was
  also covered deterministically;
- desktop utility was a 448px bottom-right modal surface with identity,
  currency, light/dark/system, Settings, and sign-out separated from primary
  navigation;
- representative light mobile and dark desktop states were visually inspected;
- axe passed representative shell and DetailShell light-state fixtures; forced
  colors receive an explicit active-route border; all target sizes expose one
  route `h1`, unique landmark names, native anchors, and keyboard-sized targets.

The dirty-form browser fixture produced the existing confirmation and blocked
automation until explicit resolution; deterministic integration tests verify
both rejection (route unchanged) and acceptance (route commits once).

## Protected-state confirmation

- No file under `supabase/` changed. Schema, migrations, RLS, grants, Auth,
  Storage, production data, secrets, and Edge Functions are untouched.
- No `netlify.toml`, Netlify Function, production Netlify configuration, or
  production deployment changed.
- No query, mutation, payload, data contract, canonical metric, calculation,
  category rule, account value, forecast, budget, report, or snapshot behavior
  changed.
- No SHR-113 table, capture/history path, scheduler, cron, Vault secret, or
  operational evidence changed.
- No React Router, household switcher, `/new` route, icon package, or generic
  design-system convergence was introduced.
- Overview/SHR-118 and financial screen bodies remain transitional production
  bodies. V5.2 command-center work did not start.

## Rollout, rollback, and independent reviewer entry points

This is one coherent shell PR with no feature flag or dual-shell branch. It
remains open and unmerged. Rollback before merge is branch/PR abandonment;
after any separately authorized merge it is one bounded PR revert. Production
remains on `bc3d43ee…` throughout this handoff.

Independent review should target:

1. exact base/head, 40-file PR scope including this handoff, CI, and exact-head
   Netlify deploy identity;
2. `/shell-preview.html` at 390, 768, 1024, and 1440 widths, with representative
   light/dark checks;
3. the four primary destinations, each domain's secondary links, Settings and
   Preferences separation, active hierarchy, one `h1`, landmarks, skip link,
   focus rings, keyboard traversal, and no horizontal shell overflow;
4. one pushed and one direct-open UUID detail, browser Back/Forward/refresh,
   visible mobile Back, invoker/fallback focus, and missing-ID/error truth;
5. a query-bearing Activity route and dirty edit across primary, secondary,
   Detail Back, browser Back, Settings, and sign-out attempts;
6. representative authenticated screen bodies only—do not repeat financial
   calculation QA or every screen at every viewport;
7. normal-app bundle/chunk membership, preview isolation, and protected-state
   diff confirmation.
