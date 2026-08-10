# Telegram bot expansion — feasibility, cost and sprint plan

Companion to `docs/telegram-bot-expansion.md` (the architecture). This one
answers: **of the features asked for, what's possible, what isn't, what does it
cost, and in what order do we build it.**

Feasibility below is checked against the **live schema** of `our-rokda`
(pulled 10 Aug 2026), not against PLAN.md. Where they differ, the live schema wins.

---

## 1. Feature-by-feature verdict

Legend: 🟢 buildable on today's data · 🟡 buildable, needs a schema addition ·
🔴 blocked on data that doesn't exist · ⚠️ possible but argues with an existing
project rule

### Asking questions (read)

| Ask | Verdict | Notes |
| --- | --- | --- |
| "How much on groceries this month / this week / 1–15 July?" | 🟢 | `transactions` filtered by category + date. Custom ranges are free once the period parser exists |
| "How much did I spend vs Tarika, this week/month?" | 🟢 | `transactions.owner` |
| "How much did I spend on the ENBD card?" | 🟢 | `transactions.account_id` → `accounts.name` |
| "Budget vs actual across all categories" | 🟢 | `budgets` (12 rows) joined to spend. **Only 12 of 19 categories have a limit** — the answer must say "7 categories have no budget set" rather than imply zero |
| "What's my net worth / Tarika's net worth?" | 🟢 | `nw_daily.by_owner` is already a per-owner JSON blob. Free lookup |
| "How did net worth move this month?" | 🟡 | `nw_daily` has **1 row**. It's "recorded from now forward, never backfilled" by design, so deltas are meaningless until ~30 days of app opens accumulate. Ship the query, expect it to say "not enough history yet" for a month |
| "Where are we on our goals — how much reached?" | 🟢 | `goals.starting_balance + sum(goal_contributions)` vs `target_amount`. 6 goals, 1 contribution row so far |
| "How much did we invest this month?" | 🔴→🟢 | **Not answerable as a flow today.** Investments live in `accounts` as *holdings* (qty/avg_cost), not as monthly contributions. The only flow record would be `transactions` with category `Savings & Investments` — and there are **zero transactions**. Answerable as "portfolio value / cost basis / unrealised gain" right now. The flow version becomes answerable as a *side effect* of the cash-outflow decision in §6.1: once every stock buy logs a transaction, "how much did we invest this month" is just a category-spend query |
| "Is a payment upcoming?" | 🟢 | `recurring` (24 rows, `day_of_month`, `autopay`, `end_date`) |
| **"Estimate my credit-card statement value"** | 🟡 *(approved — see §6.2)* | Needs migration `016`: `statement_day`, `due_day`, `credit_limit` on `accounts`. Then cycle spend = sum of card transactions between statement dates. **Accuracy is entirely a function of intake completeness** — see the warning in §6.2 |

### Doing things (write)

| Ask | Verdict | Notes |
| --- | --- | --- |
| "I bought 10 shares of X today, update it" | 🟢 *(scoped down — see §6.1)* | **Cash outflow only.** Logs a `transactions` row for the money leaving the account, category `Savings & Investments`. **Never touches `quantity`/`avg_cost`** — the portfolio stays screenshot-sourced, per CLAUDE.md |
| "Move the leftover into a goal" | 🟢 | `goal_contributions` insert. Trivially safe — additive, reversible |
| "Log my salary / a bonus" | 🟢 | `income` table exists and is empty-ish (1 row) |
| "Adjust a goal's target or monthly plan" | 🟢 | `goals` update, behind a confirm tap |
| "Update an account balance" | 🟢 | `accounts.value` update, behind a confirm tap |
| `/undo` the last thing | 🟡 | Needs an additive `deleted_at` column on `transactions` — the schema is additive-only, so this is a soft delete, never a `DELETE` |

### Being told (push)

