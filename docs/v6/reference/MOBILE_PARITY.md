# V6 mobile parity matrix

The prototype has one responsive rule at `max-width:900px`; it demonstrates a top-navigation transformation, not a native mobile bottom bar. Run QA at 900px, 768px, 390px, and 320px widths and in portrait/landscape. Items beyond the prototype's exact CSS are labeled implementation requirements.

## Shell and navigation

- [ ] PASS/FAIL — At 900px and below the shell changes to a column and the sidebar becomes a static, full-width top region with a bottom rule and `16px 0 14px` padding.
- [ ] PASS/FAIL — Top-level destinations remain in source order within a horizontally scrollable equal-width row using `12.5px` labels and `9px 6px` padding.
- [ ] PASS/FAIL — Navigation can scroll without clipping focus indicators; the current destination and attention count remain programmatically exposed.
- [ ] PASS/FAIL — Compact runway/data-quality sidebar cards are hidden as encoded; their decision-relevant information is available in page content or an approved alternative, not silently lost.
- [ ] PASS/FAIL — Household scope remains visible and uses whole-household truth counted once; personal scopes appear only when stable economic-party facts support them.
- [ ] PASS/FAIL — Theme/footer controls remain operable without obstructing navigation.
- [ ] PASS/FAIL — If SHR-152 adopts a native bottom-navigation pattern, that deviation is explicitly reviewed against its contract; it is not claimed to be exact prototype parity.

## Viewport, stacking, and information priority

- [ ] PASS/FAIL — Main content uses `22px 18px 80px` padding at the encoded breakpoint and never causes page-level horizontal overflow.
- [ ] PASS/FAIL — `.om-g2`, `.om-g3`, and `.om-g5` regions become one column with `26px` gaps; reading order matches desktop information priority.
- [ ] PASS/FAIL — Overview hero reduces from `52px` to `38px` without clipping currency/value text at 320px or 200% zoom.
- [ ] PASS/FAIL — Hero-side metrics left-align and wrap without separating labels from their values/actions.
- [ ] PASS/FAIL — KPI strips wrap into usable blocks with top rules, no residual right rules, and no stranded one-word columns.
- [ ] PASS/FAIL — Dense actions wrap in priority order: primary action remains discoverable, filters/switches remain understandable, and no control overlaps.
- [ ] PASS/FAIL — Document and drawer respect `100dvh`/safe viewport behavior and device safe areas as an implementation requirement; the prototype does not encode safe areas.

## Tables and lists

- [ ] PASS/FAIL — General wide table wrappers scroll horizontally and their direct content remains at least `660px` as encoded, with an obvious scroll affordance and preserved keyboard access.
- [ ] PASS/FAIL — Activity rows use the encoded `64px 1fr 96px` layout; Category, Owner, and Account visual columns hide below 900px while their information remains available in row detail/accessible text.
- [ ] PASS/FAIL — Amounts remain right-aligned, dates/merchants do not collide, and review/positive/negative state is conveyed in text as well as color.
- [ ] PASS/FAIL — Investments' `860px` holdings content and other dense tables can be reached and read without trapping horizontal or vertical scroll.
- [ ] PASS/FAIL — Calendar remains seven columns with cells at least `64px` high and `6px 7px` padding; day, spend, and bill text remain distinguishable at narrow widths.
- [ ] PASS/FAIL — Where an implementation intentionally transforms a table into cards/lists, every desktop field remains available and the deviation is documented; the prototype itself mostly uses horizontal overflow.

## Charts

- [ ] PASS/FAIL — Charts fit their containing region without page overflow, preserve axis/series/legend association, and do not render illegible labels at 320px.
- [ ] PASS/FAIL — Range/mode controls wrap without reducing targets below the approved minimum.
- [ ] PASS/FAIL — Decision-relevant chart facts have a text/table equivalent that reflows independently of the SVG/canvas.
- [ ] PASS/FAIL — Missing or untrustworthy history produces an explicit unavailable/incomplete state; fake investment or net-worth points are never substituted.
- [ ] PASS/FAIL — Chart entry/draw animation is disabled under reduced-motion preference without hiding the final state.

## Drawer/sheet and forms

- [ ] PASS/FAIL — At 900px and below the drawer is full-width and removes its left border as encoded.
- [ ] PASS/FAIL — The implementation constrains the sheet to the safe dynamic viewport, keeps its title/close action reachable, and prevents background scroll.
- [ ] PASS/FAIL — Field grids collapse when necessary so labels, values, help, and errors do not clip at 320px or 200% zoom.
- [ ] PASS/FAIL — Real input/select/checkbox/radio controls replace visual `div` controls and expose names, values, required state, and errors.
- [ ] PASS/FAIL — Opening moves focus into the sheet; Tab/Shift+Tab stay within it; Escape closes when safe; closing returns focus to the trigger.
- [ ] PASS/FAIL — Destructive action placement and copy follow approved product contracts, especially category lifecycle; prototype hard-delete affordances are quarantined.

## Touch, focus, and motion requirements

- [ ] PASS/FAIL — Interactive targets are at least 44×44 CSS px or have equivalent non-overlapping target spacing. The prototype's visual buttons are often smaller and do not establish a compliant target token.
- [ ] PASS/FAIL — Visible focus is never clipped by horizontal scrollers, sticky/top regions, overflow wrappers, or sheets.
- [ ] PASS/FAIL — Touch, keyboard, screen-reader, and switch access can operate navigation, tabs, segmented controls, filters, chart ranges, rows, and sheets.
- [ ] PASS/FAIL — Hover-only styling is not required to discover an action or state.
- [ ] PASS/FAIL — Theme and reduced-motion preferences follow system/user choice and persist only through approved settings behavior.

## Screen coverage

- [ ] PASS/FAIL — Overview preserves hero → KPIs → cash flow → obligations → spend/activity/accounts reading order.
- [ ] PASS/FAIL — Money Activity, Budget, Recurring, and Insights preserve their desktop hierarchy after stacking and expose all actions/states.
- [ ] PASS/FAIL — Wealth Net Worth, Accounts, and Investments preserve headline/composition/detail priority; dense data uses controlled overflow or a reviewed equivalent.
- [ ] PASS/FAIL — Planning tabs remain usable; Plan is treated as a known reference gap and is not inferred from the stacked demo sections.
- [ ] PASS/FAIL — Settings Household and Categories & Rules preserve hierarchy without implementing fake RBAC, category semantics, or operational claims.

## Zoom, reflow, and non-contractual content

- [ ] PASS/FAIL — At 400% zoom, content reflows to a single logical column except genuinely two-dimensional tables/charts with contained scrolling.
- [ ] PASS/FAIL — No fixed element obscures focused content; browser zoom and text enlargement do not require two-dimensional scrolling for ordinary prose/forms.
- [ ] PASS/FAIL — Orientation change preserves state and focus, and no viewport-unit sizing cuts off actions.
- [ ] PASS/FAIL — Demo financial values, formulas, histories, forecasts, ownership allocations, role toggles, category behavior, and integration claims are not used as mobile implementation contracts.
