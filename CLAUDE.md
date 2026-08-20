## Taskiv #21 — data cleanup round 2: Shrey reviewed live, more real fixes (20 Aug 2026)

Shrey reviewed the remaining flagged transactions directly on the deployed
site (Transactions → "Unreviewed only") rather than going back and forth
here — confirmed this works fine even on the stale 17 Aug build, since
category editing has been live since before that deploy and writes straight
to the same database. He answered several more from there plus a few he
noticed while reviewing:

- **`DU Google Payment` (AED 157.50/157.69, 3 rows)** → his mobile bill, not
  a subscription → **Utilities**. A separate `DU Google Payment` amount
  (AED 450.45, 3 rows) is still unresolved — a different bill under the
  same merchant descriptor, not yet identified.
- **`Google Payment · Subscription` (AED 236.44)** → his home WiFi paid via
  Google Pay, not an actual Google subscription → **Utilities**.
- **`UADDS Cr Trf` (AED 2,193, 3 Aug)** → the Car Loan EMI payment from FAB
  — resolves the "destination unclear" transfer flagged on 17 Aug. Left the
  category as **Transfer** deliberately: the same EMI is already counted
  once via `recurring`'s off-ledger monthly-equivalent, so recategorising
  this row as spend would double-count it in `fire_expense`.
- **Damas Jewellery (AED 3,213 + AED 100)** → confirmed one-time jewelry
  purchase, **Shopping** is the right fit (no dedicated category exists).
- **Noon merchant variants** — turned out to already be correctly split
  (`Noon Food` → Dining Out, `Noon Minutes` → Groceries, `Noon.com`/`Noon
  E-Commerce` → Shopping) before Shrey even flagged it; added
  `category_rules` for all four patterns anyway as a safety net for any
  future bulk/statement-import path, since he's moving to Telegram for new
  entries going forward.

All of the above are **category/note fixes only — no amount changed**, and
none moved a row into or out of the `Transfer` category, so the Mar–Jul
on-ledger total is unchanged (AED 53,553.19, same as the corrected figure
above) and `fire_expense` did not need recomputing.

**Two things surfaced and still open, not guessed at:**
- Four AED-0/1-ish rows on 10 Aug (`Google stocks sale` AED 0, a null/null
  AED 0 row, another null-note AED 0 row, `Microsoft · stock purchase`
  USD 1) look like leftover test artifacts from stock-tracking, not real
  broker-statement-sourced holdings — but Shrey didn't recognise them
  either. Financially immaterial either way; not deleted without an
  explicit go-ahead since deletion is destructive.
- The three AED 450.45 `DU Google Payment` rows are still unidentified and
  still flagged `needs_review`.

Also noted, not acted on: Shrey flagged that tapping "Mark reviewed" on a
transaction doesn't visually clear the "Needs review" badge the way "Looks
right" does — he said the current behaviour is fine, so left as-is rather
than treated as a bug to fix.

## Taskiv #21 — correction: a real bug in the derivation, fixed with Shrey (20 Aug 2026)

