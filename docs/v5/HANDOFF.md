# Our Money v5 handoff — SHR-117 Phase 1 design-system foundation

Date: 24 August 2026

Branch: `shreydxb1/shr-117-phase-1-design-system-foundation`

Base: `33cad0ef772497f7a0dd76c6d41b8ea554141e25`

Production application: **NOT APPLIED**

Production Supabase / Edge Functions / RLS / SHR-113 scheduler: **UNTOUCHED**

Production Netlify configuration and site: **UNCHANGED**

The immutable final head SHA, PR URL, exact-head Netlify Deploy Preview URL,
and deploy ID are recorded in the final SHR-117 Linear handoff after the last
commit. They cannot be embedded in that commit without changing its SHA.

## Scope and outcome

This branch implements only the independently approved SHR-117 Phase 1
foundation. It adds a semantic token layer, deterministic standalone preview,
presentation primitives, an accessible Radix Dialog foundation, fixture-only
ChartFrame accessibility infrastructure, and automated UI/accessibility/visual
coverage.

It does not activate an AppShell, desktop sidebar, mobile bottom navigation,
SHR-116 Phase 2, responsive screen migration, production chart rewrite,
Sankey change, capability relocation, SHR-118 Overview, financial arithmetic,
canonical metrics, Supabase, Edge Functions, RLS, Netlify configuration, or
SHR-113 scheduler/history changes.

## Foundation inventory

- Semantic light/dark roles for canvas/surfaces, text, borders, action/focus,
  financial positive/negative, success/warning/danger/info/attention, and
  matching soft/contrast roles.
- Inter type aliases, 4 px spacing-compatible control sizes, named radii,
  three elevation levels, 120/180/240 ms motion variables, reduced-motion
  parity, named copy/form/detail/content/dense/shell widths, and the global
  focus-visible contract.
- `Button`, `IconButton`, `Field`, `Input`, `Select`, `Textarea`, `Checkbox`,
  `Panel`, `Card`, `Amount`, `Percentage`, `MissingValue`, `Badge`, `Status`,
  `EmptyState`, `LoadingState`, and `ErrorState`.
- `OverlayRoot`, `OverlayTrigger`, `OverlayBackdrop`, `OverlaySurface`,
  `Dialog`, and `ConfirmDialog` backed by `@radix-ui/react-dialog` for portal,
  modal focus containment, Escape, inert background behavior, and focus
  restoration. ConfirmDialog deliberately focuses Cancel first.
- `QualityIndicator`, `FreshnessIndicator`, `ProvenanceDisclosure`, and
  `AttentionIndicator`. Every quality/freshness/attention state, timestamp,
  label, reason, and severity is caller-supplied; no inference is present.
- `ChartFrame` and `ChartDataAlternative` with a named region, summary, and
  keyboard-operable semantic data table. The preview chart uses deterministic
  hard-coded fixture strings and geometry only.
- `design-system.html` is a separate Vite build entry and does not enter the
  production route registry or authentication flow.

No layout DSL, production shell primitive activation, icon library, global
locale behavior, financial formatter, calculation, or data hook was added.

## Dependencies

- Runtime: `@radix-ui/react-dialog@1.1.23`.
- Development: `vitest@4.1.11`, `jsdom@30.0.1`, Testing Library,
  `vitest-axe@0.1.0`, Playwright `1.62.1`, and `@axe-core/playwright@4.13.0`.
- The compatible transitive `nanoid` lock entry moved to the patched release;
  final `npm audit --audit-level=high` reports zero vulnerabilities.
- No icon dependency was added.

## Bundle comparison

Baseline production build at the base SHA:

- JS: 689.30 kB raw / 177.84 kB gzip.
- CSS: 39.04 kB raw / 7.80 kB gzip.

Phase 1 multi-entry build effective production app load:

- JS: 689.85 kB raw / 178.59 kB gzip (+0.55 kB raw / +0.75 kB gzip).
- Shared CSS: 53.28 kB raw / 10.42 kB gzip (+14.24 kB raw / +2.62 kB gzip).
- Standalone preview entry: 62.91 kB raw / 19.60 kB gzip, loaded only by
  `design-system.html`.

The existing large single-application bundle is split into a 498.00 kB app
entry and 191.85 kB shared runtime by the multi-page build; the effective
comparison above sums the loaded JS rather than presenting that split as a
false reduction.

## Validation

- `npm run lint`: PASS with the same five pre-existing warnings and no new
  warning or error.
- `npm test`: PASS, 524 existing Node/application/Edge tests plus 7 new UI
  tests (531 total).
- `npm run build`: PASS, 199 modules and both `index.html` and
  `design-system.html` outputs.
- `npm run test:visual`: PASS, 3 browser tests. Six deterministic baselines
  cover 390×844, 768×1024, and 1440×900 in light and dark themes.
- Browser axe: PASS across the full harness in light and dark themes with zero
  violations. The initial dark danger-button contrast failure was corrected
  with a theme-specific danger contrast token before baselines were accepted.
- Overlay assertions: PASS for focus entry, modal focus containment, keyboard
  Tab behavior, Escape, trigger focus restoration, and ConfirmDialog safe
  default focus.
- Form assertions: PASS for labels, help/error descriptions, required,
  invalid, disabled, and loading semantics.
- Browser assertions: PASS for 44 px default Button/IconButton targets,
  2 px focus-visible ring, no mobile horizontal overflow with long labels,
  reduced-motion overlay duration, and keyboard-opened chart data table.
- Fixture assertions: PASS for long labels, large and negative values, missing
  values, Complete/Provisional/Incomplete, stale, and review/attention states.
- `npm audit --audit-level=high`: PASS, zero vulnerabilities.
- `git diff --check`: PASS.

## Invariance evidence

- Production route registry, `App.jsx`, route helpers/tests, screen code, and
  canonical/financial helpers are unchanged.
- Financial calculations, accepted display-currency/source precision, and
  application-wide locale behavior are unchanged. Primitives render supplied
  strings and supplied semantic state only.
- Existing Supabase data calls and mutation paths are unchanged.
- No file under `supabase/` changed; no migration was added or applied.
- Edge Functions, RLS, grants, production data, `nw_daily`, snapshot capture,
  SHR-113 scheduling/history, Vault, and scheduler configuration are untouched.
- `netlify.toml` and production Netlify configuration are unchanged. The only
  deployment authorized is the one exact-head Deploy Preview recorded in
  Linear. Production state remains **NOT APPLIED**.

## Independent QA checks

1. Verify the base/head SHAs, PR scope, and exact-head deploy ID/URL in Linear.
2. Open `/design-system.html` on the preview and inspect light/dark at mobile,
   tablet, and desktop widths.
3. Keyboard-test controls, quality/provenance disclosures, Dialog focus trap,
   Escape/focus restoration, ConfirmDialog Cancel-first focus, and ChartFrame
   data-table disclosure.
4. Confirm long/large/negative/missing and quality/freshness/attention fixtures
   remain legible without relying on color alone.
5. Confirm canonical routes and authenticated production screens behave as at
   the base SHA and that no production data request is made by the harness.
6. Confirm no Supabase, Edge, RLS, Netlify configuration, SHR-113, calculation,
   or production action occurred.
7. Keep the PR unmerged and production unchanged. Phase 2 requires a separate
   review gate.