| Ask | Verdict | Notes |
| --- | --- | --- |
| "80% of the budget used — spend wisely" | 🟢 | `budgets` vs month-to-date spend. Pure arithmetic, **no model call at all** |
| "You went over budget" | 🟢 | Same query, different threshold |
| "Month-end: X is left over, put it in stocks or a goal" | 🟢 | `sum(monthly_limit) - sum(actual)`, then offer goal buttons. The *suggestion* is deterministic; only the wording needs a model, and even that is optional |
| "Upcoming payment — make sure you have enough" | 🟡 | The "upcoming" half is 🟢 from `recurring`. The "do you have enough" half needs comparing to `accounts.value` for cash accounts — doable, but cash balances are manually maintained, so it's only as fresh as the last time someone updated them |
| "Credit card statement is due, here's the approx value" | 🟡 | Approved, Sprint 6. Same migration `016` and the same accuracy caveat |

**Everything that is 🔴 traces back to one of two root causes:** no statement-cycle
fields on `accounts`, or **zero transactions in the database**. The second one
fixes itself the day intake starts being used, and the first is one small
additive migration if you want it.

---

## 2. The elephant: none of the spend features have data

`transactions` has **0 rows**. Every budget-burn alert, every "how much on
groceries", every statement estimate reads that table. Building all of it before
a single receipt has gone through the pipeline means shipping a dozen features
that all confidently answer "0 AED".

This argues for a specific sequencing, and it's the main structural
recommendation of this document:

> **Ship the read/ask surface and the intake-reliability work first. Ship the
> proactive alerts last.** Alerts that fire against empty or half-trusted data
> train you to ignore the bot, and an ignored bot is the actual failure mode.

The receipt-tuning pass in `supabase/functions/telegram-intake/README.md` (10–15
real receipts) is the true prerequisite for half of this backlog. It's already
written; it just needs doing.

---

## 3. Cost

### API cost: effectively free. This is not a constraint.

Current model is Gemini 2.5 Flash-Lite via OpenRouter — roughly **$0.10 per
million input tokens, $0.40 per million output** (verify at build time; OpenRouter
pricing moves). Per interaction:

| Call | Tokens | Cost |
| --- | --- | --- |
| Intent classification (typed text) | ~400 in / ~20 out | ~$0.00005 |
| Question → query plan | ~1,200 in / ~60 out | ~$0.00015 |
| Phrasing the answer | ~400 in / ~60 out | ~$0.00007 |
| **A full question, end to end** | | **~$0.0003** |
| A receipt photo (already live) | ~1,500 in / ~120 out | ~$0.0003 |

At **30 questions a day** that's ~$0.27/month. Add the existing ~$0.04/month for
150 receipts. **Total under $0.50/month**, and most pushes need no model call at
all because the numbers come from SQL and the sentences can be templates.

Ways to go cheaper, in order of how much I'd recommend them:

1. **Skip the model on pushes entirely** — templated strings. Zero cost, zero
   latency, zero risk of a hallucinated sentence around a correct number. Do this.
2. **Regex the obvious intents** before calling the classifier — a message
   starting with "how much"/"what's"/"when" is a question with ~99% certainty.
   Cuts most classifier calls. Do this.
3. Cache the household context (categories/accounts) in the prompt — it's the
   bulk of the input tokens. Marginal.
4. Downgrade the model — **don't.** The planner mapping a question to a query is
   where a cheap failure produces a *wrong-looking answer*, and you'd be saving
   fractions of a cent.

### What actually costs something

| Thing | Cost |
| --- | --- |
| Supabase Edge Function invocations | Free tier is 500K/month. This design uses maybe 2–3K |
| pg_cron + pg_net | Free, in-database |
| Supabase database | Already paid for, no change |
| **Netlify build minutes** | **Unaffected — this is all backend.** No production build needed for any of it, per CLAUDE.md's batching rule |
| Groq Whisper (voice) | Still switched off; only needed if you want voice questions too |

The real budget here is **your attention**, not dollars. Which is why the push
catalogue below is deliberately shorter than what's technically possible.

---

## 4. Two cross-cutting problems worth deciding once

**Currency.** `transactions.currency` can be AED/INR/USD. A question like "how
much did we spend this month" must convert before summing, using the FX rates in
`settings` — the same AED-pivot the app does at render time. If this is skipped,
an INR Zerodha row silently corrupts every total. The conversion belongs in **one
SQL view** used by every query, not repeated per query.