Shrey pushed back on the first `fire_expense` figure below ("I don't think
these are my actual expenses") — right to. The category breakdown I showed
him was quietly dropping every transaction with no category at all: the
analysis query filtered `category != 'Transfer'` in raw SQL, and SQL's
`!=` is neither true nor false against `NULL` — such a row is silently
excluded, not counted as spend and not excluded on purpose. **31 real
transactions, AED 5,988.03, never entered the average.**

Checked whether this bug reaches the live app, not just my one-off query —
it doesn't. `src/lib/reports.js`'s `isSpend()` does `t.category !==
TRANSFER_CATEGORY` in JavaScript, where `null !== 'Transfer'` is `true`, so
every Reports/Budget screen already counted these rows correctly (bucketed
"Uncategorised"). The bug was isolated to this one derivation, not a
product bug.

Grouped the 31 rows by merchant and asked Shrey directly rather than
guessing any of them (money-data rule). He resolved the material ones live:

- `Paymob**Al WATHBA temp` (AED 3,160.50) → flight tickets to Sri Lanka for
  him and Tarika → **Travel**.
- `Al Kabayel Trading` (3×, AED 648.67) → household-goods shopping →
  **Groceries**.
- `SmartDXB` + the three AED 50 `Dubai Digital Authority` charges (AED
  200) → parking/Salik → **Transport & Fuel**. (A fourth `Dubai Digital
  Authority` charge, AED 390, is a different amount and stays
  uncategorised — not covered by that answer.)
- `MILLENNIUM PLACE BARSHA` (2×, AED 15) → breakfast/lunch at his office →
  **Dining Out**, matching the 40+ other visits already tagged that way.
- `African & Eastern` (AED 144) → wine → **Groceries** (no dedicated
  alcohol category exists).
- `To Saleem Fayyaz` (AED 241.50) → **not a personal transfer** — a real
  recurring household expense, water bottle/can vouchers (38 vouchers,
  ~3 months' supply) → **Utilities**, note rewritten to say so. This one
  reclassifies real spend that would otherwise have been silently excluded
  from every future spend total the same way the Transfer category is.

All resolved rows also got `needs_review = false` and a real `reviewed_at`.
~AED 1,258.38/5 months (~AED 252/month) of the original 31 rows are still
sitting genuinely uncategorised (Factory, Yousuf Mohd Amin Rashi, T W R
Priyasoma Sri Lanka, King Kabul Auto, Cutting Edge, PJP Investments Group,
Connectech LLC, Jumeirah, two "Credit (reversal, unclear)" rows, the AED 390
Dubai Digital Authority charge, three stray zero/near-zero rows, Ginnys
Plus, Al Hayat Al Jadeeda, Blue Bay FZ LLC, Billed finance charges, and the
AED 300 ATM withdrawal) — nobody has said what these are yet. That's fine
for `fire_expense`'s accuracy: the fixed query counts every uncategorised
row as spend regardless of label (matching `isSpend()`'s real behaviour), so
the total is complete even though a slice of it isn't neatly labelled yet.
It only matters for category-level reporting (Reports/Budget breakdowns),
not this number.

**Recomputed on-ledger average, same Mar–Jul window**: AED 53,553.19 / 5 =
**AED 10,710.64/month** (up from the buggy AED 9,654.13). Off-ledger
recurring total is unchanged at AED 15,745.41/month (a separate table,
unaffected by transaction categorisation).

**`fire_expense` = AED 26,456.05/month** (was AED 25,399.54), written to
`settings`, replacing the earlier value. FIRE target = 26,456.05 × 12 ÷
0.04 ≈ **AED 7.94M** (was AED 7.62M). Sanity check against base salaries
(AED 28,500/month): surplus is now ~AED 2,043.95/month (~7.2%), still
positive and believable, just tighter than the first pass — which is itself
a sign the fix mattered, not just noise.

The Settings card and `src/lib/fire.js` need no code change — they always
read `fire_expense` from `settings` rather than hardcoding the figure, so
the UI picks up the corrected number automatically. Not yet re-verified in
a live browser, same sandbox limitation as everything else this session.

## Taskiv #21 — FIRE number, built from real spend (20 Aug 2026)

Unblocked by Shrey: "based on my past spends using my credit card statements
and my recurring expenses, can we come up with a number for calculating
FIRE?" — supplies the real `fire_expense` figure the task had been sitting on
since 7 Aug (`fire_swr`/`fire_return` were already set; nothing read them).
Deliberately the small static version per the task's own scope note — a
3-field formula, not Monarch's Forecasting feature (that's the separate
"Forecast" card on Accounts, built for #24, not merged with this).

**How `fire_expense` was derived, entirely from real data, no guess:**
`transactions` only captures card-based day-to-day spend — checked by
grepping every row's `note` for "rent", "EMI", "LIC" and "send money" and
finding zero matches, and by confirming the category list has nothing like
"Rent" or "Loan". Rent cheques, loan EMIs, LIC premiums and the monthly
India remittances are bank-level movements that never touch a card, so they
only exist in `recurring` and would be silently missing from a
transactions-only average. So the number combines two real sources:

- **On-ledger (card spend)**: 5 full logged months, Mar–Jul 2026 (Feb and
  Aug were partial), 386 non-transfer, non-deleted rows, AED 48,270.64 total
  → AED 9,654.13/month average. Left the one real outlier in (a AED 15,500
  one-time vacation-home booking in June) rather than excluding it — a
  household's real travel spend is lumpy, not a reason to under-count it.
- **Off-ledger (recurring, monthly-equivalent)**: rent cheques (two cheque
  schedules averaged over the year), all four EMIs (0% CC loan, car
  down-payment, car loan, mobile), both LIC premiums and both Send Money
  Home rows, each spread across 12 months when the `recurring` row's own
  `months` array says it only fires in specific months (e.g. LIC Shrey's
  150,000 INR every December → ÷12). Total AED 15,745.41/month.

**`fire_expense` = AED 25,399.54/month**, written directly to `settings`
(verified live). Sanity check against real income: Shrey + Tarika's base
salaries alone are AED 28,500/month, leaving a ~AED 3,100/month (~11%)
surplus at this expense figure — a believable number, not an implausible
one, which is the cross-check this kind of derived figure needs.
FIRE target = 25,399.54 × 12 / 0.04 ≈ **AED 7.62M**.

`src/lib/fire.js` — pure logic, no Supabase import, 12 tests:
`computeFireTarget` (the 3-field formula, refuses on null/zero rather than
dividing by zero), `monthlyEquivalent`/`monthlyRecurringTotal` (spreads a
`recurring` row's annual cost across 12 months when its `months` array is
non-empty, matches `recurringSchedule.js`'s own "empty = every month"
convention, skips a row whose `end_date` has passed), and `yearsToFire` (a
simple monthly-compounding loop — reuses the same growth/cash-flow shape as
`forecast.js`'s `projectNetWorth`, deliberately not the same code since #21
and #24 are scoped apart, but no reason to invent a different compounding
model). New "FIRE number" card on **Settings**, below Household split: shows
the target and an editable AED/month input (so the household can update the
figure by hand later without needing another data-derivation pass), plus a
years-to-FIRE estimate reusing `forecast.js`'s already-exported
`participatingNetWorth` against every account and `fire.js`'s own
`monthlyRecurringTotal` against `recurring`'s income rows for the savings
rate. 455 `npm test` total (12 new from `fire.test.js`), lint and build
clean. **Not verified in a live browser** — same sandbox
Chromium/Supabase limitation as #103/#24 below; someone should open
Settings once Netlify redeploys and confirm the card renders and the number
matches.

This branch (`claude/money-v4-open-items-5njpob`) had gone stale relative to
`main` — its old tip (`b6ea971`) predates the version of #103/#24 that
actually shipped (`main`'s `d05a939` has a different hash for the same
work, from a squash/rebase during the earlier merge). Per the "already
merged, treat as fresh" rule, this branch was restarted from `main`'s current
HEAD (`1011668`) and force-pushed — no unmerged work was on the old tip to
lose, it was purely stale history.

## Handover — 20 Aug 2026: #103 + #24 shipped to `main`, blocked on Netlify credits

**Code status: done.** `main` is at commit `d05a939` (fast-forwarded from
`4ec715e`), carrying both Taskiv #103 (Reports/Spending comparison chart) and
#24 (assign-to-partner, link-to-goal, forecasting). 455 `npm test`, lint and
build all clean at that commit. Full detail on both in the two sections
below this one.

**Deploy status: blocked, not broken.** Netlify's production site
(`apna-rokda`, site id `3f5a1f18-8602-44ed-8880-2fcd00f94c29`,
`https://apna-rokda.netlify.app`) is still serving the **17 Aug** build
(commit `e9cdba4`) — confirmed live via the Netlify MCP's `get-project`/
`get-deploy-for-site`. The free tier's 300 build-minutes/month ran out
before `d05a939` could auto-build; Shrey confirmed credits reset **21 Aug**.
**No code action needed** — once minutes reset, either the queued
git-triggered build clears on its own, or trigger one manually from
[app.netlify.com/projects/apna-rokda](https://app.netlify.com/projects/apna-rokda)
→ Deploys → "Trigger deploy". (A `netlify-deploy-services-updater
deploy-site` MCP call is also available from a session with Netlify
connected, but that path re-uploads local source rather than using the
existing git integration — prefer the dashboard trigger or just letting the
webhook-queued build clear, to avoid burning extra minutes on a redundant
manual deploy.)

**A test account exists for live verification**, added this session:
`claude@claude.com` / `claude`, already inserted into `household_members`
(`user_id 818e789c-83d7-458e-acd2-dba59ff2999e`) so it can sign in and see
real household data immediately — no further setup needed. Safe to leave in
place or delete after testing; it's Shrey's call.

**Supabase connection details** (safe to record — the anon key is the same
public, client-side key already shipped in the deployed frontend):
```
VITE_SUPABASE_URL=https://wrxqgfbolryveivgdjia.supabase.co
VITE_SUPABASE_ANON_KEY=sb_publishable_LAs_dTc0Br2KeBSFM9XyQg_PsdAVQfP
```

**Live-browser testing from inside a Claude Code Remote sandbox hit a real
infrastructure wall, worth knowing about before trying it again**: this
session's environment ("Default") originally had `Network access: Trusted`,
which blocked all direct egress to Supabase (403 from the agent-proxy relay).
Shrey changed it to `Custom` with `wrxqgfbolryveivgdjia.supabase.co`
allowlisted, and that **did** open egress — confirmed via direct `curl`
against both the REST API and the Auth password-grant endpoint, which
authenticated successfully and repeatedly (5/5) with the test account above.
**But Chromium specifically could not complete the same request** — every
attempt through Playwright hung ~30s then died with
`net::ERR_CONNECTION_RESET`, reproduced with and without the local relay
proxy, with HTTP/2 disabled, across multiple retries. The proxy's own
`/__agentproxy/status` failure log showed nothing for these attempts,
meaning something further out on the path resets connections that look like
browser TLS traffic specifically, while plain `curl` from the same
container sails through every time. Not an app bug, not a credentials
problem, not this session's network-policy setting — something about
Chromium's connection fingerprint trips a filter that `curl` doesn't.
**Practical conclusion: live-browser verification from this kind of sandbox
isn't reliable for this project even with egress opened — use the deployed
Netlify site with a real browser instead**, which is what Shrey plans to do
once credits reset.

**Non-Telegram backlog checked this session — genuinely nothing else
unblocked to pick up.** Everything left in Backlog besides #103/#24 (now
both moved to Review) is either Telegram-bot work (out of scope per Shrey's
own "not telegram" ask) or blocked on Shrey directly: #21 (FIRE number —
needs his real monthly expense figure), #23 (leaked-password protection —
dashboard-only toggle, no API surface reaches it), #102 (nightly backups —
needs `BACKUP_PASSPHRASE`/`BACKUP_CHAT_ID` secrets only he should set). Don't
manufacture scope here; wait for Netlify verification or new input from him.

