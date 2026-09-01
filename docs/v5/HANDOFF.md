# SHR-164 implementation handoff

Status: fresh V6 Money → Activity screen implemented on a bounded branch off
the V6 integration branch. Ready for independent UI and transaction-safety
review. Not merged, not approved, not deployed.

## Git and release boundary

- Issue: `SHR-164 — Fresh Activity screen: list, calendar and transaction drawer`.
- Branch: `claude/shr-164-v6-activity`, cut from `origin/v6`.
- Base: `d8f9cbad06b92f9981e24492cbc56bc6b857cfd4` — `origin/v6`, fetched and
  verified at implementation start; it carries SHR-155 as expected.
- **PR targets `v6`, not `main`.** `main` was neither read from as a base nor
  written to; it remains at `ab29755971ee92f644a8e820bb944c8a4f599a18`.
- Migrations: **none**. No file under `supabase/` was created, edited or
  deleted, so `npm run test:db` was not run.
- Supabase production: **untouched**. No migration applied, no RPC deployed, no
  production row read or written from this session. Production remains through
  migration 044.
- Netlify: no production deploy and no project setting changed. The
  repository's own PR integration produces a non-production Deploy Preview.

## What was built

`/money/activity` now renders `src/v6/ActivityScreen.jsx`, composed fresh from
the frozen prototype inside the SHR-155 V6 boundary. `src/screens/Transactions.jsx`
is retained in the repository but is no longer imported or mounted anywhere in
`src/App.jsx`.

### Routes

| Path | Component |
|---|---|
| `/money/activity` (screen key `Transactions` → `Activity`) | `src/v6/ActivityScreen.jsx` |
| `/money/activity/:uuid` | same screen, drawer open on that entry |
| `?view`, `?search`, `?category`, `?owner`, `?sort`, `?needsReview`, `?year`, `?month` | deep-linked Activity state, sanitised by the route contract |

`view`, `year` and `month` are new entries in the `/money/activity` query
rules. Everything already there is unchanged.

### Components and modules

- Screen: `src/v6/ActivityScreen.jsx`
- Presentation: `src/v6/activity/{ActivityHeader,ActivityControls,ActivityList,ActivityCalendar,TransactionDrawer}.jsx`
- Data (pure): `src/v6/data/{activityModel,composeActivity,activityPeriods,activityGaps}.js`
- Data (Supabase-bound): `src/v6/data/useActivityData.js` over the existing `canonicalReads.js`
- Shared: `src/v6/data/slots.js` — the value-slot vocabulary, extracted from
  `overviewModel.js` so both screens use one definition
- Fixtures and preview: `src/v6/fixtures/activityFixture.js`,
  `v6-activity-preview.html`, `src/v6-activity-preview.jsx`
- Docs: `docs/v6/ACTIVITY_CONTRACT_GAPS.md`

### V6 primitives reused and created

Reused unchanged from SHR-155: `Slot`/`slotState` (`FigureSlot`, `SlotNote`,
`UnavailableRegion`), `Section`, the `.v6-` token-scoped stylesheet, `format.js`,
and the slot vocabulary. Reused from SHR-152: the responsive shell, and
`DetailShell`'s drawer focus trap, background inertness, Escape handling and
focus return.

Created: the Activity table, calendar grid, filter/segmented controls, the
`v6-unsupported-action` treatment for a control whose contract does not exist,
and the drawer's field-list composition — all as `.v6-` scoped CSS plus local
components, none of it importing legacy presentation.

### One shared-code fix

`src/shell/DetailShell.jsx`'s scrolling body was not keyboard reachable and had
no accessible name. Activity is the first detail surface with enough content to
scroll, so axe's `scrollable-region-focusable` rule caught it. Fixed with
`role="region"`, an `aria-label` from the drawer title, and `tabIndex={0}`.
This is a proven defect in shared infrastructure, fixed rather than worked
around; every detail drawer benefits.

## Data truth

Connected canonical sources and every deliberately withheld capability are
tabulated in `docs/v6/ACTIVITY_CONTRACT_GAPS.md`. In short: rows, amounts,
labels, classification, review state and quality come from
`v_canonical_ledger_aed`; account names from `v_canonical_accounts_aed`; period
spend and income from `canonical_period_metrics`.

