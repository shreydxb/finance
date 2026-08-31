# V6 visual reference

Status: authoritative visual reference for SHR-151. It is an implementation aid for SHR-152 and later bounded UI issues, not an implemented product contract.

## Authoritative artifact

| Field | Value |
|---|---|
| User-supplied source filename | `Our Money - Command Center.dc_v4.html` |
| Repository reference path | `docs/v6/reference/Our Money - Command Center.dc_v4.html` |
| Byte count | `181685` |
| SHA-256 | `934BC925DB39B7EFBD34379C1199B9100F0F7F7E377FD152435F4A1BE85F91CB` |
| Preservation result | Source and repository copy are byte-identical |

The HTML is preserved byte-for-byte. Do not format, normalize, repair, or use it as an application entry point. It depends on the authoring environment's `support.js`; that dependency is not part of this reference package.

## Authority boundary — read this first

The artifact is authoritative for visual direction: hierarchy, composition, density, typography, color roles, borders, spacing, responsive transformations, and interaction presentation.

**All demo financial content and behavior are NON-CONTRACTUAL.** This includes balances, transactions, budgets, net-worth values, percentages, formulas, chart history and points, forecasts, account balances, investment returns, income assumptions, ownership assumptions, category behavior, household permission behavior, integration status, and any interaction that conflicts with an approved V6 contract. Product implementations must consume approved canonical contracts and current authorization behavior; they must never reverse-engineer financial rules from this file.

## Information architecture

The intended V6 hierarchy is:

- **Overview**
- **Money** — Activity, Budget, Recurring, Insights
- **Wealth** — Net Worth, Accounts, Investments
- **Planning** — Plan, Goals, Debt Payoff, Forecasts
- **Settings** — Household, Categories & Rules, and justified utilities only

The artifact explicitly encodes every listed top-level destination and tab except that Settings has only `Household` and `Categories & rules`; currency/rates, integrations, and appearance are regions within Household rather than separate utilities. The artifact's `Planning > Plan` tab renders a combined sequence of Goals, Debt payoff, and Forecast content. It does not fully define the final orchestration workspace; absence of further Plan behavior is a known reference gap, not a product decision.

## Exact visual tokens encoded by the artifact

Values in this section are copied from HTML/CSS. Values described later as observations are not tokens.

### Type

| Role | Exact encoding |
|---|---|
| UI sans | `IBM Plex Sans`, weights 400/500/600 |
| Editorial/financial figures | `Newsreader`, optical-size family, weights 300/400/500 |
| Optional figure variant | `IBM Plex Mono`, weights 400/500 |
| Root UI size | `13px` |
| Brand | Newsreader `19px` |
| Page title | Newsreader `27px`, weight 400 |
| Overview hero | Newsreader `52px`, weight 300, `line-height:1.1`, `letter-spacing:-.015em`; `38px` at `max-width:900px` |
| Wealth hero | Newsreader `48px`; Investments hero `46px`; drawer amount `36px` |
| KPI values | Newsreader `26px`; secondary/card values occur at `20px`, `22px`, and `17px` |
| Table/list values | Newsreader `15px`; total values occur at `16px`/`17px` |
| Body/list text | primarily `12.5px`; controls commonly `11px`–`12px` |
| Section kicker/table header | `10px` or `10.5px`, uppercase, `letter-spacing:.12em`–`.16em` |
| Supporting text | `10.5px` or `11.5px`; explanatory notes often `line-height:1.5` |
| Numerals | body sets `font-variant-numeric:tabular-nums` |

Line heights not explicitly set use browser/font normal line height; do not invent a numeric token for them.

### Color roles

| Role | Dark | Light |
|---|---|---|
| Canvas | `#0d0c0a` | `#f8f5ef` |
| Raised tint | `rgba(242,237,228,.035)` | `rgba(26,23,18,.028)` |
| Primary ink | `#f2ede4` | `#1a1712` |
| Secondary ink | `#9d9385` | `#6b6255` |
| Tertiary ink | `#6f665a` | `#8d8478` |
| Rule | `rgba(242,237,228,.09)` | `rgba(26,23,18,.12)` |
| Strong rule | `rgba(242,237,228,.16)` | `rgba(26,23,18,.22)` |
| Positive | `#8fae7f` | `#4a7a52` |
| Negative | `#c2726b` | `#a8443c` |
| Warning | `#c99a52` | `#8a6320` |
| Neutral chart bar | `rgba(242,237,228,.2)` | `rgba(26,23,18,.16)` |

Accent pairs selectable by the prototype are Copper `#c98b52`/`#9c5d26`, Sage `#8fae7f`/`#416b49`, Slate blue `#93aac9`/`#3d5f86`, and Gold `#d0b26a`/`#7d6018` (dark/light). Copper is the default. Active fills use `color-mix(... accent 14% or 16%, transparent)`; primary button hover/selected fill uses 18%.

### Geometry, spacing, and motion

