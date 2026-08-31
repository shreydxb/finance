# V6 desktop parity matrix

Use at a viewport at least 901px wide; use 1440 × 1200 for primary reference comparison. Each unchecked item is a future implementation QA requirement, not evidence that the static prototype already passes.

## Global shell and navigation

- [ ] PASS/FAIL — A persistent `216px` left navigation and a `max-width:1240px` content region reproduce the prototype hierarchy; main padding is `34px 40px 64px` at the reference viewport.
- [ ] PASS/FAIL — Top-level order is Overview, Money, Wealth, Planning, Settings, with one visually distinct active destination.
- [ ] PASS/FAIL — Money's attention count is subordinate to its label and uses the warning role; it is not the only indication of state.
- [ ] PASS/FAIL — Household scope is visually grouped beneath navigation, defaults to whole-household truth, counts shared facts once, and exposes personal choices only when stable economic-party facts support them.
- [ ] PASS/FAIL — Sidebar status summaries and theme control follow the compact rule-based treatment without introducing elevated/shadowed cards.
- [ ] PASS/FAIL — Keyboard focus can reach every navigation/scope/theme control in a logical order and remains visibly distinct from hover/active state.

## Page hierarchy, type, and density

- [ ] PASS/FAIL — Pages use kicker → `27px` Newsreader title → secondary tabs → controls/content hierarchy.
- [ ] PASS/FAIL — Primary financial figures use Newsreader (or the approved figure-family variant), tabular numerals, and the exact size hierarchy documented in `README.md`.
- [ ] PASS/FAIL — Section kickers/table headers are uppercase `10`–`10.5px` with `.12em`–`.16em` tracking; supporting text remains visually subordinate.
- [ ] PASS/FAIL — Rules, whitespace, and type create grouping; large rounded containers or shadows do not replace the prototype's flat editorial composition.
- [ ] PASS/FAIL — Repeated row and control spacing matches the documented exact values rather than an unrelated application scale.
- [ ] PASS/FAIL — Dark and light themes map all semantic color roles, including focus and disabled/unavailable treatment, without using color alone to convey meaning.

## Overview

- [ ] PASS/FAIL — Header contains date/context, a sentence-style title, and MTD/QTD/YTD segmented controls aligned to the trailing edge.
- [ ] PASS/FAIL — Net-worth hero is the dominant element (`52px`, weight 300), followed by change, period, and scope annotations in descending emphasis.
- [ ] PASS/FAIL — Assets, liabilities, equity share, investments, and daily context form a compact summary strip separated from the hero by spacing/rules.
- [ ] PASS/FAIL — Five period KPIs form equal columns with vertical rules and correctly subordinate hints.
- [ ] PASS/FAIL — Cash-flow composition and savings-rate series reproduce the two-series bars, positive line, grid, axes, labels, and legend layout; data comes only from approved contracts.
- [ ] PASS/FAIL — Upcoming obligations use a horizontal strip with date, name, figure, and status hierarchy; attention is not encoded by color alone.
- [ ] PASS/FAIL — Top spend, recent activity, and accounts appear as a three-column detail region using rule-separated lists, right-aligned values, and working destination links.
- [ ] PASS/FAIL — Provisional, stale, missing, and needs-review qualifiers remain visible wherever canonical data quality requires them.

## Money — Activity

- [ ] PASS/FAIL — Secondary tabs are Activity, Budget, Recurring, Insights in that order, with a `2px` accent underline on the active tab.
- [ ] PASS/FAIL — Search, owner/category/review filters, list/calendar switch, and primary add action share the low-radius outlined control treatment and have accessible names/states.
- [ ] PASS/FAIL — Desktop activity table columns are Date, Merchant, Category, Owner, Account, Amount with `74px 1.5fr 1fr 90px 1fr 120px` geometry and `16px` gaps.
- [ ] PASS/FAIL — Amounts are right-aligned `15px` figure text; metadata is muted; review/transfer/income distinctions have text in addition to tone.
- [ ] PASS/FAIL — Calendar uses seven columns, clear day/spend/bill hierarchy, and a legend whose meaning has a non-color equivalent.
- [ ] PASS/FAIL — Opening a row or add action invokes a correctly titled editing surface without adopting prototype demo write semantics.

## Money — Budget, Recurring, Insights

- [ ] PASS/FAIL — Budget preserves Month/Year segmentation, summary hierarchy, category progress treatment, and the prototype's chart/table density.
- [ ] PASS/FAIL — Budget bars and variance tones expose numeric/text equivalents; budget values and formulas come from approved canonical contracts.
- [ ] PASS/FAIL — Recurring preserves expected-income controls, row hierarchy, fixed/variable summary, history visualization, and table alignment.
- [ ] PASS/FAIL — Insights preserves period controls, comparison bars, annotations, and history table structure without treating prototype narratives/formulas as truth.
- [ ] PASS/FAIL — Empty, unavailable, loading, and error states use application foundations and preserve the page hierarchy even though the prototype does not show them.