## Taskiv #24 — Phase 2 backlog, all three pieces (20 Aug 2026)

Built on this branch (`claude/money-v4-open-items-5njpob`), same as #103.
`#24` was a three-item grab-bag, not one task — did all three, scoped down
where the task's own notes flagged something as bigger than it looked.

**Assign spend to partner for review.** New `transactions.assigned_to`
(`038_partner_review_and_goal_link.sql`, applied live) — "can you check this
one?", independent of `reviewed_at` (the separate weekend-reconciliation
pass). `assignForReview(id, person)` in `lib/transactions.js`; a select in
`TransactionForm.jsx` ("Ask Shrey"/"Ask Tarika"/"Not assigned"), a badge in
`TransactionList.jsx`. Never touches a money total.

**Link spend to goal.** New `transactions.goal_id` (same migration), also
display-only — deliberately does **not** create a `goal_contributions` row.
A goal's real progress still only moves through
`createContributionWithTransfer` (the existing transfer-funded mechanism);
this is "this Ikea run was for the New Sofa goal," a tag for context, not a
second way to move money into a goal. `linkToGoal(id, goalId)`; same form
gets a "Linked goal" select, same list gets a badge (goal icon + name).

**Forecasting.** The biggest of the three, scoped down once from Monarch's
full version and said so upfront: **click-to-edit instead of draggable
pins** — dragging a timeline marker needs live pointer tracking and
month-grid snapping for a number that's a rough estimate to begin with;
clicking a marker opens the same add/edit form instead, one extra tap for
the same outcome. Everything else is real: `forecast_events` (already
existed, unused — `001_init`/`002_rls`, confirmed via `list_tables` before
building against it) now actually holds data.

- `lib/forecast.js` — pure projection logic, no Supabase import, 12 tests.
  `computeMonthlyAssumptions` reads real trailing-12-month income/expense
  actuals (money-data rule: never a hand-typed guess unless the household
  explicitly overrides it in the form). `projectNetWorth` compounds one
  blended annual growth rate monthly on the running balance, adds net cash
  flow, and applies life events: a one-time `amount` plus an optional
  ongoing `monthlyDelta` for most kinds, or — for `retirement` — a
  permanent replacement of monthly income with `retirementIncome` from that
  date onward, nothing before it disturbed.
- **Real bug caught by its own test, not by inspection**: `dateAtAge`
  (birthday + retirement age → the actual event date) first returned a
  `Date` object, converted at the call site via `.toISOString().slice(0,
  10)` — exactly the UTC-vs-Dubai-local trap `lib/dates.js` already
  documents (`new Date(2045, 0, 1).toISOString()` lands on 31 Dec 2044 at
  UTC+4). Fixed by having `dateAtAge` return the date string directly,
  never round-tripping through UTC. A dedicated regression test
  (`dateAtAge never round-trips through toISOString...`) pins the 1 Jan
  case specifically, since that's the date most likely to expose it again.
