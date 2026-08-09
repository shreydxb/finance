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

## Open items (as of 9 Aug 2026, verified against live DB/deploy)

- **`refresh-prices` has never completed a successful run.** The Edge Function
  is deployed (version 2) and the button is live on Accounts → Investments,
  but every observed invocation so far failed. The first bug — it rejected the
  browser's CORS preflight with 405, so the POST never fired — is fixed and
  redeployed; nothing has been run since. Check
  `get_logs(service='edge-function')` before assuming it works. Two tickers are
  unproven against Yahoo in particular: `SKHY` (an ADR) and any future NSE
  symbol.
- **Zero transactions logged in production, ever** — not one, manual or
  Telegram. Receipt-photo accuracy is unproven; text intake works end to end
  but no real photograph has been through the pipeline yet. Note this is now
  the *only* major table still empty: accounts, recurring, budgets, goals and
  goal_contributions all carry real data. See the tuning pass in the function
  README.
- **The Telegram webhook secret is deliberately unset.** The function currently
  skips the header check (it logs a warning), so the household allowlist is the
  only gate. Restoring it means setting `TELEGRAM_WEBHOOK_SECRET` in Supabase
  *and* re-running `setWebhook` with the identical string, in one sitting — a
  mismatch is silent apart from 403s in the function log. Needs the bot token
  and Supabase dashboard/Management-API access no available tool exposes.
  (Taskiv #22)
- **FIRE assumptions in Settings are dead.** `fire_swr`/`fire_return` are set,
  `fire_expense` is null, and nothing in `src/` reads any `fire_*` key — no
  screen calculates or shows a FIRE number. Deliberately not built (Shrey
  hasn't given a real monthly-expense figure yet). (Taskiv #21)
- **Supabase Auth: leaked-password protection is disabled** (security
  advisor WARN). Cheap toggle, but no tool in this session's Supabase MCP
  reaches Auth config — needs the dashboard. (Taskiv #23)
- **BTC (0.00679402) is untracked.** It sits outside the Wio portfolio view,
  so it needs its own source before it can be entered.
- **No dark mode.** Considered during the design pass and deliberately skipped:
  doing it properly means auditing every surface across nine screens, and a
  half-done dark mode is worse than none.

Resolved since the last pass — **task #6 is done**. Real data is in production:
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
npm test              # Edge Function tests: node --test, no network, no keys
npm run demo:telegram # walks the Telegram flow against mocked payloads
```

There are no frontend tests yet. `npm run build` is the only check the React
side gets.

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