## Wealth — Net Worth

- [ ] PASS/FAIL — Net-worth headline (`48px`) and composition strip lead the page; composition has labels and values, not color-only segments.
- [ ] PASS/FAIL — Assets and liabilities use balanced columns, rule-separated rows, right-aligned figures, totals with strong rules, and clear negative treatment.
- [ ] PASS/FAIL — History range controls, chart grid, stacked asset/liability bars, net-worth line, legend, and history table reproduce the documented geometry.
- [ ] PASS/FAIL — The history table has Period, Assets, Liabilities, Net Worth, Change, Saved columns and does not fabricate missing history.

## Wealth — Accounts and Investments

- [ ] PASS/FAIL — Accounts exposes grouping controls and the Account, Type, Owner, Native, AED, Updated table hierarchy with right-aligned monetary columns.
- [ ] PASS/FAIL — Account scope/ownership labels consume approved stable references; visual prototype labels are not financial or authorization contracts.
- [ ] PASS/FAIL — Investments preserves group/range controls, freshness metadata, hero value, allocation cards, performance chart layout, and the horizontally dense holdings table.
- [ ] PASS/FAIL — Historical performance is absent/unavailable unless trustworthy positions and cash-flow history exist; fake prototype history is never shipped.
- [ ] PASS/FAIL — Refresh status and freshness claims reflect observed system evidence rather than hard-coded copy.

## Planning

- [ ] PASS/FAIL — Tabs are Plan, Goals, Debt Payoff, Forecasts in that order.
- [ ] PASS/FAIL — Goals preserve progress hierarchy, target/current figures, dates, and editing affordance without adopting demo values.
- [ ] PASS/FAIL — Debt Payoff preserves ordered rows, balance/rate/progress/debt-free hierarchy, while calculations come from approved debt contracts.
- [ ] PASS/FAIL — Forecasts preserve scenario/mode controls, chart/table visual structure, and assumption-edit affordance while marking incomplete inputs and never adopting demo formulas.
- [ ] PASS/FAIL — Plan is reviewed against its later approved orchestration contract; the prototype's combined Goals/Debt/Forecast sequence is treated as a known visual gap, not complete behavior.

## Settings

- [ ] PASS/FAIL — Tabs are Household and Categories & Rules; extra utilities appear only when separately justified and approved.
- [ ] PASS/FAIL — Household preserves two-column Members/Currency/Integrations/Preferences hierarchy while existing authorization remains authoritative.
- [ ] PASS/FAIL — No prototype permission, invitation, role toggle, backup schedule, sync state, FX freshness, or integration status becomes operational truth without a governing contract/evidence.
- [ ] PASS/FAIL — Categories preserve compact rule-separated list and edit affordance while stable identity/lifecycle contracts govern names, archive/removal, rules, owner semantics, and uncategorized behavior.

## Drawer, controls, and interactions

- [ ] PASS/FAIL — Desktop editor is a right-side `430px` surface over a 45% black overlay with a 1px left rule and no shadow-driven redesign.
- [ ] PASS/FAIL — Drawer hierarchy is kicker, `23px` title, close, optional `36px` amount/currency, labeled fields, chips/owner segment/toggles, primary/cancel/destructive actions, footer.
- [ ] PASS/FAIL — Every styled prototype field is implemented as a semantic labeled control with programmatic value/state and inline error association.
- [ ] PASS/FAIL — Open/close, save/cancel, segmentation, range changes, list/calendar switch, theme, and refresh all provide visible state and keyboard operation.
- [ ] PASS/FAIL — Drawer traps focus, focuses a meaningful first element, closes on Escape where safe, and returns focus to its trigger.

## States, accessibility, and non-contractual content

- [ ] PASS/FAIL — Loading, empty, error, unavailable, stale/provisional, needs-review, success, and permission states are explicitly QA'd even when absent from the prototype.
- [ ] PASS/FAIL — Headings, `nav`, `main`, sections, tables/lists, buttons, tabs, and dialogs use appropriate semantics; visual `div` behavior from the prototype is not copied literally.
- [ ] PASS/FAIL — Text/background, controls, rules that carry meaning, focus indicators, and chart series meet approved contrast requirements in both themes.
- [ ] PASS/FAIL — Animations honor reduced motion; information is stable and comprehensible when entry/draw animation is disabled.
- [ ] PASS/FAIL — Charts have adjacent summaries/data tables or equivalent non-visual access to all decision-relevant information.
- [ ] PASS/FAIL — Demo balances, values, formulas, chart points/history, forecasts, ownership/category/permission behavior, and integration claims are absent from acceptance assertions except when explicitly labeled non-contractual fixtures.
