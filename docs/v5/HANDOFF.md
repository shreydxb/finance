# Our Money v5 handoff — SHR-117 Phase 2 Batch 2

Date: 28 August 2026

Branch: `shreydxb1/shr-117-phase-2-batch-2-form-actions`

Base: `bb70a532b6bf3ef9e82212c48dbc9d6011473218`

Production application: **UNCHANGED**

Production Supabase / Edge Functions / RLS / SHR-113 scheduler: **UNTOUCHED**

Production Netlify configuration and site: **UNCHANGED**

The immutable final head SHA, PR URL, exact-head Netlify Deploy Preview URL,
deploy ID, CI result, and final targeted verification are recorded in the
SHR-117 Linear implementation handoff after the final commit. They cannot be
embedded in that commit without changing its SHA.

## Scope and outcome

This branch implements only the independently approved SHR-117 Phase 2 Batch 2
form action-footer convergence. The existing Save, Cancel, and conditional
Delete controls now consume `Button` from the shipped `src/design-system`
public surface in exactly these ten forms:

- AccountForm;
- BudgetLimitForm;
- CategoryForm;
- ContributionForm;
- ForecastEventForm;
- ForecastSetup;
- GoalForm;
- IncomeForm;
- RecurringForm;
- TransactionForm.

No field, adjacent control, overlay shell, dialog, confirmation, header action,
card, empty state, chart, progress, quality indicator, value presentation, or
other screen composition was migrated.

## Interaction behavior preserved

- Visible labels remain exactly `Save`, `Saving…`, `Cancel`, and `Delete`.
- Save remains the sole submit control, preserves the existing submitting
  interval, and is disabled while pending. The shared loading affordance adds
  `aria-busy` while retaining `Saving…` as its accessible name.
- Cancel remains `type="button"`, preserves each existing `onCancel` callback,
  and never submits.
- Delete remains conditional, in the same Save / Cancel / Delete order, and
  calls precisely the pre-existing handler expression. Account and Category
  continue passing their record IDs. ForecastEvent, Goal, Income, Recurring,
  and Transaction continue passing React's click event because their existing
  markup directly supplied `onDelete`; this is intentionally locked by tests
  rather than silently changing the callback contract.
- No confirmation was added or changed. The two existing native `confirm()`
  call sites elsewhere in Investments and Transactions remain untouched.
- Validation, payload construction, `onSave`, request count/order, catch/error/
  finally behavior, close behavior, and dirty-form/navigation guards are
  unchanged.

## Focused deterministic coverage

`src/components/form-actions.ui.test.jsx` provides four tests for every
approved form (**40 total**):

1. exact action order, visible labels, button types, sole submit control,
   conditional Delete visibility, keyboard Cancel behavior, no accidental
   submit/delete, and axe on the footer;
2. exact valid payload, one `onSave` call, exact pending label, disabled and
   `aria-busy` state, forced double-click protection, and restored Save state;
3. create-mode Delete absence plus keyboard Delete activation with the exact
   existing callback signature, without any data call or real destructive
   mutation;
4. rejected-save wording, one unchanged payload/callback, and the existing
   finally path restoring an enabled Save control.

All callbacks are deterministic mocks. No preview or production financial data
is read or mutated by this suite.

## Bundle and harness isolation

Exact reviewed-base build (`bb70a532…`):

- normal app JS: 497.73 kB app + 195.61 kB shared =
  **693.34 kB raw / 179.87 kB gzip**;
- shared CSS: **53.28 kB raw / 10.42 kB gzip**;
- standalone preview entry: **59.30 kB raw / 18.76 kB gzip**.

Batch 2 build before the immutable commit:

- normal app JS: 494.97 kB app + 195.61 kB shared =
  **690.58 kB raw / 179.90 kB gzip**;
- delta: **−2.76 kB raw / +0.03 kB gzip**;
- shared CSS: **53.22 kB raw / 10.42 kB gzip**;
- standalone preview entry: **59.30 kB raw / 18.76 kB gzip**.

`index.html` loads only the app and shared `States` chunks; it does not reference
the `designSystem` preview entry. Searches of both normal app-loaded JS chunks
find zero preview fixture strings and zero Dialog/Radix markers, including
`SHR-117`, `Deterministic fixture`, `Design-system foundation`, `radix-dialog`,
`DialogContent`, `DismissableLayer`, and `react-remove-scroll`. Those overlay
dependencies remain confined to the standalone preview entry. No primitive,
public API, design-system style, Vite configuration, or package changed.

## Validation

Local validation completed before the immutable implementation commit:

- focused form-action suite: **PASS — 40/40**;
- `npm run lint`: PASS with the same five pre-existing warnings and no new
  warning/error;
- `npm test`: **PASS — 524/524 Node/application/Edge tests and 65/65 UI tests**;
- `npm run build`: **PASS — 199 modules**, both application entries;
- `npm run test:visual`: deterministic mobile/tablet/desktop light/dark
  screenshots, browser axe, focus/target/reduced-motion checks — **PASS — 3/3**;
- `git diff --check`: **PASS**;
- exact-head GitHub Actions CI and Deploy Preview verification are recorded in
  SHR-117 after push.

## Explicit protected-state confirmation

- No file under `supabase/` changed; schema, migrations, RLS, grants, Auth,
  Storage, production data, and secrets are untouched.
- No Edge Function, Netlify Function, `netlify.toml`, or production Netlify
  configuration changed.
- No financial query, calculation, canonical contract, value semantic, data
  call, payload, or mutation changed.
- `App.jsx`, route helpers/tests, navigation, aliases, query state, AppShell,
  Overview/SHR-118, and `ProtectedForm` dirty guards are unchanged.
- SHR-113 snapshot tables, capture/history pipeline, scheduler, cron, Vault,
  and operational evidence are untouched.
- No production deployment, merge, or production action is authorized by this
  handoff. The PR remains open and unmerged for targeted independent QA.

## Tier 2 targeted independent QA entry points

1. Verify exact base/head, changed-file scope, CI, and Deploy Preview commit.
2. Review only the ten footer substitutions and confirm no form state,
   validation, payload, request, error, close, guard, or surrounding control
   changed.
3. Confirm all 40 focused tests and the full automated gate pass.
4. Use mocked/non-destructive paths to target representative Money, Planning,
   and Settings form footers at mobile and desktop widths: keyboard Save,
   pending/double-submit protection, Cancel, conditional Delete visibility,
   focus visibility, accessible names, and no horizontal overflow.
5. Smoke representative normal-load routes without repeating the full
   application browser matrix and without executing Delete against real data.
6. Confirm preview-harness isolation and all protected systems remain untouched.
