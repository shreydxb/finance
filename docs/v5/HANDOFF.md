# Our Money v5 handoff — SHR-117 Phase 2 Batch 1

Date: 27 August 2026

Branch: `shreydxb1/shr-117-phase-2-batch-1-feedback`

Base: `d0f80119f5b9d7f9c963938d0a94317ea6a799e0`

Production application: **UNCHANGED**

Production Supabase / Edge Functions / RLS / SHR-113 scheduler: **UNTOUCHED**

Production Netlify configuration and site: **UNCHANGED**

The immutable final head SHA, PR URL, exact-head Netlify Deploy Preview URL,
deploy ID, CI result, and final validation totals are recorded in the SHR-117
Linear implementation handoff after the final commit. They cannot be embedded
in that commit without changing its SHA.

## Scope and outcome

This branch implements only the independently approved SHR-117 Phase 2 Batch 1
passive page-feedback convergence.

The existing visible `Loading…` and caller-supplied load-error strings now use
the shipped design-system `LoadingState` and `ErrorState` on:

- Budget;
- Debts;
- Goals;
- Recurring;
- Settings;
- Transactions.

Six copied loading recipes and six copied error-alert recipes were removed.
Every error state remains inline and passive. No retry/action or new request
was added.

## Behavior preserved

- Loader functions, Promise/request counts, effect ordering, state machines,
  catches, error assignment, and loaded/error render ordering are unchanged.
- Existing loading and error wording is byte-for-byte unchanged.
- Existing route/query state, detail behavior, realtime refresh behavior,
  screen composition outside the 12 presentation nodes, and mutation handlers
  are unchanged.
- Financial calculations, canonical metrics, formatting semantics, accepted
  precision/currency behavior, and data queries are unchanged.
- No adjacent buttons, fields, cards, empty states, dialogs, confirmations,
  progress bars, quality indicators, values, or charts were migrated.
- Home/Overview and SHR-118 are untouched.
- SHR-116 Phase 2 shell/navigation remains unstarted.

## Focused regression coverage

`src/screens/feedback-convergence.ui.test.jsx` contains three deterministic
checks for each of the six screens (18 total):

1. initial loading exposes one shared status while preserving the exact
   pre-existing loader/request count;
2. a rejected load keeps the exact error inline, supplies one passive alert,
   has no action, preserves loaded screen structure, makes no extra request,
   and passes axe;
3. a successful load preserves normal composition with no passive feedback
   left visible and the same request count.

Settings coverage includes its existing four primary settings reads plus the
four Telegram child reads after the main screen becomes renderable. The tests
therefore lock the pre-existing eight-call error/normal-load behavior rather
than hiding it behind the presentation migration.

## First-consumer bundle isolation

The production screens intentionally import `LoadingState` and `ErrorState`
from the approved `src/design-system/index.js` public surface.

The first build showed that the two-entry graph would otherwise place the
preview's broad design-system dependency graph in the normal application's
shared chunk. `vite.config.js` now marks only `src/design-system/**` modules
as side-effect-free for tree-shaking. Those files are pure React presentation
modules; no component API or style changed.

Exact base build:

- normal app JS: 498.00 kB app + 191.85 kB shared =
  **689.85 kB raw / 178.59 kB gzip**;
- shared CSS: **53.28 kB raw / 10.42 kB gzip**;
- standalone preview entry: **62.91 kB raw / 19.60 kB gzip**.

Batch 1 build:

- normal app JS: 497.73 kB app + 195.61 kB shared =
  **693.34 kB raw / 179.87 kB gzip**;
- delta: **+3.49 kB raw / +1.28 kB gzip**;
- shared CSS: **53.28 kB raw / 10.42 kB gzip**, unchanged;
- standalone preview entry: **59.30 kB raw / 18.76 kB gzip**, with the used
  state dependencies now in the shared chunk.

`index.html` loads only the app and `States` chunks. It does not reference
the `designSystem` preview entry. The fixture-only strings “SHR-117 · PHASE
1”, “Design-system foundation”, and “Deterministic fixture data only” occur
only in the `designSystem` entry and are absent from both normal app-loaded
JS chunks.

## Validation

Local validation completed before the immutable implementation commit:

- focused feedback suite: **PASS — 18/18**;
- `npm run lint`: PASS at the implementation stage with the same five
  pre-existing warnings and no new warning/error;
- `npm test`: **PASS — 524/524 Node/application/Edge tests and 25/25 UI
  tests**;
- `npm run build`: **PASS — 199 modules**, both application entries;
- `npm run test:visual`: deterministic mobile/tablet/desktop light/dark
  screenshots, browser axe, focus/target/reduced-motion checks — **PASS —
  3/3**;
- `git diff --check`: **PASS**;
- exact-head GitHub Actions CI and targeted Deploy Preview verification are
  recorded in the SHR-117 Linear handoff after push.

## Explicit protected-state confirmation

- No file under `supabase/` changed.
- No migration, schema, RLS, grant, Auth, Storage, production data, or secret
  change was made.
- No Edge Function or Netlify Function changed.
- `netlify.toml` and production Netlify configuration are unchanged.
- No financial query, calculation, canonical contract, data call, or mutation
  changed.
- `App.jsx`, route helpers/tests, navigation, aliases, query-state handling,
  and dirty guards are unchanged.
- SHR-113 snapshot tables, capture, history, scheduler, cron, Vault, and
  operational evidence are untouched.
- No production deployment, merge, or production action is authorized by this
  handoff. The PR must remain open and unmerged for lightweight independent QA.

## Lightweight independent QA entry points

1. Verify exact base/head, changed-file scope, CI, and Deploy Preview commit.
2. Review the 12 presentation-node replacements and confirm no state/effect/
   loader/data/mutation code changed.
3. Confirm all 18 focused regression tests and full validation pass.
4. Inspect representative Money, Planning, and Settings loading/error states
   at targeted mobile/desktop light/dark widths; do not repeat the full app
   matrix.
5. Normal-load smoke the six affected canonical routes.
6. Confirm the preview harness remains isolated and all protected production
   systems remain untouched.