**Timezone.** Already flagged in the architecture doc: `intake.ts:472` computes
"today" in UTC, so 00:00–04:00 GST lands on the previous day. Every "this week",
"this month" and "due tomorrow" in this backlog inherits that bug. It's a
one-line fix and it must land in Sprint 1.

---

## 4b. Migration numbering — claim these before writing SQL

Sprints add migrations in this order. **Check `supabase/schema/` for the highest
existing number before creating one** — if any of these are already taken, shift
up and update this table.

| # | File | Sprint | Contents |
| --- | --- | --- | --- |
| 015 | `015_bot_expansion.sql` | 1 | `transactions.deleted_at`, `notifications` |
| 016 | `016_money_view.sql` | 1 | `v_transactions_aed` FX-normalised view |
| 017 | `017_pending_actions.sql` | 4 | `pending_actions` (propose-then-tap) |
| 018 | `018_push_cron.sql` | 5 | `pg_cron` + `pg_net` + the hourly schedule |
| 019 | `019_statement_cycle.sql` | 6 | `statement_day`, `due_day`, `credit_limit` |

Last applied before this work: `014_category_rules.sql`.

## 5. Sprint plan

Six sprints. Each is independently shippable and leaves the bot more useful than
it was. Backend-only unless marked — so no Netlify minutes burnt except where noted.

**All of this is now in Taskiv** (project `Our Money v4`), as epics 8–13 and
tasks **#44–79**, plus the pre-existing #22. Each task carries the file paths,
schema, exact reply copy, edge cases, acceptance criteria and test files needed
to execute it without re-deriving decisions. The numbered list below is the
index; Taskiv is the source of truth for the detail.

