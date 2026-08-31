# V6 accessibility checklist

The static prototype is a visual artifact built largely from clickable `div` elements. It does not prove accessibility conformance. “Observation” records what is visible in the artifact; “requirement” states what the product implementation must satisfy.

## Semantics and navigation

- Observation — Visual regions include sidebar navigation, main content, page headings, tabs, charts, lists/tables, and an overlay drawer, but semantic landmarks/roles are not encoded consistently.
- [ ] Requirement — Provide one labeled primary `nav`, one `main`, logical heading levels, and named supplementary regions where useful.
- [ ] Requirement — Use links for navigation and buttons for actions; expose current page with `aria-current` and selected tabs/segments with the appropriate native/ARIA state.
- [ ] Requirement — Preserve a logical DOM and focus order matching visual/read order on desktop and after mobile stacking.
- [ ] Requirement — Provide a skip mechanism past repeated navigation.

## Keyboard and focus

- Observation — Hover and active visuals exist, but no explicit focus style is encoded.
- [ ] Requirement — Every interactive element is reachable and operable using keyboard alone without custom timing or pointer gestures.
- [ ] Requirement — Visible focus has sufficient contrast in both themes and is not conveyed solely by the subtle hover/active fill.
- [ ] Requirement — Focus is not clipped by nav/table overflow, sticky regions, chart wrappers, or drawer boundaries.
- [ ] Requirement — Arrow-key behavior follows the selected tabs/radio/segmented-control pattern; Tab does not visit inactive implementation details unnecessarily.

## Forms, validation, and status

- Observation — Drawer fields and controls are visual `div` constructs; inline validation, required state, and error summaries are not represented.
- [ ] Requirement — Every input/select has a persistent visible label and a programmatic accessible name; placeholder text is not the label.
- [ ] Requirement — Instructions, units/currency, required state, and errors are associated programmatically with their control.
- [ ] Requirement — Validation errors identify the problem and correction in text, focus the first invalid control when appropriate, and are announced without unexpected context change.
- [ ] Requirement — Refreshing, saved, failed, stale, provisional, needs-review, and unavailable states use suitable live/status semantics without excessive announcements.

## Drawer/dialog behavior

- Observation — A 45%-black overlay and right/full-width drawer are visible; the prototype does not verify dialog naming, focus trapping, or background inertness.
- [ ] Requirement — Expose the editor as a named modal dialog/drawer, make background content inert, and prevent background scroll.
- [ ] Requirement — Move focus to the dialog title or first meaningful control on open, trap Tab/Shift+Tab, and return focus to the invoking control on close.
- [ ] Requirement — Provide an accessible close control and Escape behavior unless closing would discard high-consequence work without confirmation.
- [ ] Requirement — Announce save/cancel/error outcome and preserve user input after recoverable validation/server errors.

## Names, icons, and state

- Observation — The prototype uses text labels plus glyphs/arrows and small color/status marks; there is no icon-only navigation system.
- [ ] Requirement — Every icon-only control has an accessible name; decorative glyphs are hidden from assistive technology.
- [ ] Requirement — Positive, negative, warning, selected, provisional, and review states include text/shape/semantics in addition to color.
- [ ] Requirement — Counts such as Money attention state are named with their meaning, not announced as an unexplained number.

## Contrast and themes

- Observation — Exact dark/light color values are documented, but their contrast has not been certified for every text size, rule, status, and composited active fill.
- [ ] Requirement — Verify normal/large text contrast, meaningful non-text contrast, focus contrast, and control boundaries in both themes using rendered values.
- [ ] Requirement — Do not use low-opacity rules as the only boundary where a boundary is necessary to understand or operate the interface.
- [ ] Requirement — Forced-colors/high-contrast mode retains current/selected/focus/status distinctions.

## Charts and financial data

- Observation — Charts use SVG lines/bars/areas, small legends, color roles, and visual axes; no programmatic data equivalent is encoded.
- [ ] Requirement — Give each chart a concise accessible name/summary and expose all decision-relevant values and quality caveats through a table/list or equivalent non-visual representation.
- [ ] Requirement — Series remain distinguishable without color and at high contrast; legends identify series in text.
- [ ] Requirement — Do not announce decorative grid/animation details; do announce changed range and refreshed/unavailable status appropriately.
- [ ] Requirement — Never expose fabricated demo history as an accessibility fallback; non-visual data must use the same canonical source as the visual chart.

## Motion

- Observation — Prototype entry, bar-growth, line-draw, and fade animations range from 120ms to 1.4s. A “Reduce motion — Follow system” settings row is shown, but no `prefers-reduced-motion` CSS is encoded.
- [ ] Requirement — Honor `prefers-reduced-motion: reduce`, suppress nonessential entrance/draw/grow animation, and render final information immediately.
- [ ] Requirement — No information or action depends on animation, and refresh does not create repeated distracting motion.

## Touch, viewport, zoom, and reflow

- Observation — Many visual controls use roughly 5–9px vertical padding and therefore do not establish a 44px target size.
- [ ] Requirement — Provide at least 44×44 CSS px touch targets or equivalent spacing, including tabs, segmented controls, close, row actions, and chart range controls.
- [ ] Requirement — Support text resize to 200% and zoom/reflow to 400% without loss, overlap, or two-dimensional scrolling except contained two-dimensional data regions.
- [ ] Requirement — Use dynamic/safe viewport handling so top navigation and bottom sheet actions remain reachable around mobile browser chrome and display cutouts.
- [ ] Requirement — Horizontal table scrolling is keyboard/touch operable, labeled when necessary, and does not trap page scrolling.

## Prototype quarantine verification

- [ ] Requirement — Household scope never silently allocates shared values into personal scopes; whole-household truth counts each fact once and personal facts require stable economic-party evidence.
- [ ] Requirement — Investment history, household RBAC, category lifecycle/owner/Other/uncategorized behavior, Planning → Plan behavior, and operational integration claims are governed by approved contracts rather than demo interactions.
- [ ] Requirement — Demo balances, formulas, percentages, forecasts, chart points, and values are excluded from accessibility names, summaries, test fixtures presented as truth, and acceptance criteria.