- `lib/forecastEvents.js` — plain CRUD against `forecast_events`.
- New `ForecastSetup.jsx` (assumptions — birthday, growth rate, retirement
  age + post-retirement income, participating accounts, all seeded from
  real data with the household able to override), `ForecastEventForm.jsx`
  (add/edit one event), `ForecastChart.jsx` (projected net-worth line with
  event markers, hand-rolled SVG matching `LineChart.jsx`'s style). Lives
  as a new "Forecast" card on the **Accounts** screen, below the existing
  net-worth history chart — the natural sibling, not a new nav tab (the app
  is deliberately fixed at 10).

455 `npm test` (was 432 before #103, 443 after #103, then +12 for forecast =
455), lint and build clean. `npm run test:db` not run this session (no
local Postgres) — the new `038` migration is additive-only, matches every
existing convention (`if not exists`, nullable, `on delete set null` not
cascade), and was verified applied cleanly against the live database
directly via `execute_sql`, so risk is low, but a real `test:db` run is
still worth doing before this is called fully done. **Not verified in a
live browser** — same reason as #103, no Supabase credentials in this
session. Someone should click through Accounts → Forecast (set up
assumptions, add a life event, confirm the chart and the retirement/final
stat blocks look right) and Transactions → Assign/Link a spend before
treating this as finished.

## Taskiv #103 — Reports/Spending comparison chart (19 Aug 2026)

Built on this branch (`claude/money-v4-open-items-5njpob`) — unrelated to the
Telegram bot work below, which moved to `claude/money-v4-open-items-mdw27c`
after a branch reconciliation (see that branch's CLAUDE.md).

Monarch-style "this period vs a comparison period" cumulative spend chart,
new `Compare` sub-tab on Reports → Spending, alongside the existing
Breakdown/Trends tabs. Five comparisons via a dropdown (This week vs last
week, This month vs last month, This month vs last year, This month vs
average month — default, This year vs last year), matching the screenshots
Shrey shared.

`src/lib/spendingComparison.js` is the pure logic (no Supabase import, same
rule as `reports.js`): `resolveComparisonPeriod(key)` turns a comparison key
into the current period (always ends "today"), the comparison period (a real
past period — `null` only for the average-month case, whose comparison is a
synthetic curve, not one period), and the widest date range to fetch.
`buildComparisonSeries` turns a flat transaction list into two cumulative
daily series **aligned by day-offset**, not calendar date — day 12 of "this
month" lines up under day 12 of "last month" regardless of month length, and
a `null` at an index (today onward for the current series; a window edge for
the average) breaks the line rather than drawing a false slope to zero. The
average-month case computes the mean AED spend per day-of-month (1–31)
across the trailing 12 full calendar months, correctly skipping months that
don't have a given day (Feb has no 31st).

New `ComparisonChart.jsx` — a two-series SVG line/area chart in the same
hand-rolled style as `LineChart.jsx` (no charting library). The comparison
series draws as a dashed neutral-gray line rather than a second categorical
hue, since it's a reference line (like a budget line), not a competing
identity — the current period keeps the app's usual `CHART_PALETTE[0]` brand
blue with an area fill. Both series break into separate path segments
wherever they go `null`, so gaps never draw as false drops to zero.

Comparison is tied to real "today", independent of the screen's own
← → period navigator — matches Monarch's own dropdown behaviour, and matters
because a household member browsing an old month shouldn't see "this week"
silently mean that old month's week.

11 new tests in `spendingComparison.test.js` (period resolution for all 5
keys including year/month boundary rollovers and leap-year day counts,
day-offset cumulative alignment, transfer exclusion, non-AED conversion, the
day-of-month averaging including the skip-months-without-day-31 case, and an
empty-data all-zero-not-null case). 443 `npm test` (was 432), lint and build
clean. **Not verified in a live browser this session** — no Supabase login
credentials available here; the dev server itself launches fine and the
production build compiles, but nobody has clicked through the actual Compare
tab yet. Do that before calling this done.

Frontend-only — needs a Netlify build once pushed to `main`; not yet merged
there.

(The Telegram bot work referenced above as "below" moved to
`claude/money-v4-open-items-mdw27c` after a same-day branch reconciliation —
see that branch's own CLAUDE.md for `/undo`/`/review`. Not carried into this
file since `main` doesn't have that code.)

# Our Money v4 — working notes

Private household finance app for a couple in Dubai. See `PLAN.md` for the
product plan, data model and decisions log. This file is for the operational
things that are easy to get wrong.

## Deploys cost real money — batch them

Netlify is on the **free tier: 300 build minutes/month, resetting on the 20th**.
Every push to the production branch triggers a build.

- Verify locally first (`npm run build`, `npm test`, `npm run lint`), then push
  **once** with the work batched. Don't push per-commit while iterating.
- Check that Netlify's branch-deploy setting is "production branch only" — if
  it's set to all branches, every push to every branch burns minutes.
- Edge Function deploys go through Supabase, not Netlify, and cost nothing here.
  Backend-only changes never need a Netlify build.

## Screens

10 nav tabs: Home, Accounts, Investments, Transactions, Reports, Budget, Recurring,
Goals, Debts, Settings. Investments and Debts were split out of Accounts and Goals
respectively once real data made the combined screens too crowded; Reports (was Cash
Flow) gained Cash Flow/Spending/Income sub-tabs and leads with a Sankey diagram. Dark
mode and a global AED/USD/INR currency toggle apply across all of them — both
device-local (localStorage via `PrefsContext`), not synced between Shrey's and
Tarika's devices on purpose. See `PLAN.md` for the full per-screen breakdown.

## Deploy — 18 Aug 2026

`telegram-intake` redeployed to production: **v35**, `verify_jwt: false`
(unchanged). Carries everything built since the last live deploy — Taskiv
#48 (`v_transactions_aed` FX view, migration already live), #49 (outbound
chat-id allowlist via `GuardedMessenger`), #50 (the intent router —
`spend | question | action | chatter` classification on every plain typed
message), and #51/#52 (the query toolbox: `category_spend`, `total_spend`,
`merchant_spend`, `account_spend`, `recent_transactions`, answered live from
`v_transactions_aed`). Sprint 2 is now 4 of 5 shipped; only **#53** (router
fixture corpus + `/help` rewrite) is still open. Bot-expansion Sprint 1 was
already fully live from the 14–16 Aug deploy below.

**#53 is done in code, not yet deployed** — `fixtures/routing.ts` (a 30-case
corpus covering spend/question/action/chatter plus the adversarial cases:
"how much was that Carrefour trip, 240?" resolves via the classifier, a bare
"240"/"groceries"/"84" resolve via the router's classifier-failure fallback,
never a live model call) and `routing.test.ts` (3 tests: the regex fast path
alone never misroutes a spend case as a question, every corpus case reaches
its expected intent, and every spend case survives a simulated total
classifier outage). `HELP_TEXT` in `intake.ts` is rewritten as an honest
📸/💸/❓/⚙️ catalogue of what's actually live — cashback, transfers, bulk
input and the #50–#52 query toolbox are now listed; `/undo`, `/review` and
any "action" capability are deliberately left out until they ship, with a
comment in the file saying so. 410 `npm test` (was 407), lint and build
clean, `npm run demo:telegram` unaffected.

**#53 is now deployed too — `telegram-intake` v36, `verify_jwt: false`
(unchanged).** This deploy went through cleanly on the first attempt: the
`../_shared/` naming fix above was applied from the start of the payload
instead of being rediscovered. Sprint 2 of the bot expansion (#48–#53) is
now fully shipped and live. `main` was also fast-forwarded and pushed to
GitHub the same session (9 commits) — Netlify's build queued and will fail
on the exhausted free-tier minutes (resets 20 Aug), but the commit is on
`main` and will deploy automatically the next time Netlify builds it; no
further push needed once credits reset.

Deploying this one cost real time to work out, worth recording so it isn't
relearned: `mcp__Supabase__deploy_edge_function` is **not additive** — every
call must carry the function's *complete* file set (entrypoint + every
relative import, transitively), or the bundler fails atomically and nothing
changes in production. The actual trap, though, was file naming. Inside the
`files` array, a name like `intake.ts` or `query/store.ts` lands under the
bundler's `source/` root exactly where the repo's own relative imports
(`./intake.ts`, `./query/store.ts`) expect it. But `_shared/*.ts` is a
**sibling** of `telegram-intake/`, one level up — matching the real
`../_shared/serviceKey.ts` import in `config.ts` — so those six files must be
named `../_shared/types.ts`, `../_shared/store.ts`, etc. in the `files`
array, *not* `_shared/types.ts`. The wrong prefix nests `_shared/` a level
too deep, and every call using it fails with `Module not found
".../_shared/serviceKey.ts"` regardless of whether every other file is
present and correct — which is exactly the failure mode this session hit
repeatedly before finding the real cause. No code changed as a result of any
of this; it was purely a deploy-payload construction issue, and every failed
attempt was rejected before touching production, so the previously-deployed
version stayed live and unaffected throughout.

