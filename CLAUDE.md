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

## Deploy — 14 Aug 2026

Migration `034_transfer_direction_null_safe` applied to `our-rokda` (found by
the new `npm run test:db` suite — 025's transfer-direction CHECK let a NULL
direction through via Postgres's NULL-is-satisfied CHECK semantics; verified
live, both that zero rows were affected and that the bad case is now
rejected). All four Edge Functions redeployed from
`claude/money-v4-post-qac-s2rnm9` carrying that fix plus the `_shared/serviceKey.ts`
consolidation (Taskiv #100): `telegram-intake` v33, `refresh-prices` v10,
`refresh-fx` v9, `backup` v7. `verify_jwt` unchanged per function
(`telegram-intake` false, the other three true).

**Not independently verified live**: this sandbox's network policy blocks
direct HTTPS to `*.supabase.co`, so no post-deploy smoke test could be run
from here. `resolveServiceKey`'s `SUPABASE_SECRET_KEYS` branch is still
unverified against the live secret's actual shape (see `serviceKey.ts`'s
comment) — it falls through harmlessly if the shape doesn't match, so this
deploy is no worse than before either way. First real confirmation will be
the next live Telegram message or Refresh Prices/FX tap, visible in edge logs.

**This branch is now ahead of `main` in production.** The deploy above went
straight from this branch via the Supabase MCP, not through
`.github/workflows/deploy-functions.yml` (manual `workflow_dispatch`, as this
project always deploys). If that workflow is run from `main` before this
branch merges, it will redeploy `main`'s older code over these fixes —
merge this branch first, or skip that workflow run.

## Open items (as of 12 Aug 2026, verified against the live DB and deploy)

- **`refresh-prices` has now succeeded** — HTTP 200 on 11 Aug 2026 (verified
  12 Aug via edge logs), and `refresh-fx` returned 200 on 12 Aug with rates
  written to `settings.fx_rates`. The earlier "never completed a successful
  run" note is obsolete. Two tickers remain unproven against Yahoo
  specifically: `SKHY` (an ADR) and any future NSE symbol.
- **13 real transactions in production** (verified 12 Aug against the live DB).
  All are Telegram-sourced, dated 11 Jul – 10 Aug; 3 carry `amount = 0` and 3
  have no category, which is the residue of the extraction failures below.
  None has ever been marked reviewed. A further 50 rows carrying a `[TEST]`
  note prefix — 79% of the table, and the source of every inflated total the
  app was showing — were deleted on 12 Aug; see
  `docs/data-ops/2026-08-12-test-data-cleanup.md`.
- **Receipt-photo extraction failed 4 times out of 8 in real use, and neither
  cause was model accuracy.** `intake_logs` records both. Two failures were
  `Unsupported MIME type: application/octet-stream` — fixed same day in
  `f829ce9` and deployed. The other two were the model being cut off at the
  `max_tokens: 500` cap partway through an itemized array; the truncated JSON
  was then reported as "malformed JSON", which is what made this look like an
  accuracy problem. The cap is now 2,000 and `finish_reason: 'length'` is
  detected and named explicitly (`extract.ts`). **Not yet deployed.**
- **The Telegram webhook secret is unset, and the deployed function still fails
  open.** The fix is in the repo and **not deployed**: `gate.ts` now returns 503
  when `TELEGRAM_WEBHOOK_SECRET` is absent, compares in constant time, and no
  longer lets `x-demo-mode` bypass authentication. Until `telegram-intake` is
  redeployed, production runs v22 — which skips the header check with only a
  logged warning, leaving the household allowlist as the sole gate. That
  allowlist reads `message.from.id` straight out of the *request body*, so
  anyone who guesses the URL can forge it. Today that means injecting junk transactions; once the bot
  answers questions (bot-expansion Sprint 2), the same forged request with
  `chat.id` pointed elsewhere makes it a read endpoint for the whole household's
  finances. Restoring it means setting `TELEGRAM_WEBHOOK_SECRET` in Supabase
  *and* re-running `setWebhook` with the identical string, in one sitting — a
  mismatch is silent apart from 403s in the function log. Needs the bot token
  and Supabase dashboard/Management-API access no available tool exposes.
  **Blocks Taskiv #50 onward.** (Taskiv #22)
- **FIRE assumptions in Settings are dead.** `fire_swr`/`fire_return` are set,
  `fire_expense` is null, and nothing in `src/` reads any `fire_*` key — no
  screen calculates or shows a FIRE number. Deliberately not built (Shrey
  hasn't given a real monthly-expense figure yet). (Taskiv #21)
- **Supabase Auth: leaked-password protection is disabled** (security
  advisor WARN). Cheap toggle, but no tool in this session's Supabase MCP
  reaches Auth config — needs the dashboard. (Taskiv #23)
- **BTC (0.00679402) is untracked.** It sits outside the Wio portfolio view,
  so it needs its own source before it can be entered.
- **`pg_cron` and `pg_net` are available but not installed** on `our-rokda`
  (re-verified 12 Aug). Needed for scheduled Telegram pushes *and* for the
  nightly encrypted backup added this round — see
  `supabase/functions/backup/README.md`. Both install with `create extension`.
  (Taskiv #68)

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
`supabase/functions/telegram-intake/README.md` for the query patterns. This is
the tool for the still-unresolved "receipt-photo accuracy is unproven" and
"webhook secret unset" items below — once real messages start flowing,
`select * from intake_logs where success = false` is where to look first.
`telegram-intake` is redeployed as version 13 with this and the Sprint 1
foundations above; it has still never received a live invocation (no bot
token/webhook registered in this session — see the webhook-secret item below).

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
  numbering ledger (§4b). **That ledger's own `016` slot is already stale** —
  it planned `016_money_view.sql`, but `016_intake_logs.sql` shipped instead
  (this round's observability work). Reconcile numbering by hand before
  applying anything from either doc.
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
