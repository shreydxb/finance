-- Our Money v4 — initial schema
-- Additive-only discipline: every statement is safe to re-run.
-- Never DROP, never destructive. New changes go in new numbered files.

create extension if not exists pgcrypto;

-- ── accounts ──────────────────────────────────────────────────────────────
create table if not exists accounts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner text not null,
  type text not null check (type in (
    'cash', 'investment', 'real_estate', 'vehicle', 'valuable', 'other',
    'credit_card', 'loan', 'mortgage', 'other_liability'
  )),
  is_liability boolean not null default false,
  currency text not null default 'AED',
  value numeric not null default 0,
  ticker text,
  quantity numeric,
  avg_cost numeric,
  last_price numeric,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

-- ── categories ────────────────────────────────────────────────────────────
create table if not exists categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  "group" text not null check ("group" in ('Needs', 'Wants', 'Savings')),
  icon text,
  created_at timestamptz not null default now()
);

-- ── transactions ──────────────────────────────────────────────────────────
create table if not exists transactions (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  amount numeric not null,
  currency text not null default 'AED',
  account_id uuid not null references accounts(id),
  category text,
  subcategory text,
  owner text,
  note text,
  tags text[] not null default '{}',
  source text not null default 'manual' check (source in ('manual', 'telegram')),
  needs_review boolean not null default false,
  telegram_msg_id bigint,
  created_at timestamptz not null default now()
);

-- ── budgets ───────────────────────────────────────────────────────────────
create table if not exists budgets (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references categories(id),
  monthly_limit numeric not null,
  "group" text not null check ("group" in ('Fixed', 'Non-monthly', 'Flexible')),
  created_at timestamptz not null default now()
);

-- ── recurring ─────────────────────────────────────────────────────────────
create table if not exists recurring (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  kind text not null check (kind in ('income', 'expense', 'emi')),
  amount numeric not null,
  currency text not null default 'AED',
  owner text,
  day_of_month smallint check (day_of_month between 1 and 31),
  months smallint[] not null default '{}',
  linked_account_id uuid references accounts(id),
  autopay boolean not null default false,
  created_at timestamptz not null default now()
);

-- ── goals ─────────────────────────────────────────────────────────────────
create table if not exists goals (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  kind text not null check (kind in ('save_up', 'pay_down')),
  icon text,
  target_amount numeric not null,
  monthly_plan numeric,
  priority integer,
  target_date date,
  linked_account_id uuid references accounts(id),
  created_at timestamptz not null default now()
);

-- ── goal_contributions ────────────────────────────────────────────────────
create table if not exists goal_contributions (
  id uuid primary key default gen_random_uuid(),
  goal_id uuid not null references goals(id) on delete cascade,
  amount numeric not null,
  date date not null,
  note text,
  created_at timestamptz not null default now()
);

-- ── income ────────────────────────────────────────────────────────────────
create table if not exists income (
  id uuid primary key default gen_random_uuid(),
  person text not null,
  source text,
  kind text not null check (kind in (
    'salary', 'bonus', 'dividend', 'interest', 'trading_pnl', 'other'
  )),
  amount numeric not null,
  currency text not null default 'AED',
  date date not null,
  created_at timestamptz not null default now()
);

-- ── settings ──────────────────────────────────────────────────────────────
create table if not exists settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

-- ── nw_snapshots ──────────────────────────────────────────────────────────
create table if not exists nw_snapshots (
  id uuid primary key default gen_random_uuid(),
  month date not null unique,
  total_aed numeric not null,
  by_owner jsonb not null default '{}',
  by_type jsonb not null default '{}',
  created_at timestamptz not null default now()
);

-- ── forecast_events (Phase 2, schema only) ───────────────────────────────
create table if not exists forecast_events (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('house', 'child', 'retirement', 'custom')),
  target_date date,
  params jsonb not null default '{}',
  created_at timestamptz not null default now()
);
