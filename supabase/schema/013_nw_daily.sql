-- Daily net-worth history, for the Accounts screen's over-time chart.
--
-- `nw_snapshots` already exists but is keyed `month date unique` — one row per
-- month, by design. That is the right grain for long-term trend, but it means a
-- brand-new install shows a single point and gains one per month, which is not
-- a chart anyone can read this year. Rather than overload `month` with daily
-- dates (the column name would then lie), this adds a sibling table at daily
-- grain and leaves `nw_snapshots` untouched for the monthly rollup.
--
-- Additive only: nothing here alters or drops the existing table.

create table if not exists nw_daily (
  id uuid primary key default gen_random_uuid(),
  day date not null unique,
  total_aed numeric not null,
  assets_aed numeric not null default 0,
  liabilities_aed numeric not null default 0,
  by_owner jsonb not null default '{}',
  by_type jsonb not null default '{}',
  created_at timestamptz not null default now()
);

alter table nw_daily enable row level security;

-- Household model, matching 002_rls.sql: any authenticated user reads and
-- writes. This is a two-person private app, not multi-tenant.
drop policy if exists "nw_daily household read" on nw_daily;
create policy "nw_daily household read" on nw_daily
  for select to authenticated using (true);

drop policy if exists "nw_daily household write" on nw_daily;
create policy "nw_daily household write" on nw_daily
  for insert to authenticated with check (true);

drop policy if exists "nw_daily household update" on nw_daily;
create policy "nw_daily household update" on nw_daily
  for update to authenticated using (true) with check (true);

create index if not exists nw_daily_day_idx on nw_daily (day desc);