Three pairs of items below were merged into single tasks where they were the same
file of work (fixture corpus + `/help`; portfolio + needs-review count; push
settings keys + Settings UI), and one task was added that this list did not have
(the outbound chat-id allowlist, #49). 38 items → 36 Taskiv tasks.

| Sprint | Epic | Tasks |
| --- | --- | --- |
| 1 Foundations | 8 | #22, #44–49 |
| 2 Router + first questions | 9 | #50–53 |
| 3 Full read surface | 10 | #54–59 |
| 4 Safe writes | 11 | #60–67 |
| 5 Proactive pushes | 12 | #68–73 |
| 6 Month-end + statement | 13 | #74–79 |

### Sprint 1 — Foundations (no new user-facing features)
*Nothing else can be trusted until these land.*
1. Restore `TELEGRAM_WEBHOOK_SECRET` + re-run `setWebhook` (Taskiv #22). **Blocker for every read/write feature** — the allowlist trusts a request-body field
2. Fix the UTC → Asia/Dubai date bug
3. Store the group chat id in `settings.tg_chat_id`
4. Extract `_shared/` (telegram.ts, store.ts, types.ts) for reuse by the push function
5. Migration `015`: `transactions.deleted_at`, `notifications` table
6. Money view: one SQL view doing FX-normalised spend, used by everything downstream

### Sprint 2 — The router + the first questions
7. Deterministic pre-router + regex fast path + classifier fallback (spend-by-default)
8. Query toolbox skeleton + period parser (this month / last month / this week / last N days / explicit range)
9. First five queries: category spend, total spend, per-person spend, per-account spend, recent transactions
10. Router fixture corpus (~30 messages) in `fixtures/`
11. Rewrite `/help` as a real catalogue

### Sprint 3 — The rest of the read surface
12. Budget vs actual — single category and the full grid
13. Net worth, total and per-owner
14. Goal progress
15. Upcoming bills / payments
16. Portfolio summary (value, cost basis, unrealised gain — *not* monthly flow)
17. Honest refusal path for anything outside the enum

### Sprint 4 — Safe writes (propose-then-tap)
18. Generic confirm-before-write callback plumbing
19. `/undo` (soft delete)
20. `/review` — walk the `needs_review` queue
21. Goal contribution from chat
22. Account balance update from chat
23. Log income from chat
24. Stock purchase → cash-outflow transaction (§6.1). Ticker + quantity into `note`/`tags`; holdings untouched
25. Category rules ("always put Talabat under Dining Out") — `category_rules` table already exists

### Sprint 5 — Proactive pushes (the approved three)
*Do this after real transactions exist, not before.*
26. `telegram-push` Edge Function + pg_cron/pg_net migration + job key
27. `notifications` dedupe + quiet hours (22:00–07:00 GST) + daily cap
28. Budget burn at 80% / over budget
29. Bill due in 2 days (non-autopay only)
30. Weekly digest (Sunday)
31. Push on/off toggles in `settings` — the other five ship built-but-off
32. **Settings UI for the toggles** — the one item in the whole plan that needs a Netlify build

### Sprint 6 — The clever stuff
33. Month-end leftover sweep (§6.3): "X left over" → [Emergency Fund] [Another goal] [Ignore]
34. Migration `016`: `statement_day`, `due_day`, `credit_limit` on `accounts`
35. CC statement estimate + due reminder (§6.2), worded as a floor, not a forecast
36. Cash-cover check on upcoming bills
37. Unusual-spend flag (>2× the 90-day category median) — *off by default*
38. Quiet-spell nudge — *off by default*

### Deliberately not in the plan
- Model-written SQL (blast radius on a service-role key)
- "Should we…?" advice questions — a confident wrong answer costs real money
- Voice-note *questions* (voice intake is separate and still needs `GROQ_API_KEY`)
- **Bot writes to `quantity`/`avg_cost` on a holding** — settled in §6.1
- Anything reading a live market price to value a stock buy

---

## 6. Decisions (settled 10 Aug 2026)

### 6.1 Stock purchases: cash outflow only

A chat message about buying stock writes **a `transactions` row and nothing
else**. `accounts.quantity`, `avg_cost` and `last_price` are never written by the
bot. The portfolio remains screenshot-sourced, so CLAUDE.md's money-data rule
survives intact and a typo can never quietly change net worth.

```
"bought 12 SKHY at 21.40 today"
→ Savings & Investments · 256.80 USD · SKHY ×12 · Wio USD
  Logged as cash out. Portfolio quantities unchanged —
  update those from your broker screenshot.
```

The ticker and quantity still go into `note`/`tags` so the row is reconcilable
against the broker statement later. **Bonus:** this is what makes "how much did
we invest this month" answerable at all — it turns investing into a tracked flow
for the first time.

### 6.2 Credit-card statement estimate: build it, with a loud caveat

Migration `016` adds `statement_day`, `due_day`, `credit_limit` to `accounts`.
Cycle spend is summed from transactions on that card between statement dates.

**The caveat is not optional, and it should be in the message itself.** The
estimate is only as complete as intake. Every restaurant bill nobody photographed
is missing from it, so the number is a **floor, not a forecast** — and an
under-stated statement estimate is more dangerous than no estimate, because it
would have you set aside too little.

So the message says what it actually knows:

```
ENBD Noon CC — statement closes in 3 days
Captured on this card so far: 2,840 AED (17 transactions)
Due 12 Sep. This only counts what's been logged —
check the bank app before you transfer.
```

Not "your statement will be 2,840". This ships in Sprint 6, after intake has a
real track record; shipping it earlier would produce confident 0 AED estimates.

### 6.3 Month-end leftover: tell, then one tap

Bot reports the leftover and offers `[Add to Emergency Fund] [Another goal]
[Ignore]`. Nothing moves without a tap. Reuses the Sprint 4 confirm plumbing, so
it costs almost nothing once that exists.

### 6.4 Pushes: shared household group, start with three

Budget burn at 80%, bill due in 2 days, weekly Sunday digest — all to the shared
group, matching the joint-ledger design. The other five stay built-but-off behind
`settings` toggles, to be switched on one at a time once the cadence feels right.

Rationale for starting small: the bot's own delivery channel is the same chat
receipt intake lives in. **A muted bot is a broken intake pipeline**, so alert
volume is a reliability concern, not just a taste one.