- Canvas/surfaces are predominantly flat. No box-shadow is encoded.
- Borders are 1px rules; tabs use a 2px active underline. Chart series use 1.2px, 1.4px, or 1.6px strokes.
- Controls use `2px` or `3px` radii; compact sidebar cards use `4px`; status dots use `99px`. Large rounded card geometry is not part of this reference.
- Repeated control padding is `7px 12px` or `7px 13px`; primary drawer actions use `9px 16px`; rows commonly use `11px`, `12px`, `13px`, or `14px` vertical padding.
- Repeated gaps include `4`, `6`, `8`, `10`, `12`, `14`, `16`, `20`, `22`, `26`, `28`, `36`, `40`, `44`, and `48px`. These are observed exact values, not a normalized spacing scale.
- Desktop sidebar is `216px`, sticky, full viewport height, with `26px 0 22px` padding.
- Main content is `max-width:1240px`, `padding:34px 40px 64px`, with `min-width:0`.
- The reference preview metadata is `1440 × 1200`; the shell sets `min-height:1000px`.
- Interaction transitions are 120ms or 140ms. Entry/draw animations range from 180ms to 1.4s and use `cubic-bezier(.16,1,.3,1)` where specified.

### Component and hierarchy observations

- The design uses editorial whitespace and rules more than filled cards. Bordered cards are reserved for compact status, allocation, and settings summaries.
- Page hierarchy is kicker → serif title → secondary tabs → page controls → hero/summary → detailed charts/tables/lists.
- Navigation is text-first. Icons are limited to text glyphs/arrows (`▲`, `→`, `←`, `+`, a small dot); no icon library or icon container token is encoded.
- KPI groups are separated by vertical rules on desktop and stack with horizontal rules below 900px.
- Tables use uppercase micro headers, right-aligned tabular figures, muted metadata, and one-pixel row rules. Wide tables intentionally overflow horizontally on narrow screens.
- Charts use rule-based grids, compact legends, accent bars/areas, positive lines, and direct labels. The file encodes presentation only, not valid historical data.
- Buttons are low-radius outlined controls; accent borders indicate primary creation/save actions. Segmented controls use the same outline vocabulary.
- The drawer uses a fixed dim overlay `rgba(0,0,0,.45)`, right alignment, `430px` width, a 1px left border, and `26px 28px 30px` padding. At 900px and below it becomes full width with no left border.
- Drawer “fields” are styled `div` elements with bottom rules, not semantic inputs/selects. This is a visual observation only; implementations require real labeled controls.

## Responsive behavior encoded by the prototype

The sole encoded breakpoint is `max-width:900px`.

- Shell changes from row to column.
- Sidebar becomes a static full-width top region with a horizontally scrollable, equal-width top navigation row; status cards disappear.
- Scope and theme/footer controls remain in the top region; this is not a bottom-navigation pattern.
- Main padding becomes `22px 18px 80px`.
- Two-, three-, and five-column grids become one column with `26px` gaps.
- Hero value becomes `38px`; hero-side metrics left-align.
- KPI strips wrap; dividers change from right rules to top rules.
- Table wrappers scroll horizontally and direct children receive `min-width:660px`.
- Activity rows become `64px 1fr 96px`; category/owner/account cells marked `.om-hide-sm` disappear.
- Calendar cells reduce to at least `64px` high with `6px 7px` padding.
- Drawer becomes full-width.

The prototype does not encode a separate small-phone breakpoint, bottom navigation, safe-area padding, container-query behavior, or explicit reflow for every chart label. Those are implementation requirements/gaps, not implied exact tokens.

## Represented and absent states

Represented observations include active/hover navigation and controls, positive/negative/warning tones, “needs review”, provisional/stale-data notes, completed attention items (reduced opacity), refresh-in-progress label behavior, list/calendar and month/year switches, dark/light themes, and open/closed drawer state.

No explicit empty, skeleton/loading, blocking error, offline, unavailable-chart, permission-denied, or validation-error composition is encoded. Future implementations must use existing application foundations and issue-specific contracts for those states; they must not claim parity by inventing a prototype state.

## Six quarantined prototype exceptions

1. **Shared / household scope.** The prototype contains a prohibited half-shared allocation model. Do not implement it. “Both” means whole-household truth counted once. Personal scopes require explicit stable economic-party facts; shared facts are not duplicated into both personal scopes. There is no historical 69/31 allocation, and the contract must be N-party capable.
2. **Investments.** Generated desktop investment history and performance are fake demo data. Historical charts require trustworthy position and cash-flow history. Only the layout is a visual reference.
3. **Household RBAC.** Member permissions, invitations, and role toggles are presentation examples only. Existing authorization remains authoritative until an approved contract changes it.
4. **Category semantics.** Prototype hard-delete, default-owner, `Other`, fake-uncategorized, and rule behavior are not canonical. Stable category contracts and later category UI issues govern behavior.
5. **Planning → Plan.** The final orchestration workspace is not fully represented. Its gap is not a product decision.
6. **Integration claims.** Hard-coded backup, refresh, FX, net-worth scheduling, sync, and operational status claims are non-contractual when they conflict with observed production reality. Only visual treatment may be referenced.

## Backend and release boundary

SHR-151 does not modify or reinterpret migrations `045`–`049`. Production remains verified through migration `044` unless separately refreshed read-only evidence says otherwise. Merged SHR-194/SHR-154 capability packages and their unapproved production manifests are unchanged. This package performs no code, schema, production, or deployment action.

## QA documents

- [Desktop parity matrix](DESKTOP_PARITY.md)
- [Mobile parity matrix](MOBILE_PARITY.md)
- [Accessibility checklist](ACCESSIBILITY.md)
