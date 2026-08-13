# Our Money v4 — Product Plan

Private finance app for Shrey + wife, Dubai, all in AED (INR for remittances/India
holdings). Monarch-inspired structure, adapted for: no UAE bank sync available (manual
entry + Telegram/AI intake replaces "connect your bank"), two users as first-class from
day one (69/31 proportional contribution split, four-account structure), and the
couple's real financial situation already modeled.

This file is the working reference copied into the repo per the Epic 1 scaffolding
task, sourced from the confirmed `project_brief` context entry in Taskiv
(project `Our Money v4`, entry id `f7f736e9-2c45-4a97-94e8-56dcc8639136`). Keep it in
sync with Taskiv decisions as the plan evolves.

## Screens (current — 10 tabs, drifted from Phase 1 scope below as real usage demanded it)

- **Home** — desktop-dashboard layout: spend/budget/savings-rate at a glance, due bills, recent transactions, top save-up goals
- **Accounts** — Cash/Real Estate/Vehicles/Valuables/Other assets + Liabilities (Credit Card/Loan/Mortgage/Other). Excludes investment accounts (they moved to their own tab) but still counts them in net worth totals. Net worth history chart (`nw_daily`), Summary and Composition (type/owner) panels, Monarch-style.
- **Investments** — split out of Accounts once real portfolio data (India equities, US/gold, US/metals) made it worth its own tab. Combined/Shrey/Tarika owner filter, allocation breakdown, per-holding gain/loss, manually-triggered price refresh (`refresh-prices` Edge Function, US stocks + BTC only).
- **Transactions** — category, split, notes, tags, owner, Summary sidebar (count/largest/average/first-last, CSV export). Telegram/AI intake writes here directly. Excludes investment accounts from the account picker.
- **Reports** (renamed from Cash Flow) — Cash Flow/Spending/Income sub-tabs. Cash Flow leads with a Sankey diagram (income sources → hub → spend destinations). Spending has breakdown/trends toggle + CSV export.
- **Budget** — Planned vs Actual vs Remaining, grouped Fixed/Non-monthly/Flexible
- **Recurring** — bill/EMI calendar: car loan, CC EMIs, mobile EMI, rent cheques, LIC premiums
- **Goals** — save_up kind only now (Emergency Fund, house downpayment, vacation, etc). Pay-down debts moved out to their own screen.
- **Debts** — split out of Goals: car EMI, credit cards, other loans (pay_down kind). Same `goals` table, `kind` column — presentation-only split.
- **Settings** — names, currencies/FX, FIRE assumptions, category management, four-account mapping

No dedicated Cards tab (deliberate — folded into Accounts as liabilities + Recurring
for due dates). See decisions log in Taskiv for rationale.