No financial semantics are created in the browser. Filtering and sorting narrow
the canonical rows already read; nothing is summed, averaged, paired, linked or
re-derived. Calendar cells report how many canonical entries fall on a day — a
cardinality, not money.

Nothing is inferred: not economic-party attribution, not shared allocation, not
category identity from text, not transfer pairing, not refund linkage, not
transaction correctness, and not attention priority. Quality facts are shown as
facts on their row and are never ranked or aggregated into a queue — the
SHR-155 separation holds.

## Read-only, by decision

Add, edit, delete, split and mark-reviewed are rendered as visible, disabled
controls that name their missing contract. None is wired to
`src/lib/transactions.js` or any other legacy writer. `buildCapabilities()`
reports every capability `unavailable`, and `isWriteEnabled()` is `false`.

## Validation actually run

| Command | Result |
|---|---|
| `npm run lint` | exit 0 |
| `npm test` | **706 passing** — 575 node (base 555, **+20**) and 131 vitest (base 106, **+25**) |
| `npm run test:visual` | 20 passing, including all 10 new Activity tests |
| `npm run build` | exit 0 |
| `npm audit --audit-level=high` | 0 vulnerabilities |
| `git diff --check` | clean |
| `npm run test:db` | **not run** — no SQL or backend file changed |

Base counts were measured in a clean worktree of `d8f9cba`, so the deltas are exact.

### Visual-test environment note

Unchanged from SHR-155: this container ships Chromium build 1194 while
`@playwright/test@1.62.1` expects 1234, so Playwright was pointed at
`/opt/pw-browsers/chromium` through a session-local config that is **not**
committed. Three tests — `foundation.spec.js` (both) and the `shell.spec.js`
screenshot — already fail here at the base commit `d8f9cba`, verified in a
clean worktree. That is pre-existing and environmental, not introduced by this
branch: the base run is 10 passed / 3 failed, this branch is 20 passed / 3
failed. Pixel baselines for Activity are therefore deliberately not committed;
`tests/visual/v6-activity.spec.js` asserts browser-build independent facts.

### Desktop, mobile and accessibility evidence

`tests/visual/v6-activity.spec.js`:

- Renders at 1440×1200, 900px and 390px in light and dark; body paints its own ground.
- Desktop keeps all six columns; the calendar keeps seven.
- Mobile hides Owner and Account exactly as the prototype encodes, and the test
  proves both remain reachable in the row's drawer; calendar cells drop to 64px.
- No page-level horizontal overflow in list or calendar at 1440/900/768/390/**320**px,
  nor at **200% text zoom**; the dense table contains its own overflow.
- Every control in `main` is ≥44px tall at phone width.
- The drawer traps focus across 12 tabs, focuses its title on open, closes on
  Escape and returns focus to the invoking row.
- A deep-linked drawer is full width (390px) on a phone and closes back to the list.
- No write control is operable, on the screen or in the drawer.
- Reduced motion leaves nothing mid-animation, and axe is clean in that mode.
- **axe: zero violations** across desktop and phone × light and dark × list,
  calendar and drawer — 12 combinations.

## Reviewer checks

1. Desktop 1440×1200 and mobile 390/320 against `DESKTOP_PARITY.md` and
   `MOBILE_PARITY.md`. `/v6-activity-preview.html` renders the real screen
   against non-contractual fixtures with no Supabase session, and honours the
   address bar (`?view=calendar`, `?detail=<uuid>`, filters).
2. Every unavailable state: is the reason true, and is the named contract right?
3. Transaction safety: confirm no path can write, and that the disabled
   affordances are the right ones to expose.
4. Signed-in behaviour against real data — this session had no Supabase
   session, so Activity has never been rendered against the live ledger.

## Risks

- Activity has not been rendered against live canonical data. Contract drift
  would surface as an honest unavailable state rather than a wrong number, but
  the happy path is unverified live.
- Search and filters cover only the loaded month. That is stated on the screen,
  but it is the behaviour most likely to be misread, and SHR-163 should close it.
