-- Cashback logging (docs/telegram-bot-round2-design.md §4).
-- Additive only, never destructive — this database carries real money data.
--
-- Cashback is real income, not a spend, and unlike a transaction (write-then-
-- flag) it's propose-then-tap: nothing lands in `income` until the household
-- taps Apply (CLAUDE.md, "Telegram bot expansion" rule #3). A stateless Edge
-- Function invocation has nowhere to hold a not-yet-written proposal between
-- the propose message and the button tap, so this table is that holding spot.
-- The design doc's own schema summary assumed no new table would be needed
-- for this — that assumption didn't survive contact with propose-then-tap's
-- "nothing written until the tap" requirement.

create table if not exists pending_income (
  id uuid primary key default gen_random_uuid(),
  person text not null,
  source text,
  kind text not null default 'other' check (kind in (
    'salary', 'bonus', 'dividend', 'interest', 'trading_pnl', 'other'
  )),
  amount numeric,
  currency text not null default 'AED',
  date date not null,
  created_at timestamptz not null default now()
);

create index if not exists pending_income_created_idx on pending_income (created_at desc);

alter table pending_income enable row level security;

drop policy if exists "pending_income household all" on pending_income;
create policy "pending_income household all" on pending_income
  for all to authenticated using (true) with check (true);
