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

## Screens (Phase 1 scope)

- **Home** — spend/budget/savings-rate at a glance, due bills, recent transactions, top goals
- **Accounts** — Assets (Cash/Investments/Real Estate/Vehicles/Valuables/Other), Liabilities (Credit Card/Loan/Mortgage/Other). Manual entry is first-class. Net worth chart on top.
- **Transactions** — category, split, notes, tags, owner. Telegram/AI intake writes here directly.
- **Cash Flow** — Income/Expense/Savings/Savings-rate cards, category + person breakdown (69/31 split matters here)
- **Budget** — Planned vs Actual vs Remaining, grouped Fixed/Non-monthly/Flexible
- **Recurring** — bill/EMI calendar: car loan, CC EMIs, mobile EMI, rent cheques, LIC premiums
- **Goals** — Save up (Emergency Fund + others) and Pay down (debts) as two modes of one feature
- **Settings** — names, currencies/FX, FIRE assumptions, category management, four-account mapping

No dedicated Cards tab in Phase 1 (deliberate — folded into Accounts as liabilities +
Recurring for due dates). See decisions log in Taskiv for rationale.

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
forecast_events (id, kind: house/child/retirement/custom, target_date, params json) -- Phase 2
```

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
- Any revival of statement-cycle math, cashback estimator, fee-waiver tracker for
  cards (cut from the old plan, not carried forward)

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