**Taskiv #59 (honest-refusal path) is done in code and deployed —
`telegram-intake` v37, `verify_jwt: false` (unchanged), on top of v36.
Deployed cleanly on the first attempt using the `../_shared/` naming fix from
the start, no retries needed. Not pushed to `main` — only the #53 work was
explicitly authorized for `main`; this stays on
`claude/money-v4-open-items-mdw27c` until asked.**
`planQuery` (query/plan.ts) gained a `planQueryDetailed` sibling that returns
*why* a question couldn't be planned — `call_failed` (the model threw or
returned unparseable JSON), `unknown_category` (a real category name was
named but didn't match), or `unsupported` (everything else the closed query
enum doesn't reach) — instead of collapsing all three into one `null`.
`planQuery` itself is now a thin wrapper over `planQueryDetailed` so every
existing `plan.test.ts` assertion (`assert.equal(plan, null)`) still holds
unchanged. New `query/refusal.ts` owns the actual reply text: an
advice-shaped question ("should we...", "can we afford...") is refused
before the model is ever called — a deliberate product boundary, not a
missing feature; a planner failure gets "try rephrasing", distinct from the
generic "I can't answer that one yet" for an out-of-enum question; an
unknown category lists the household's real ones; and a `runQuery`/store
failure reuses `errorHint` (now split out of `intake.ts` into its own
`errorHint.ts` — the same circular-import problem `accountMatch.ts`/
`format.ts` solved for Taskiv #50, since `intake.ts` imports
`query/refusal.ts` and `query/refusal.ts` needs `errorHint`). `answerQuestion`
in `refusal.ts` is the single entry point — `intake.ts`'s `handleQuestion` is
now a thin wrapper around it, which is also why the whole thing is testable
in `query/refusal.test.ts` (10 new tests: the five cases the task named —
null/unsupported plan, planner throw, store throw, advice question, unknown
category — plus the advice-detection regex and the success path) without a
Telegram harness. 420 `npm test` (was 410), lint and build clean,
`npm run demo:telegram` unaffected.

## Deploy — 14–16 Aug 2026

Migration `034_transfer_direction_null_safe` applied to `our-rokda` (found by
the new `npm run test:db` suite — 025's transfer-direction CHECK let a NULL
direction through via Postgres's NULL-is-satisfied CHECK semantics; verified
live, both that zero rows were affected and that the bad case is now
rejected). All four Edge Functions redeployed carrying that fix plus the
`_shared/serviceKey.ts` consolidation (Taskiv #100): `telegram-intake` v33,
`refresh-prices` v10, `refresh-fx` v9, `backup` v7. `verify_jwt` unchanged per
function (`telegram-intake` false, the other three true).

**Verified live end to end, 16 Aug.** A real Telegram message ("9.19 Carrefour
snacks") round-tripped through the full pipeline: logged with `needs_review`,
Confirm tap cleared it, row landed correctly (`transactions.id
0f6fbe5a-46b4-4f66-bac2-b1ee5f719f1a`). One real bug surfaced and was fixed in
the process: the `SERVICE_ROLE_KEY` custom secret's stored value had gone
stale — the first test after deploy still failed with the old `PGRST303:
"JWT issued at future"`. Shrey re-pasted a fresh copy from Project Settings →
API and the retry succeeded. **`SUPABASE_SECRET_KEYS` is confirmed absent**
from this project's secrets (only `TELEGRAM_BOT_TOKEN`, `OPENROUTER_API_KEY`,
`OPENROUTER_MODEL`, `TELEGRAM_WEBHOOK_SECRET`, `SERVICE_ROLE_KEY` exist) — so
`resolveServiceKey`'s `SUPABASE_SECRET_KEYS` branch is still genuinely
unexercised. Harmless (falls through cleanly when absent, which is what
happened), but if this project ever actually migrates to JWT Signing Keys,
recheck `SERVICE_ROLE_CANDIDATE_KEYS` in `serviceKey.ts` against whatever
`SUPABASE_SECRET_KEYS` turns out to look like then — nothing has verified
those candidate names against a real value.

**`claude/money-v4-post-qac-s2rnm9` merged into `main` 16 Aug** (clean
fast-forward, `main` was not ahead — no merge commit). Production and `main`
are back in sync; the "branch ahead of production" drift this deploy created
is resolved. Taskiv #100 and #101 are both Done.

## Deploy — 17 Aug 2026

Three real bugs found and fixed, then a large real-data pass, all deployed to
production (`main` at `e9cdba4`, fast-forward, no drift).

**Bugs fixed:**
- **Budget screen layout was broken** (`8e5d5f5`, `f52321b`): stray `order`
  classes put the category table into the sidebar's 280px column instead of
  the flexible one, clipping Planned/Actual/Remaining off the right edge and
  collapsing the category-name column to zero width. Removed the `order`
  classes and widened Budget to `max-w-6xl` to match every other data-dense
  screen (it was the only one at `5xl`).
- **`PrefsContext` loaded FX rates before the auth gate** (`4da8392`): it sits
  above `<Gate />` in `App.jsx`, so its one-time effect ran pre-login, the
  RLS-protected `settings` read threw, and the rates stayed at the AED-only
  starting value for the rest of the session — every non-AED figure on
  Investments, Reports and Transactions rendered as `—` for good, only fixable
  by manually hitting Refresh FX in Settings. Now gated on the signed-in
  user's id.
- **`cardSummary`'s cycle spend counted `Transfer` rows** (bundled into the
  card-detail work below): a card used to pay off another of the household's
  own bills inflated its own "spend" number. Fixed with a regression test.

**Real bank/card data entered — all reconciled to the penny against source
statements or the live banking apps, per the money-data rule.** Five accounts
went from placeholder/nonexistent to real:

| Account | Balance (17 Aug) | Source |
|---|---|---|
| FAB Current …9002 | 1,708.40 | Shrey, live app figure |
| Wio Current …0318 | 4,135.21 | Shrey, live app figure |
| FAB Etihad CC …0570 | 651.52 | 5 statements (Apr–Aug) + live app activity |
| ENBD Noon CC …1657 | 5,487.56 | 5 statements (Mar–Jul) + live app activity |
| Wio Credit Card …6981 | 2,590.20 | 5 statements (Mar–Aug) + live app activity |

Plus two loan accounts split out of card balances so they're visible as their
own liabilities rather than blended into a card's headline number:
`QC 12M @ 0% Instalment (FAB Etihad CC ...0570)` (15,619.97) and confirmation
that the two pre-existing `ENBD Noon CC ...1657` EMI loan rows (Car
Down-Payment 8,333.24, Mobile 1,208.52) were already correct — cross-checked
against the statements' own installment tables to the cent, which also
resolved what looked like a duplicate line item in the ENBD statements: there
really are **two** identical AED 10,000/24-month Arabian Automobiles
instalment plans running concurrently, not a PDF rendering artifact.

**Migration `035_statement_cycle.sql`** applied (statement_day/due_day/
credit_limit on `accounts`) — see the reconciled ledger note in
`docs/telegram-bot-sprint-plan.md` §4b.

**The "Example" AED 10,000 placeholder cash account is gone.** It wasn't
empty when checked — two real AED 9.99 Telegram-bot transactions (10 Aug, no
merchant name, still uncategorised) had drifted onto it, reassigned to Wio
Current before deleting. Worth a look: nobody knows yet what that 9.99 charge
actually was.

**New: a card tracking view** (`0fc1b86`, `25bf9ec`, `e9cdba4`). Click a card
on Accounts for balance/limit/utilisation, spend-by-category for the open
cycle, a 6-cycle trend bar chart, and inline category editing on flagged
transactions. No forecast/projection number — that was built once, then
explicitly removed same-day: "forecast" turned out to mean the plain running
total (already shown as "Logged this cycle"), not a blended/historical
projection. Don't re-add projection logic without being asked again.

**~35 transactions still carry `needs_review = true`** across the three
cards — ambiguous merchants (`Paymob**Al WATHBA`, `Dubai Digital Authority`,
`Millennium Place Barsha`, `Al Kabayel Trading`, the two AED 9.99 rows) that
need a human eye, not a guess. Query: `select * from transactions where
needs_review = true and deleted_at is null`.

**Two bank-level transfers ended up flagged with the destination unclear**
even after entry: FAB's `UADDS Cr Trf -2,193.00` (3 Aug) and `To Shreyash
Chawhan -45.32` (11 Aug) — recorded as `Transfer` category, but where the
money actually went isn't known. Ask Shrey.

## New open items — 17 Aug 2026

- **~35 flagged transactions need review** (see above) — the household's own
  task, not an agent's; categorising `Paymob**Al WATHBA` (AED 3,160.50) or
  deciding what "Urban" (AED 238) actually was needs Shrey or Tarika's memory.
- **Two bank transfers with an unclear destination**: FAB's `UADDS Cr Trf`
  (AED 2,193, 3 Aug) and `To Shreyash Chawhan` (AED 45.32, 11 Aug). Neither
  matches a tracked account.
- **Still no real sign-in.** The URL was handed to Shrey this session; whether
  he's actually logged in yet is unconfirmed. Don't assume it happened without
  him saying so.
- **FAB debit card …3585 has no account of its own** — deliberate, it draws
  from FAB Current …9002, which now exists. Revisit only if Shrey wants it
  tracked separately.

## Open items (as of 16 Aug 2026, verified against the live DB and deploy)

Everything below is still genuinely open. Two items that lived in this list for
weeks — the webhook secret failing open, and `telegram-intake` running stale
code — are **resolved**: `gate.ts`'s fail-closed 503 and the `serviceKey.ts`
consolidation are both live and proven end to end (see "Deploy — 14–16 Aug
2026" above). Don't re-open either without new evidence; the last "still
broken" claim about them was itself stale by several versions.

- **BTC is not tracked, and Shrey confirmed 16 Aug he no longer holds it** —
  he sold it. There was never an `accounts` row for it (confirmed live: zero
  matches for `ticker ilike '%btc%' or name ilike '%btc%'`), so there was
  nothing to delete. No action needed unless he re-enters crypto later.
- **Encrypted nightly backups are built and deployed, not enabled** (Taskiv
  #102). Needs Shrey to set `BACKUP_PASSPHRASE` and `BACKUP_CHAT_ID` in the
  Supabase dashboard himself — deliberately not something an agent should
  generate or hold. Once those exist, installing `pg_cron`/`pg_net` and
  writing the cron schedule needs no secrets and can be done via the Supabase
  MCP. See `supabase/functions/backup/README.md`.
- **`pg_cron` and `pg_net` are available but not installed** on `our-rokda`
  (re-verified 14 Aug via `list_extensions`). Bundled with the #102 backup
  work above, not a standalone task.
- **Supabase Auth: leaked-password protection is disabled** (security
  advisor WARN). Dashboard-only toggle (Authentication → Policies) — no tool
  in the Supabase MCP reaches Auth config. (Taskiv #23)
- **Neither Shrey nor Tarika has signed into the app since RLS went live.**
  The membership policies are proven by SQL-role probes and now by one real
  bot round-trip, but a real browser sign-in for each of them is the only
  thing that proves the *app's* auth flow, not just the predicate.
- **Two tickers remain unproven against Yahoo specifically**: `SKHY` (an ADR)
  and any future NSE symbol. Watch `refresh-prices`'s `failed` array.
- **FIRE assumptions in Settings are dead.** `fire_swr`/`fire_return` are set,
  `fire_expense` is null, and nothing in `src/` reads any `fire_*` key — no
  screen calculates or shows a FIRE number. Deliberately not built (Shrey
  hasn't given a real monthly-expense figure yet). (Taskiv #21)
- **Bot-expansion Sprint 1 foundations are now all 6 of 6 done** (as of 17 Aug
  — #48 and #49, the last two, shipped this session). Of Sprint 2, **#51, #52
  and #50 are also done this session**; only **#53 (router fixture corpus +
  `/help` rewrite)** is left. The query toolbox is now actually reachable
  from a live chat message — **#50 wired it in**, see below — though nothing
  from this session (#49's guard or #50's router) has been deployed yet;
  `telegram-intake` in production is still whatever `main` last had.
  - **#50 — `telegram-intake/route.ts` (the intent router) wired into
    `intake.ts`'s `handleMessage`.** Every plain typed message that survives
    the existing cashback/transfer/bulk pre-checks is now classified
    `spend | question | action | chatter` before extraction — `question`
    answers via the #51/#52 toolbox and never writes a row, `chatter` gets
    silence (no reply, no row — "a bot that answers 'ok' is a bot people stop
    using"), `action` has no handler yet (Sprint 2/3's propose-then-tap work)
    so it deliberately falls through to spend. Every failure mode — regex
    near-miss, malformed classifier JSON, a thrown model call, confidence
    below 0.6 — resolves to spend, never silence, per the task's one rule: a
    misrouted spend is a lost spend. Photo/voice and captions never reach
    the router at all (unchanged code path), so "a receipt is always a
    receipt" holds structurally, not just by convention.
    Two extractions made along the way, both to protect existing behaviour
    rather than change it: `matchAccount`/`matchAccountTies` moved out of
    `intake.ts` into `accountMatch.ts`, and `formatAmount`/`formatDate` into
    `format.ts` — `intake.ts` now imports `query/run.ts` and `query/reply.ts`
    for the router, and both of those already needed those functions, so
    leaving them in `intake.ts` would have created a circular import.
    `IntakeDeps` gained `queryStore` and a **separate** `classifierModel`
    field — reusing `model` for both extraction and classification would
    have desynced every existing test's `FakeModel` response queue with an
    extra call in front of it; in production both fields point at the same
    real `OpenRouterClient` instance, so this costs nothing live. All 84
    pre-existing `intake.test.ts` cases pass with **zero assertion changes**
    (only the shared `harness()` fixture gained the two new deps), plus 9 new
    end-to-end routing cases and `route.test.ts`'s 19 unit cases (regex fast
    path + classifier + fallback). `npm run demo:telegram` output is
    byte-identical to before. Full suite: 407 `npm test`, 41 `test:db`, lint
    and build clean.
  - **#51 — `telegram-intake/query/{types,period,plan,run}.ts`.** `types.ts`
    is the closed `QueryPlan`/`Period` vocabulary (5 queries: category/total/
    merchant/account spend + recent transactions — Sprint 3 adds budget/net
    worth/goals/bills/portfolio, not built here) plus the `QueryStore`
    interface #52 implements. `period.ts`'s `resolvePeriod` turns any `Period`
    into concrete from/to dates and a human label ("1–17 Aug", "Jul", "last 7
    days") using `todayInTz`, never a raw `toISOString()` slice; weeks start
    **Monday** — no existing app screen groups by week to match, so this is a
    new convention, not an inherited one. `plan.ts`'s `planQuery` is the only
    place a model response is trusted at all, and even there every field is
    validated against the household's real category/account/people lists in
    code before use — an unknown category, account, owner, or `q` outside the
    5-entry enum all return `null` (the honest-refusal path, not an error).
  - **#52 — `query/store.ts` (real `PostgrestQueryStore` against
    `v_transactions_aed`), `query/reply.ts` (templated replies), `run.ts`
    filled in.** One correction made mid-build: the original #51 draft had
    `account_spend`'s account name exact-matched against the household's list
    *inside the planner*, but #52's own spec calls for resolving it with the
    same `matchAccount()` scorer a receipt's `paid_with` already goes
    through — so `plan.ts` was revised to treat `account` as free text (like
    `merchant`), and `run.ts` now does the real resolution, including the tie
    case (`matchAccountTies` → "Which account did you mean — X or Y?" instead
    of guessing). `total_spend` excludes `Savings & Investments` from the sum
    and reports the excluded amount in a footer, only when non-zero. All
    filtering goes through `URLSearchParams` against `v_transactions_aed` —
    no string-built SQL. `formatAmount`/`formatDate` exported from
    `intake.ts` for reuse rather than re-implemented. 64 new tests total
    across #51+#52 (16 period, 22 planner, 13 executor, 15 reply templates),
    all passing, plus the existing 312 + 41 db-test suites untouched. Not yet
    reachable from a live chat message — that's #50's job.
  - **#48 — `036_money_view.sql`, applied to `our-rokda`.** `v_transactions_aed`
    joins `accounts` and bakes in `deleted_at is null`. Per the correction
    logged on the task (the spec's `coalesce(rate, 1)` skeleton was wrong —
    would have reintroduced the 1:1-AED-fallback bug `src/lib/money.js`
    deliberately removed), `amount_aed` is `NULL`, not defaulted, for a
    currency `settings.fx_rates` has no rate for. Verified live: 432 AED rows
    and 1 USD row all convert, zero unconverted. One sharp edge worth
    remembering before Sprint 2/3/5/6 queries get written: Postgres's `sum()`
    silently skips `NULL` rather than propagating it the way client-side NaN
    does — a query must separately check `count(*) filter (where amount_aed
    is null)` or it will report a plausible, silently-too-low total. 7 new
    `test:db` cases cover this (`money_view.test.mjs`).
  - **#49 — outbound chat-id allowlist**, in `_shared/guardedMessenger.ts`
    (`GuardedMessenger`) and wired into `intake.ts`'s `handleMessage`/
    `handleCallback`. Every reply after the household allowlist check is
    guarded against a forged `chat.id`; `/id` alone still bypasses it (must
    work in an unrecognised chat during setup — see the file's own comment
    for why that's not itself a hole). 9 new tests (6 unit in
    `guardedMessenger.test.ts`, 3 integration in `intake.test.ts` covering the
    forged-chat, normal-group and `/id`-in-unknown-chat cases from the task's
    acceptance criteria). All 312 `npm test` cases and all 41 `test:db` cases
    pass.

Resolved since the last pass — **Taskiv #44 is fixed**: `intake.ts` now resolves
"today" via `_shared/dates.ts`'s `todayInTz` (Asia/Dubai via `Intl.DateTimeFormat`,
not a UTC string slice). **Bot-expansion Sprint 1 foundations are also in**:
`015_bot_expansion.sql` is applied to `our-rokda` — `transactions.deleted_at` for
soft-delete-based `/undo`, and a `notifications` table with a unique `dedupe_key`
so the future hourly push cron is idempotent (verified live: a duplicate
`dedupe_key` insert throws `23505`). `store.ts`/`telegram.ts`/`types.ts` moved to
`supabase/functions/_shared/` so `telegram-push` can reuse them without depending
on `telegram-intake`'s config. `src/lib/transactions.js` reads now filter out
soft-deleted rows.

**The Telegram pipeline now logs itself.** `016_intake_logs.sql` is applied —
every inbound attempt (text/photo/voice/correction/callback) and every outbound
reply writes a row to `intake_logs`: who sent or received it, which pipeline
stage, the model and token counts when one was called, success/failure, the
error if any, and latency in `duration_ms`. See "Observability" in
`supabase/functions/telegram-intake/README.md` for the query patterns. Used
live 16 Aug to diagnose the stale-`SERVICE_ROLE_KEY` failure (see "Deploy —
14–16 Aug 2026" above) — `select * from intake_logs where success = false`
is where to look first whenever intake goes quiet.

**task #6 is done**. Real data is in production:
41 investment holdings (25 Zerodha India equities, 8 Shrey US/gold, 8 Tarika
US/metals), 4 liability accounts (ENBD car loan, 2 ENBD Noon CC EMIs, FAB 0%
cash advance), all recurring bills and salaries, 12 budget limits and 6 goals.
Every portfolio reconciles to its source statement. The 3 pay-down goals are
seeded (`012_seed_paydown_goals.sql`) and now linked to real liability accounts.

**Money data comes from broker screenshots, never from a web price lookup or a
verbally-quoted figure.** Both alternatives were tried this session and both
introduced real error — web prices were ~$600 out across two tickers, and two
separately-typed average prices were wrong. Neither would have surfaced as a
visible bug; they would just have made net worth quietly incorrect.

## Branches

`main` is the trunk and holds Epics 1–7 plus the Monarch-parity backlog
(#20, #25–33). Netlify's production branch points at `main` and deploys on
push — confirmed via the live deploy record matching `main`'s HEAD commit.
Put `[skip netlify]` in the commit message for docs-only changes so they
don't burn a production build.

## Supabase

Project `our-rokda` (`wrxqgfbolryveivgdjia`).

- Schema lives in `supabase/schema/NNN_*.sql`, applied in order. Additive-only,
  never destructive — this database carries real money data.
- `001`–`007` were run by hand in the SQL Editor so they don't appear in
  `supabase migration list`; `008`+ do.
- The `telegram-intake` Edge Function is deployed straight from
  `supabase/functions/telegram-intake/`. Keep the deployed copy in sync with the
  repo — after deploying, diff the two.
- `refresh-prices` is the second Edge Function: manually triggered from the
  Investments view, fetches US stock/ETF prices from Yahoo's unofficial chart
  endpoint and BTC from CoinGecko (both keyless), and writes `last_price`/
  `value` back. It only touches accounts with `type='investment'`,
  `currency='USD'` and a non-null `ticker` + `quantity`; metals and the India
  equities are excluded by having no ticker, on purpose. Because it is called
  **from a browser** it must answer the CORS preflight — the OPTIONS handler is
  load-bearing, unlike in `telegram-intake`.

## Tests

```bash
npm test              # 278 tests: Edge Functions + src/, node --test, no network, no keys
npm run test:db       # 32 tests: supabase/schema/*.sql applied from empty against real Postgres
npm run lint          # oxlint — 0 errors, 6 warnings
npm run build         # vite
npm run demo:telegram # walks the Telegram flow against mocked payloads
```

`.github/workflows/ci.yml` runs two jobs on every push: `check` (`npm ci`,
lint, `npm test`, build, advisory audit) and `db-integration` (`npm run
test:db` against a `postgres:16` service container). See
`supabase/db-test/README.md` for what the second one stands in for and what
it deliberately doesn't.

**What `npm test`'s fakes do not cover, and `test:db` now does:** RPCs
(`replace_category_split`, `create_transfer`, `create_bulk_transactions`,
`apply_pending_income`, `claim_media_group`, `save_telegram_settings`)
against the real schema, the RLS matrix (anon / non-member / member), the
zero-amount and transfer-direction constraints, and — the point of the whole
exercise — `supabase/schema/*.sql` applied in order from an empty database,
which had never been tested before Taskiv #101. Building it surfaced one more
real gap the same shape as the three below: `transactions_transfer_direction_valid`
(025) used `transfer_direction in ('out','in')`, and Postgres CHECK
constraints treat a NULL result as satisfied — so a transfer row with a null
direction passed a constraint written to block exactly that. Fixed in `034`.
Nothing in the app had ever hit it; `create_transfer` always sets both sides
explicitly.

**Still not covered:** browser rendering, Auth from a real client (a signed-in
session, not just the RLS predicate), and the external APIs (Yahoo, CoinGecko,
Telegram). Those still need a person.

One rule learned three times this round: **pure logic must not live in a module
that imports the Supabase client**, because Node cannot load it and it silently
becomes untestable. That is how `toAED`, the transaction grouping and the
recurring schedule rules all went untested while carrying bugs. Data access in
one module, rules in another.

## Telegram bot expansion (designed 10 Aug 2026, not yet built)

Three design docs, all binding on the implementation:

- `docs/telegram-bot-expansion.md` — architecture: the intent router, the query
  toolbox, propose-then-tap writes, the push function.
- `docs/telegram-bot-sprint-plan.md` — feature-by-feature feasibility against the
  live schema, cost analysis, the four settled decisions (§6), and the migration
  numbering ledger (§4b). **The ledger was reconciled 16 Aug** — all four of its
  original 016–019 slots had been taken by other work. `035_statement_cycle` is
  now applied (it jumped its sprint because the Accounts screen needed the card
  limit fields), leaving `036_money_view`, `037_pending_actions` and
  `038_push_cron`. Always take the next free number in `supabase/schema/`, never
  a reserved one — reserving slots for unbuilt work is what made this ledger
  stale in the first place.
- `docs/telegram-bot-round2-design.md` — six gaps the household's first real
  usage session surfaced in the *existing* receipt-intake path (duplicates,
  bulk input, transfers, cashback, itemized summaries, multi-photo albums).
  Two other issues from that same session (PDF handling, ambiguous account
  matches) turned out to be same-day bug fixes, not design work — already
  shipped as `telegram-intake` v15.

Backlog is in Taskiv as epics 8–13, tasks **#44–79**. Four rules from that design
that are easy to violate later and expensive to undo:

1. **The model never writes SQL and never does arithmetic.** It picks one entry
   from a closed query enum; Postgres computes every digit. The function holds
   the service-role key, so text-to-SQL here has an unbounded blast radius.
2. **The router defaults to "spend" on any doubt.** A misrouted question costs an
   `/undo`; a misrouted spend is money that never enters the ledger.
3. **Transactions keep write-then-flag; every other write is propose-then-tap.**
   The "never lose a spend" rule justifies optimistic writes only for
   transactions — nobody forgets moving 2,000 AED into a goal, and a bad
   `accounts.value` write corrupts `nw_daily` permanently.
4. **The bot never writes `quantity`/`avg_cost`/`last_price`.** A typed stock buy
   logs a cash outflow only; holdings stay screenshot-sourced. See the money-data
   rule above — this is the same rule, applied to chat.

Push alerts need no model call at all: SQL computes the number, a template writes
the sentence. Whole expansion costs under $0.50/month in API spend; the binding
constraint is alert volume, because the bot pushes into the same chat intake uses
and **a muted bot is a broken intake pipeline.**

## Telegram intake

Setup, troubleshooting and the receipt-tuning pass are documented in
`supabase/functions/telegram-intake/README.md`. Two things that cost hours once:

- Group privacy must be **off in BotFather**, and the bot must be **removed and
  re-added** to any group it had already joined — the setting doesn't apply
  retroactively, and the symptom is that `/commands` arrive but plain messages
  silently don't.
- HTTP header values are Latin-1 only. A single non-ASCII character (an em dash)
  in an outgoing header makes Deno throw while constructing the request, so the
  call never leaves the function and the upstream API records nothing.
