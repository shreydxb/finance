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
  five-destination IA, focus restoration, dirty-state safety, utility panel.
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
* `src/components/**` — legacy chart/list/hero components whose composition
  encodes the old visual hierarchy.
* `src/lib/recurring.js`, `src/lib/budgets.js`, `src/lib/goals.js` and the
  other non-canonical readers — their values are not canonical contracts.
* `src/lib/PrefsContext`'s display-currency conversion — canonical values are
  AED and are rendered in AED rather than re-converted in the browser.
