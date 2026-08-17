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
  — #48 and #49, the last two, shipped this session). Sprints 2–6 remain
  untouched, but the gate is now open: every money query in Sprints 2, 3, 5
  and 6 is supposed to sum through `v_transactions_aed`, so they can now be
  built without redoing this work.
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
