# Our Money v5 handoff — SHR-116 Phase 1 route foundation

Date: 24 August 2026

Branch: `shreydxb1/shr-116-phase-1-route-foundation`

Base: `3df1a49b3a04bfb14cc52a90670fe374fa61fbf3`

Production application: **UNCHANGED**

Production Supabase / SHR-113 scheduler: **UNTOUCHED**

The immutable head SHA, PR URL, Netlify Deploy Preview URL, and deploy ID are
recorded in the final SHR-116 Linear handoff after the last commit and preview.
They cannot be embedded in that commit without changing its SHA.

## Scope and outcome

This branch implements only the independently approved Phase 1 route
foundation. It replaces the app's in-memory screen identity with browser URL
identity while deliberately retaining the current ten-item header navigation
and existing production screen bodies.

It does not implement the four-item v5 sidebar, mobile bottom navigation,
responsive shell redesign, capability relocation, Accounts split, Reports
dissolution, FIRE/Forecast relocation or convergence, design-system work,
Overview redesign, or any financial semantic change.

## Canonical route matrix

| Canonical route | Existing screen body reused in Phase 1 |
| --- | --- |
| `/overview` | Home |
| `/money/activity` | Transactions |
| `/money/budget` | Budget |
| `/money/recurring` | Recurring |
| `/money/insights` | Reports |
| `/wealth/net-worth` | Accounts |
| `/wealth/accounts` | Accounts |
| `/wealth/investments` | Investments |
| `/planning` | Goals |
| `/planning/goals` | Goals |
| `/planning/debt` | Debts |
| `/planning/forecasts` | Accounts, including its unchanged forecast section |
| `/settings` and approved Settings children | Settings |

Approved Settings children are `/settings/household`,
`/settings/preferences`, `/settings/categories`, `/settings/integrations`,
`/settings/integrations/telegram`, and `/settings/data-sources`. Unknown
Settings children are Not Found rather than silently opening Settings.

`/` replaces to `/overview`. `/money` and `/wealth` replace to their approved
defaults. Legacy aliases replace as follows:

| Legacy alias | Canonical destination |
| --- | --- |
| `/home` | `/overview` |
| `/transactions` | `/money/activity` |
| `/reports` | `/money/insights` |
| `/accounts` | `/wealth/accounts` |
| `/investments` | `/wealth/investments` |
| `/budget` | `/money/budget` |
| `/recurring` | `/money/recurring` |
| `/goals` | `/planning/goals` |
| `/debts` | `/planning/debt` |

Aliases preserve only route-specific allowlisted query parameters. Arbitrary
keys and `returnTo` are removed. Redirects are replacement navigations and
cannot loop.

## URL and history behavior

- Activity filter/search/sort and the distinct `needsReview` / `unreviewed`
  queues are URL state.
- Recurring scope, list/calendar mode, cursor, and income filters are URL
  state.
- Insights section, period/cursor, view, grouping, Sankey grouping, and
  comparison are URL state.
- Accounts composition grouping and Investments owner/group/chart selection
  are URL state.
- Query updates use history replacement; destinations and details use history
  pushes. Reload, direct open, Back, and Forward therefore preserve the
  revisitable state without creating a history entry per filter keystroke.
- Unknown authenticated paths render an application Not Found surface. They
  never fall through to Overview.
- Netlify's existing SPA rewrite remains unchanged and provides direct-open
  delivery; the client owns route and Not Found semantics.

## Authentication and return targets

An unauthenticated direct-open keeps the requested internal URL while showing
the existing Login screen; successful authentication therefore resumes that
destination without transient memory. `/login?returnTo=...` additionally
accepts only a resolved canonical or legacy-aliased internal application route.
Absolute URLs, protocol-relative URLs, backslash variants, login recursion,
and unknown paths are rejected and fall back to `/overview` after
authentication.

## Immutable detail routes

Existing record surfaces now use immutable UUID routes:

- `/money/activity/:transactionId`;
- `/money/recurring/:recurringId`;
- `/wealth/accounts/:accountId`;
- `/wealth/investments/:accountId`;
- `/planning/goals/:goalId`;
- `/planning/debt/:goalId`.

The existing list calls load the same rows they loaded before and open the
matching existing detail/form after data arrives; no new Supabase read helper
or query was introduced. A pushed detail records its exact parent URL so Close
uses browser Back and restores filters. A direct-open detail has no assumed
background entry, so Close replaces to a sensible canonical parent. Invalid or
name-shaped IDs are Not Found.

## Unsaved-edit protection

Existing modal forms register dirty state only after a field changes. Primary
destination navigation, detail Close/Back, browser Back/Forward, sign-out, and
page unload cannot silently discard a dirty form. A rejected confirmation
restores the current history entry. Successful saves/deletes use the existing
mutation path and clear the guard as their form closes.

## Financial and operational invariance

- No financial arithmetic, canonical contract, Supabase query helper, mutation
  helper, RLS policy, grant, migration, Edge Function, or Netlify production
  configuration changed.
- Existing Home, Reports, Accounts, Transactions, Recurring, Investments,
  Budget, Goals, Debt, Settings, FIRE, and Forecast screen calculations and
  calls remain their prior implementations.
- No file under `supabase/` changed. No migration was added or applied.
- SHR-113 cron, Vault secrets, Edge Functions, snapshot tables, `nw_daily`,
  snapshot policy, scheduler evidence/history, and production Supabase
  configuration were neither read-write accessed nor changed.
- Production Netlify remains unchanged. Only the one explicitly requested
  exact-head Deploy Preview is authorized for this handoff.

## Validation

- `npm run lint`: PASS with the same five pre-existing React warnings and no
  new warning/error.
- `npm test`: PASS, 524/524 full application and Edge tests. This includes 13
  new route/history/security contract tests.
- `npm run build`: PASS, 132 modules. The existing large-chunk advisory remains.
- Local production-build browser QA: PASS. `/` replaced to `/overview` before
  the auth boundary; `/transactions?search=rent&owner=Shrey&returnTo=...`
  replaced to the safe canonical query; reload preserved it; Back/Forward
  restored exact URLs; and unknown paths remained unknown at Login rather than
  becoming Overview. The expected warning for absent local Vite Supabase
  environment values was the only browser console warning.
- `git diff --check`: PASS.
- Prohibited-path review: PASS. No `supabase/`, `netlify.toml`, package,
  financial data/helper, or scheduler file changed.

## Independent QA checks

1. Verify base/head, clean PR scope, and exact-head preview deploy ID.
2. Exercise every canonical and legacy URL while authenticated, including
   alias query sanitization and unknown-route Not Found.
3. Verify direct-open, reload, Close, browser Back, and Forward for each UUID
   detail family with a real existing record.
4. Change a protected form field and reject navigation through a current top
   tab, browser Back, detail Close, reload, and sign-out; confirm the edit is
   not discarded.
5. Confirm current screen results, data calls, mutations, and current ten-item
   desktop/mobile navigation presentation are unchanged.
6. Confirm there is no Supabase/SHR-113 diff or production action.
7. Keep the PR unmerged and production unchanged until independent QA passes.