Also shipped, cutting across all screens: dark mode (CSS custom-property value
inversion under `.dark`, not per-component variants) and a global AED/USD/INR
currency toggle (AED-pivot conversion at render time only, device-local via
`PrefsContext`/localStorage, never synced between the two users' devices).

## Data model

```
accounts (id, name, owner, type: cash/investment/real_estate/vehicle/valuable/other/
          credit_card/loan/mortgage/other_liability, is_liability, currency, value,
          ticker, quantity, avg_cost, last_price, updated_at)
transactions (id, date, amount, currency, account_id, category, subcategory, owner,
          note, tags[], source: manual/telegram, needs_review, telegram_msg_id)
categories (id, name, group: Needs/Wants/Savings, icon)
budgets (id, category_id, monthly_limit, group)
recurring (id, name, kind: income/expense/emi, amount, currency, owner, day_of_month,
          months, linked_account_id, autopay)
goals (id, name, kind: save_up/pay_down, icon, target_amount, monthly_plan, priority,
          target_date, linked_account_id)
goal_contributions (id, goal_id, amount, date, note)
income (id, person, source, kind: salary/bonus/dividend/interest/trading_pnl/other,
          amount, currency, date)
settings (key, value -- fx rates, fire_expense/swr/return, 69/31 split, four-account mapping)
nw_snapshots (id, month, total_aed, by_owner json, by_type json)
nw_daily (id, day, total_aed, assets_aed, liabilities_aed, by_owner json, by_type json,
          created_at) -- additive sibling to nw_snapshots; one row/day, upserted on
          Accounts load, recorded from now forward only (never backfilled/estimated)
forecast_events (id, kind: house/child/retirement/custom, target_date, params json) -- Phase 2
category_rules (id, pattern, category, created_at) -- Edit Rules, auto-categorise on create

-- Applied since (verified against the live database, 12 Aug 2026):
transactions.deleted_at                                  -- soft delete for /undo (015)
notifications (id, kind, dedupe_key unique, chat_id, telegram_msg_id, payload, sent_at)  -- (015)
transactions.transaction_group_id / group_kind / transfer_direction  -- (025) what a group *is*
transactions.idempotency_key                             -- (027) webhook redelivery is a no-op
media_group_files (media_group_id, file_id, chat_id)     -- (027) album membership as rows
household_members (user_id, display_name, added_at)      -- (023) who may see any of this
accounts.price_updated_at / price_source                 -- (028) a fetched price vs any edit

-- Still not applied (see docs/telegram-bot-sprint-plan.md §4b):
pending_actions (id, kind, payload, chat_id, requested_by, expires_at, resolved_at, resolution)
accounts.statement_day / due_day / credit_limit          -- credit-card cycle
v_transactions_aed                                       -- FX-normalised view, one source of truth
```

The full migration list, with what each one closes, is in
`supabase/schema/README.md`.

All migrations additive-only, never destructive — Supabase carries real live data
eventually.

## Categories (full set, incl. 5 previously missing)

Standard set: Rent, Utilities, Groceries, Transport & Fuel, Dining Out, Entertainment,
Shopping, Travel, Subscriptions, Personal Care, Other, Savings & Investments, Family
Support — **plus** Clothing, Medical (split from Health & Insurance), Gifts, Car
Insurance & Registration, Car Servicing.

## Real numbers to pre-seed

- Income: Shrey 20,000 AED/mo, wife 8,500 AED/mo, Shrey bonus 6,000 (Jun+Dec), Shrey
  flight allowance 3,400 (May), wife flight allowance 2,500 (Dec), wife performance
  bonus ~1,700 variable (~50% hit rate)
- Debt/recurring: car loan EMI 2,194/mo, car-down-payment CC EMI 1,542/mo
  (→ May 2027), 0% CC loan 5,207/mo (→ Dec 2026), mobile EMI 134/mo
- Goals: Emergency Fund (save_up) target 70,000 AED, priority 1; the CC/car debts
  above as pay_down goals
- Four-account structure: Joint (69/31 funded) / Emergency+House (Wio Fixed Saving
  Spaces) / Personal x2
- Household income split ratio: 69% Shrey / 31% wife (proportional to salary)

## Stack

React + Vite, Netlify (build pipeline, not drag-and-drop), Supabase
(auth/Postgres/Realtime/Edge Functions — carried over from the old build, it worked).
Built in Claude Code, not chat artifacts. Chrome extension connected for live visual
verification during dev (this was impossible in the old build and caused UI iteration
to stall).

## Telegram/AI intake (Phase 1, not deferred)

Supabase Edge Function (same pattern as the existing `quotes` price-fetch function).
Gemini 2.5 Flash-Lite (via OpenRouter) for vision/text extraction — see decision
5. Groq Whisper for voice notes is built but switched off until a `GROQ_API_KEY`
is set; photo and text intake ship first.
Confidence-gated: high confidence auto-logs with an FYI ping; low confidence writes
immediately but sets `needs_review=true` and sends inline Confirm/Fix buttons in
Telegram before treating it as clean data. This directly replaces the old guessed
"AED 2,000/month untracked discretionary" placeholder with a real tracked number.

## Phase 2+ (deferred, not built in Phase 1)

- Transaction-level "assign to partner for review"
- "Link spend to goal"
- `forecast_events` table / forecasting UI (house, child, retirement, custom)
- Cashback estimator and fee-waiver tracker for cards (cut from the old plan, not
  carried forward)
- ~~Statement-cycle math~~ — **reversed 10 Aug 2026, see decision 7.** Revived in
  a narrow form for the credit-card reminder: `statement_day`/`due_day`/
  `credit_limit` on `accounts`, and a cycle-spend total worded as a floor rather
  than a forecast. The cashback and fee-waiver features stay cut.

## Decisions log

Full rationale for each decision below lives in Taskiv (`get_project_memory` /
`list_context_entries`, type=decision, project `Our Money v4`).

1. **Stack: React+Vite+Supabase+Netlify, built in Claude Code** — old single-file
   build stalled during UI iteration with no way to visually verify changes; Claude
   Code + Chrome extension fixes that.
2. **No dedicated Cards tab** — folded into Accounts (liabilities) + Recurring (due
   dates); matches Monarch's actual UI and cuts scope that never shipped before.
3. **Telegram/AI intake ships in Phase 1** — it's the precondition for every other
   number in the app being trustworthy; without it, categories/budgets are just
   another guess.
4. **Assign-to-partner review + link-spend-to-goal are Phase 2** — not blocking; the
   couples-collaboration need is already covered by Telegram intake's own
   confidence/review flow in Phase 1.
5. **Extraction model is Gemini 2.5 Flash-Lite, not GPT-4o-mini** — reverses the
   original choice in decision 3's implementation. GPT-4o-mini's cheap text
   pricing does not apply to images: OpenAI inflates its image token count ~33x
   specifically so that an image costs the same dollars as it does on full
   GPT-4o. This workload is ~90% photographs, so that pricing quirk dominates.
   Gemini Flash-Lite reads a receipt for roughly a fifteenth of the cost
   ($0.04/month vs $0.59/month at 150 receipts). Still routed through
   OpenRouter, so the swap was a config value, not a code change. Accuracy on
   real receipts is unproven for *either* model — the tuning pass in the
   function README is what settles that, and re-running it against a different
   model costs one secret.
6. **The Telegram bot expands into ask / do / be told** — designed 10 Aug 2026 in
   `docs/telegram-bot-expansion.md` and `docs/telegram-bot-sprint-plan.md`,
   backlogged as Taskiv epics 8–13 (#44–79). The load-bearing constraint is that
   **the model never writes SQL and never does arithmetic**: it maps a question
   onto one entry in a closed query enum and Postgres computes every digit. The
   function holds the service-role key, so text-to-SQL would have an unbounded
   blast radius; and an LLM that sums eleven transactions will be quietly wrong
   occasionally, which is the failure this app exists to prevent. Second
   constraint: the intent router defaults to "spend" on any doubt, because a
   misrouted question costs an `/undo` and a misrouted spend is lost forever.
7. **Statement-cycle math is revived, narrowly** — reverses the Phase 2+ cut
   above. `accounts` gains `statement_day`/`due_day`/`credit_limit` and the bot
   reports cycle spend on a card. The number is explicitly a **floor, not a
   forecast**: it counts only what was logged, so every unphotographed bill is
   missing from it. An under-stated estimate is more dangerous than none — it
   would have the household set aside too little — so the wording says so in
   every variant. Cashback and fee-waiver tracking stay cut.
8. **A stock purchase logged by chat writes a cash outflow only** — never
   `quantity`, `avg_cost` or `last_price`. Mechanically the average-cost recompute
   is trivial, but the money-data rule (holdings come from broker screenshots,
   never a typed figure) exists precisely because two separately-typed average
   prices were already wrong once, invisibly. Side benefit: this makes "how much
   did we invest this month" answerable at all, since investments are otherwise
   stored only as positions, with no record of contributing.
9. **Writes other than transactions are propose-then-tap** — nothing hits the
   database until a human taps Apply. Intake's optimistic write-then-flag is
   justified only by "a spend not written is lost forever"; nobody forgets moving
   2,000 AED into a goal, and a wrong `accounts.value` corrupts `nw_daily`
   permanently, since that table is never backfilled.
10. **Proactive pushes start at three, into the shared group** — bill due, budget
   burn, weekly digest. The other five ship built-but-off behind `settings`
   toggles. Alert restraint is a reliability control, not taste: the bot pushes
   into the same chat receipt intake uses, and a muted bot is a broken intake
   pipeline.
