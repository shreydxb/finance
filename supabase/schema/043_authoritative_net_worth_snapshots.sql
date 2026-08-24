-- 043_authoritative_net_worth_snapshots.sql — SHR-113 Phase A
--
-- Authoritative daily net-worth snapshot foundation. This migration is
-- additive for history data: existing nw_daily values are never updated or
-- backfilled, and nw_snapshots remains an empty/deprecated read surface.
-- Scheduling is deliberately not installed or activated by this migration.

begin;

-- Provider quote/session time is not the same fact as fetch/write time.
alter table public.accounts
  add column if not exists price_quote_at timestamptz;

comment on column public.accounts.price_quote_at is
  'Provider quote/session as-of timestamp for last_price. Distinct from price_updated_at, which is fetch/write time. Null cannot qualify as Complete under SHR-113 snapshot policy v1.';

create table if not exists public.nw_snapshot_runs (
  id uuid primary key default gen_random_uuid(),
  target_day date not null unique,
  idempotency_key text not null unique,
  trigger_kind text not null check (trigger_kind in ('scheduled', 'manual_recovery')),
  policy_version text not null default 'shr-113-snapshot-policy-v1'
    check (policy_version = 'shr-113-snapshot-policy-v1'),
  status text not null default 'running'
    check (status in ('running', 'retryable_failed', 'skipped_incomplete', 'published')),
  timezone text not null default 'Asia/Dubai' check (timezone = 'Asia/Dubai'),
  active_attempt_number integer,
  active_invocation_id uuid,
  active_started_at timestamptz,
  snapshot_at timestamptz,
  quality_status text check (quality_status in ('complete', 'provisional', 'incomplete')),
  input_digest text,
  source_version text,
  final_evidence jsonb not null default '{}'::jsonb,
  nw_daily_id uuid unique,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  check (
    (active_attempt_number is null and active_invocation_id is null and active_started_at is null)
    or
    (active_attempt_number is not null and active_attempt_number > 0
      and active_invocation_id is not null and active_started_at is not null)
  ),
  check (
    status <> 'published'
    or (quality_status in ('complete', 'provisional') and snapshot_at is not null
      and input_digest is not null and source_version is not null
      and nw_daily_id is not null and completed_at is not null
      and active_attempt_number is null)
  )
);

comment on table public.nw_snapshot_runs is
  'SHR-113 one logical run per Dubai reporting date. Retry attempts are separate append-only events. A published run and its item manifest are immutable.';
comment on column public.nw_snapshot_runs.target_day is
  'Dubai reporting date for a valuation close. It does not assert that every source fact existed by 23:59:59 Dubai.';
comment on column public.nw_snapshot_runs.snapshot_at is
  'Actual capture/valuation-close instant. Source-specific as-of times remain on immutable items and attempt evidence.';

create table if not exists public.nw_snapshot_attempt_events (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.nw_snapshot_runs(id) on delete restrict,
  attempt_number integer not null check (attempt_number > 0),
  invocation_id uuid not null,
  event_kind text not null check (event_kind in (
    'started', 'fx_refresh', 'price_refresh', 'capture', 'failed', 'finished'
  )),
  outcome text not null check (outcome in (
    'started', 'succeeded', 'partial', 'failed', 'skipped_incomplete', 'published'
  )),
  evidence jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  unique (run_id, attempt_number, event_kind),
  unique (run_id, invocation_id, event_kind)
);

comment on table public.nw_snapshot_attempt_events is
  'Append-only phase/failure evidence for each logical-run attempt. Earlier retry failures are never overwritten.';

create table if not exists public.nw_snapshot_items (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.nw_snapshot_runs(id) on delete restrict,
  account_id uuid not null,
  owner text,
  account_type text not null,
  is_liability boolean not null,
  currency text not null,
  source_native_value numeric not null,
  quantity numeric,
  unit_price numeric,
  canonical_native_value numeric not null,
  fx_rate_to_aed numeric not null check (fx_rate_to_aed > 0),
  canonical_value_aed numeric not null,
  valuation_method text not null,
  price_source text,
  account_value_at timestamptz,
  price_fetched_at timestamptz,
  price_quote_at timestamptz,
  fx_fetched_at timestamptz not null,
  fx_as_of timestamptz not null,
  quality_status text not null check (quality_status in ('complete', 'provisional')),
  quality_evidence jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (run_id, account_id)
);

comment on table public.nw_snapshot_items is
  'Immutable exact valuation and breakdown inputs for one published authoritative run; intentionally not a general account-history ledger.';

-- Nullable additions classify old rows as legacy without touching a tuple.
alter table public.nw_daily
  add column if not exists run_id uuid,
  add column if not exists snapshot_at timestamptz,
  add column if not exists published_at timestamptz,
  add column if not exists quality_status text,
  add column if not exists investment_value_aed numeric,
  add column if not exists source_version text,
  add column if not exists quality_evidence jsonb,
  add column if not exists input_digest text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'nw_daily_quality_status_check'
      and conrelid = 'public.nw_daily'::regclass
  ) then
    alter table public.nw_daily
      add constraint nw_daily_quality_status_check
      check (quality_status is null or quality_status in ('complete', 'provisional'));
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'nw_daily_run_id_key'
      and conrelid = 'public.nw_daily'::regclass
  ) then
    alter table public.nw_daily add constraint nw_daily_run_id_key unique (run_id);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'nw_daily_run_id_fkey'
      and conrelid = 'public.nw_daily'::regclass
  ) then
    alter table public.nw_daily
      add constraint nw_daily_run_id_fkey foreign key (run_id)
      references public.nw_snapshot_runs(id) on delete restrict;
  end if;
end $$;

comment on column public.nw_daily.run_id is
  'Null means preserved legacy/unknown provenance. Non-null identifies an immutable SHR-113 authoritative run.';

create index if not exists nw_snapshot_attempt_events_run_idx
  on public.nw_snapshot_attempt_events (run_id, attempt_number, occurred_at);
create index if not exists nw_snapshot_items_run_idx
  on public.nw_snapshot_items (run_id, account_id);

-- Append-only/final immutability is enforced even for trusted direct writes.
create or replace function private.reject_nw_snapshot_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception '% rows are immutable', tg_table_name using errcode = '55000';
end;
$$;

drop trigger if exists nw_snapshot_attempt_events_immutable on public.nw_snapshot_attempt_events;
create trigger nw_snapshot_attempt_events_immutable
before update or delete on public.nw_snapshot_attempt_events
for each row execute function private.reject_nw_snapshot_mutation();

drop trigger if exists nw_snapshot_items_immutable on public.nw_snapshot_items;
create trigger nw_snapshot_items_immutable
before update or delete on public.nw_snapshot_items
for each row execute function private.reject_nw_snapshot_mutation();

create or replace function private.protect_nw_snapshot_run()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'snapshot runs cannot be deleted' using errcode = '55000';
  end if;
  if old.status = 'published' then
    raise exception 'published snapshot runs are immutable' using errcode = '55000';
  end if;
  if new.id <> old.id
    or new.target_day <> old.target_day
    or new.idempotency_key <> old.idempotency_key
    or new.trigger_kind <> old.trigger_kind
    or new.policy_version <> old.policy_version
    or new.timezone <> old.timezone
    or new.created_at <> old.created_at then
    raise exception 'snapshot run identity is immutable' using errcode = '55000';
  end if;
  return new;
end;
$$;

drop trigger if exists nw_snapshot_runs_protect on public.nw_snapshot_runs;
create trigger nw_snapshot_runs_protect
before update or delete on public.nw_snapshot_runs
for each row execute function private.protect_nw_snapshot_run();

create or replace function private.protect_authoritative_nw_daily()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if old.run_id is not null then
    raise exception 'authoritative nw_daily rows are immutable' using errcode = '55000';
  end if;
  return old;
end;
$$;

drop trigger if exists nw_daily_authoritative_immutable on public.nw_daily;
create trigger nw_daily_authoritative_immutable
before update or delete on public.nw_daily
for each row execute function private.protect_authoritative_nw_daily();

-- Phase-A policy constants live only in this SHR-113 policy function. The
-- generic SHR-111 canonical views deliberately remain unchanged.
create or replace function public.evaluate_nw_snapshot_policy_v1(
  p_target_day date,
  p_snapshot_at timestamptz,
  p_fx_fetched_at timestamptz,
  p_fx_as_of timestamptz,
  p_price_evidence jsonb
)
returns table (
  account_id uuid,
  owner text,
  account_type text,
  is_liability boolean,
  currency text,
  source_native_value numeric,
  quantity numeric,
  unit_price numeric,
  canonical_native_value numeric,
  fx_rate_to_aed numeric,
  canonical_value_aed numeric,
  valuation_method text,
  price_source text,
  account_value_at timestamptz,
  price_fetched_at timestamptz,
  price_quote_at timestamptz,
  fx_fetched_at timestamptz,
  fx_as_of timestamptz,
  item_quality text,
  quality_evidence jsonb
)
language sql
stable
security invoker
set search_path = ''
as $$
with constants as (
  select
    interval '6 hours' as fx_max_age,
    interval '36 hours' as quote_complete_age,
    interval '96 hours' as quote_provisional_age,
    interval '5 minutes' as future_clock_tolerance,
    (p_target_day::timestamp at time zone 'Asia/Dubai') as target_day_start
), evidence as (
  select
    coalesce(p_price_evidence -> 'updated', '[]'::jsonb) as updated,
    coalesce(p_price_evidence -> 'failed', '[]'::jsonb) as failed
), based as (
  select
    a.*,
    raw.price_quote_at as snapshot_price_quote_at,
    c.*,
    exists (
      select 1 from jsonb_array_elements(e.updated) u
      where u ->> 'id' = a.id::text
        and (u ->> 'price')::numeric = a.last_price
        and (u ->> 'fetched_at')::timestamptz = a.price_updated_at
        and (u ->> 'quote_at')::timestamptz = raw.price_quote_at
        and u ->> 'source' = a.price_source
    ) as refreshed_this_attempt,
    exists (
      select 1 from jsonb_array_elements(e.failed) f
      where f ->> 'id' = a.id::text
    ) as failed_this_attempt
  from public.v_canonical_accounts_aed a
  join public.accounts raw on raw.id = a.id
  cross join constants c
  cross join evidence e
), classified as (
  select
    b.*,
    case
      when b.quality_status = 'incomplete' or b.canonical_value_aed is null then 'incomplete'
      when p_fx_fetched_at is null or p_fx_as_of is null then 'incomplete'
      when p_fx_fetched_at > p_snapshot_at + b.future_clock_tolerance then 'incomplete'
      when p_snapshot_at - p_fx_fetched_at > b.fx_max_age then 'incomplete'
      when b.type = 'investment' and b.valuation_method = 'quantity_times_last_price' and (
        b.price_updated_at is null or b.snapshot_price_quote_at is null
        or b.snapshot_price_quote_at > p_snapshot_at + b.future_clock_tolerance
        or p_snapshot_at - b.snapshot_price_quote_at > b.quote_provisional_age
        or not (b.refreshed_this_attempt or b.failed_this_attempt)
      ) then 'incomplete'
      when b.type = 'investment' and b.valuation_method = 'quantity_times_last_price'
        and b.refreshed_this_attempt
        and p_snapshot_at - b.snapshot_price_quote_at <= b.quote_complete_age then 'complete'
      when b.type = 'investment' and b.valuation_method = 'quantity_times_last_price' then 'provisional'
      when b.type = 'investment' then 'provisional'
      when b.updated_at > p_snapshot_at + b.future_clock_tolerance then 'incomplete'
      when b.updated_at >= b.target_day_start then 'complete'
      else 'provisional'
    end as snapshot_quality
  from based b
)
select
  c.id,
  c.owner,
  c.type,
  c.is_liability,
  c.currency,
  c.value,
  c.quantity,
  c.last_price,
  c.canonical_value_native,
  c.fx_rate_to_aed,
  c.canonical_value_aed,
  c.valuation_method,
  c.price_source,
  c.updated_at,
  c.price_updated_at,
  c.snapshot_price_quote_at,
  p_fx_fetched_at,
  p_fx_as_of,
  c.snapshot_quality,
  jsonb_strip_nulls(jsonb_build_object(
    'policy_version', 'shr-113-snapshot-policy-v1',
    'snapshot_semantic', 'valuation_close',
    'canonical_quality', c.quality_status,
    'valuation_method', c.valuation_method,
    'fx_age_seconds', extract(epoch from (p_snapshot_at - p_fx_fetched_at))::bigint,
    'account_age_seconds', extract(epoch from (p_snapshot_at - c.updated_at))::bigint,
    'quote_age_seconds', case when c.snapshot_price_quote_at is not null
      then extract(epoch from (p_snapshot_at - c.snapshot_price_quote_at))::bigint end,
    'refreshed_this_attempt', c.refreshed_this_attempt,
    'failed_this_attempt', c.failed_this_attempt,
    'reason', case
      when c.quality_status = 'incomplete' or c.canonical_value_aed is null then 'canonical_incomplete'
      when p_fx_fetched_at is null or p_fx_as_of is null then 'fx_provenance_missing'
      when p_fx_fetched_at > p_snapshot_at + c.future_clock_tolerance then 'fx_timestamp_future'
      when p_snapshot_at - p_fx_fetched_at > c.fx_max_age then 'fx_stale'
      when c.type = 'investment' and c.valuation_method = 'quantity_times_last_price'
        and c.snapshot_price_quote_at is null then 'provider_quote_timestamp_missing'
      when c.type = 'investment' and c.valuation_method = 'quantity_times_last_price'
        and c.price_updated_at is null then 'price_fetch_timestamp_missing'
      when c.type = 'investment' and c.valuation_method = 'quantity_times_last_price'
        and c.snapshot_price_quote_at > p_snapshot_at + c.future_clock_tolerance then 'provider_quote_timestamp_future'
      when c.type = 'investment' and c.valuation_method = 'quantity_times_last_price'
        and p_snapshot_at - c.snapshot_price_quote_at > c.quote_provisional_age then 'provider_quote_too_old'
      when c.type = 'investment' and c.valuation_method = 'quantity_times_last_price'
        and not (c.refreshed_this_attempt or c.failed_this_attempt) then 'price_refresh_evidence_missing'
      when c.type = 'investment' and c.valuation_method = 'quantity_times_last_price'
        and c.failed_this_attempt then 'price_refresh_failed_using_prior_quote'
      when c.type = 'investment' and c.valuation_method = 'quantity_times_last_price'
        and p_snapshot_at - c.snapshot_price_quote_at > c.quote_complete_age then 'provider_quote_over_36h'
      when c.type = 'investment' then 'manual_investment_value'
      when c.updated_at > p_snapshot_at + c.future_clock_tolerance then 'account_timestamp_future'
      when c.updated_at < c.target_day_start then 'older_manual_balance'
      else 'current_input'
    end
  ))
from classified c;
$$;

comment on function public.evaluate_nw_snapshot_policy_v1(date, timestamptz, timestamptz, timestamptz, jsonb) is
  'SHR-113-only publication policy v1. 6h FX requirement; quoted provider as-of <=36h Complete, 36-96h Provisional, >96h/missing timestamp Incomplete; manual investments/older valid balances Provisional. Does not alter SHR-111 canonical contracts.';

create or replace function public.claim_nw_snapshot_run(
  p_target_day date,
  p_trigger_kind text,
  p_invocation_id uuid,
  p_invoked_at timestamptz default now()
)
returns table (
  run_id uuid,
  target_day date,
  attempt_number integer,
  claim_state text
)
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_target date;
  v_run public.nw_snapshot_runs%rowtype;
  v_attempt integer;
begin
  if p_invocation_id is null or p_invoked_at is null then
    raise exception 'invocation id and time are required';
  end if;
  if p_trigger_kind not in ('scheduled', 'manual_recovery') then
    raise exception 'unsupported trigger kind';
  end if;

  if p_trigger_kind = 'scheduled' then
    v_target := ((p_invoked_at at time zone 'Asia/Dubai')::date - 1);
    if p_target_day is not null and p_target_day <> v_target then
      raise exception 'scheduled target day does not match Dubai reporting date';
    end if;
  else
    if p_target_day is null then raise exception 'manual recovery requires target day'; end if;
    v_target := p_target_day;
    if v_target >= (p_invoked_at at time zone 'Asia/Dubai')::date then
      raise exception 'manual recovery can fill a past Dubai day only';
    end if;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('nw-snapshot:' || v_target::text, 0));

  if exists (select 1 from public.nw_daily d where d.day = v_target) then
    select r.* into v_run from public.nw_snapshot_runs r where r.target_day = v_target;
    return query select v_run.id, v_target, null::integer,
      case when v_run.id is null then 'existing_legacy_point' else 'already_published' end;
    return;
  end if;

  insert into public.nw_snapshot_runs (
    target_day, idempotency_key, trigger_kind, status
  ) values (
    v_target, 'net-worth-close:' || v_target::text || ':shr-113-v1', p_trigger_kind, 'running'
  ) on conflict on constraint nw_snapshot_runs_target_day_key do nothing;

  select r.* into v_run
  from public.nw_snapshot_runs r
  where r.target_day = v_target
  for update;

  if v_run.status = 'published' then
    return query select v_run.id, v_target, null::integer, 'already_published'::text;
    return;
  end if;

  if v_run.status = 'running'
    and v_run.active_started_at is not null
    and v_run.active_started_at > p_invoked_at - interval '10 minutes' then
    return query select v_run.id, v_target, v_run.active_attempt_number, 'busy'::text;
    return;
  end if;

  select coalesce(max(e.attempt_number), 0) + 1 into v_attempt
  from public.nw_snapshot_attempt_events e where e.run_id = v_run.id;

  update public.nw_snapshot_runs r
  set status = 'running', active_attempt_number = v_attempt,
      active_invocation_id = p_invocation_id, active_started_at = p_invoked_at
  where r.id = v_run.id;

  insert into public.nw_snapshot_attempt_events (
    run_id, attempt_number, invocation_id, event_kind, outcome, evidence, occurred_at
  ) values (
    v_run.id, v_attempt, p_invocation_id, 'started', 'started',
    jsonb_build_object('trigger_kind', p_trigger_kind, 'target_day', v_target,
      'snapshot_semantic', 'valuation_close'), p_invoked_at
  );

  return query select v_run.id, v_target, v_attempt, 'claimed'::text;
end;
$$;

create or replace function public.record_nw_snapshot_attempt_event(
  p_run_id uuid,
  p_attempt_number integer,
  p_invocation_id uuid,
  p_event_kind text,
  p_outcome text,
  p_evidence jsonb default '{}'::jsonb,
  p_occurred_at timestamptz default now()
)
returns uuid
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_id uuid;
  v_run public.nw_snapshot_runs%rowtype;
begin
  if p_event_kind not in ('fx_refresh', 'price_refresh', 'failed') then
    raise exception 'unsupported externally recorded event kind';
  end if;
  if p_outcome not in ('succeeded', 'partial', 'failed') then
    raise exception 'unsupported event outcome';
  end if;

  select r.* into v_run from public.nw_snapshot_runs r where r.id = p_run_id for update;
  if v_run.id is null then raise exception 'snapshot run not found'; end if;
  if v_run.status = 'published' then raise exception 'published snapshot run is immutable'; end if;
  if v_run.active_attempt_number is distinct from p_attempt_number
    or v_run.active_invocation_id is distinct from p_invocation_id then
    raise exception 'attempt is not active for this invocation';
  end if;

  insert into public.nw_snapshot_attempt_events (
    run_id, attempt_number, invocation_id, event_kind, outcome, evidence, occurred_at
  ) values (
    p_run_id, p_attempt_number, p_invocation_id, p_event_kind, p_outcome,
    coalesce(p_evidence, '{}'::jsonb), p_occurred_at
  ) returning id into v_id;

  if p_event_kind = 'failed' or p_outcome = 'failed' then
    update public.nw_snapshot_runs r
    set status = 'retryable_failed', active_attempt_number = null,
        active_invocation_id = null, active_started_at = null,
        final_evidence = jsonb_build_object('last_failure', coalesce(p_evidence, '{}'::jsonb))
    where r.id = p_run_id;
  end if;

  return v_id;
end;
$$;

create or replace function public.capture_nw_snapshot_v1(
  p_run_id uuid,
  p_attempt_number integer,
  p_invocation_id uuid,
  p_snapshot_at timestamptz,
  p_source_version text
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_run public.nw_snapshot_runs%rowtype;
  v_fx jsonb;
  v_prices jsonb;
  v_fx_fetched_at timestamptz;
  v_fx_as_of timestamptz;
  v_fx_rates jsonb;
  v_incomplete_count bigint;
  v_provisional_count bigint;
  v_item_count bigint;
  v_assets numeric;
  v_liabilities numeric;
  v_investments numeric;
  v_total numeric;
  v_by_owner jsonb;
  v_by_type jsonb;
  v_digest text;
  v_daily_id uuid;
  v_evidence jsonb;
begin
  if p_snapshot_at is null or nullif(trim(p_source_version), '') is null then
    raise exception 'snapshot time and source version are required';
  end if;

  select r.* into v_run from public.nw_snapshot_runs r where r.id = p_run_id;
  if v_run.id is null then raise exception 'snapshot run not found'; end if;
  perform pg_advisory_xact_lock(hashtextextended('nw-snapshot:' || v_run.target_day::text, 0));
  select r.* into v_run from public.nw_snapshot_runs r where r.id = p_run_id for update;

  if p_snapshot_at < ((v_run.target_day + 1)::timestamp at time zone 'Asia/Dubai') then
    raise exception 'snapshot_at must be at or after the Dubai target-day close';
  end if;

  if v_run.status = 'published' then
    return jsonb_build_object('state', 'already_published', 'run_id', v_run.id,
      'target_day', v_run.target_day, 'nw_daily_id', v_run.nw_daily_id);
  end if;
  if v_run.active_attempt_number is distinct from p_attempt_number
    or v_run.active_invocation_id is distinct from p_invocation_id then
    raise exception 'attempt is not active for this invocation';
  end if;

  select e.evidence into v_fx
  from public.nw_snapshot_attempt_events e
  where e.run_id = p_run_id and e.attempt_number = p_attempt_number
    and e.event_kind = 'fx_refresh' and e.outcome = 'succeeded';
  select e.evidence into v_prices
  from public.nw_snapshot_attempt_events e
  where e.run_id = p_run_id and e.attempt_number = p_attempt_number
    and e.event_kind = 'price_refresh' and e.outcome in ('succeeded', 'partial');

  if v_fx is null or v_prices is null then
    raise exception 'successful FX and price refresh evidence is required before capture';
  end if;

  begin
    v_fx_fetched_at := (v_fx ->> 'fetched_at')::timestamptz;
    v_fx_as_of := (v_fx ->> 'provider_as_of')::timestamptz;
    v_fx_rates := v_fx -> 'rates';
  exception when others then
    v_fx_fetched_at := null;
    v_fx_as_of := null;
    v_fx_rates := null;
  end;

  -- Freeze the mutable source rows for the duration of capture.
  perform 1 from public.settings s where s.key = 'fx_rates' for share;
  perform 1 from public.accounts a for share;

  if not exists (
    select 1 from public.settings s
    where s.key = 'fx_rates' and s.value = v_fx_rates and s.updated_at = v_fx_fetched_at
  ) then
    v_fx_fetched_at := null;
    v_fx_as_of := null;
  end if;

  select
    count(*) filter (where p.item_quality = 'incomplete'),
    count(*) filter (where p.item_quality = 'provisional'),
    count(*)
  into v_incomplete_count, v_provisional_count, v_item_count
  from public.evaluate_nw_snapshot_policy_v1(
    v_run.target_day, p_snapshot_at, v_fx_fetched_at, v_fx_as_of, v_prices
  ) p;

  if v_item_count = 0 then
    v_incomplete_count := 1;
  end if;

  if v_incomplete_count > 0 then
    select jsonb_build_object(
      'policy_version', 'shr-113-snapshot-policy-v1',
      'snapshot_semantic', 'valuation_close',
      'incomplete_account_count', v_incomplete_count,
      'provisional_account_count', v_provisional_count,
      'account_count', v_item_count,
      'incomplete_items', coalesce(jsonb_agg(jsonb_build_object(
        'account_id', p.account_id, 'reason', p.quality_evidence ->> 'reason'
      )) filter (where p.item_quality = 'incomplete'), '[]'::jsonb)
    ) into v_evidence
    from public.evaluate_nw_snapshot_policy_v1(
      v_run.target_day, p_snapshot_at, v_fx_fetched_at, v_fx_as_of, v_prices
    ) p;

    insert into public.nw_snapshot_attempt_events (
      run_id, attempt_number, invocation_id, event_kind, outcome, evidence, occurred_at
    ) values (
      p_run_id, p_attempt_number, p_invocation_id, 'capture', 'skipped_incomplete', v_evidence, p_snapshot_at
    );
    insert into public.nw_snapshot_attempt_events (
      run_id, attempt_number, invocation_id, event_kind, outcome, evidence, occurred_at
    ) values (
      p_run_id, p_attempt_number, p_invocation_id, 'finished', 'skipped_incomplete', v_evidence, p_snapshot_at
    );
    update public.nw_snapshot_runs r
    set status = 'skipped_incomplete', snapshot_at = p_snapshot_at,
        quality_status = 'incomplete', source_version = p_source_version,
        final_evidence = v_evidence, completed_at = p_snapshot_at,
        active_attempt_number = null, active_invocation_id = null, active_started_at = null
    where r.id = p_run_id;
    return jsonb_build_object('state', 'skipped_incomplete', 'run_id', p_run_id,
      'target_day', v_run.target_day, 'evidence', v_evidence);
  end if;

  insert into public.nw_snapshot_items (
    run_id, account_id, owner, account_type, is_liability, currency,
    source_native_value, quantity, unit_price, canonical_native_value,
    fx_rate_to_aed, canonical_value_aed, valuation_method, price_source,
    account_value_at, price_fetched_at, price_quote_at, fx_fetched_at, fx_as_of,
    quality_status, quality_evidence
  )
  select
    p_run_id, p.account_id, p.owner, p.account_type, p.is_liability, p.currency,
    p.source_native_value, p.quantity, p.unit_price, p.canonical_native_value,
    p.fx_rate_to_aed, p.canonical_value_aed, p.valuation_method, p.price_source,
    p.account_value_at, p.price_fetched_at, p.price_quote_at, p.fx_fetched_at, p.fx_as_of,
    p.item_quality, p.quality_evidence
  from public.evaluate_nw_snapshot_policy_v1(
    v_run.target_day, p_snapshot_at, v_fx_fetched_at, v_fx_as_of, v_prices
  ) p
  order by p.account_id;

  select
    round(coalesce(sum(i.canonical_value_aed) filter (where not i.is_liability), 0), 2),
    round(coalesce(sum(i.canonical_value_aed) filter (where i.is_liability), 0), 2),
    round(coalesce(sum(i.canonical_value_aed) filter (where i.account_type = 'investment' and not i.is_liability), 0), 2),
    count(*)
  into v_assets, v_liabilities, v_investments, v_item_count
  from public.nw_snapshot_items i where i.run_id = p_run_id;
  v_total := v_assets - v_liabilities;

  select coalesce(jsonb_object_agg(g.key, g.value order by g.key), '{}'::jsonb)
  into v_by_owner
  from (
    select coalesce(i.owner, 'Unassigned') as key,
      round(sum(case when i.is_liability then -i.canonical_value_aed else i.canonical_value_aed end), 2) as value
    from public.nw_snapshot_items i where i.run_id = p_run_id
    group by coalesce(i.owner, 'Unassigned')
  ) g;
  select coalesce(jsonb_object_agg(g.key, g.value order by g.key), '{}'::jsonb)
  into v_by_type
  from (
    select i.account_type as key,
      round(sum(case when i.is_liability then -i.canonical_value_aed else i.canonical_value_aed end), 2) as value
    from public.nw_snapshot_items i where i.run_id = p_run_id
    group by i.account_type
  ) g;

  select encode(extensions.digest(convert_to(
    jsonb_build_object(
      'policy_version', 'shr-113-snapshot-policy-v1',
      'target_day', v_run.target_day,
      'snapshot_at', p_snapshot_at,
      'items', jsonb_agg(jsonb_build_object(
        'account_id', i.account_id,
        'owner', i.owner,
        'account_type', i.account_type,
        'is_liability', i.is_liability,
        'currency', i.currency,
        'source_native_value', i.source_native_value,
        'quantity', i.quantity,
        'unit_price', i.unit_price,
        'canonical_native_value', i.canonical_native_value,
        'fx_rate_to_aed', i.fx_rate_to_aed,
        'canonical_value_aed', i.canonical_value_aed,
        'valuation_method', i.valuation_method,
        'price_source', i.price_source,
        'account_value_at', i.account_value_at,
        'price_fetched_at', i.price_fetched_at,
        'price_quote_at', i.price_quote_at,
        'fx_fetched_at', i.fx_fetched_at,
        'fx_as_of', i.fx_as_of,
        'quality_status', i.quality_status,
        'quality_evidence', i.quality_evidence
      ) order by i.account_id)
    )::text, 'UTF8'), 'sha256'), 'hex')
  into v_digest
  from public.nw_snapshot_items i where i.run_id = p_run_id;

  v_evidence := jsonb_build_object(
    'policy_version', 'shr-113-snapshot-policy-v1',
    'snapshot_semantic', 'valuation_close',
    'quality_status', case when v_provisional_count > 0 then 'provisional' else 'complete' end,
    'account_count', v_item_count,
    'provisional_account_count', v_provisional_count,
    'fx_fetched_at', v_fx_fetched_at,
    'fx_as_of', v_fx_as_of,
    'price_refresh_outcome', (select e.outcome from public.nw_snapshot_attempt_events e
      where e.run_id = p_run_id and e.attempt_number = p_attempt_number and e.event_kind = 'price_refresh')
  );

  insert into public.nw_daily (
    day, total_aed, assets_aed, liabilities_aed, by_owner, by_type,
    run_id, snapshot_at, published_at, quality_status, investment_value_aed,
    source_version, quality_evidence, input_digest
  ) values (
    v_run.target_day, v_total, v_assets, v_liabilities, v_by_owner, v_by_type,
    p_run_id, p_snapshot_at, now(),
    case when v_provisional_count > 0 then 'provisional' else 'complete' end,
    v_investments, p_source_version, v_evidence, v_digest
  ) on conflict (day) do nothing returning id into v_daily_id;

  if v_daily_id is null then
    raise exception 'target day already has a published point; automatic replacement is forbidden';
  end if;

  insert into public.nw_snapshot_attempt_events (
    run_id, attempt_number, invocation_id, event_kind, outcome, evidence, occurred_at
  ) values (
    p_run_id, p_attempt_number, p_invocation_id, 'capture', 'published',
    v_evidence || jsonb_build_object('input_digest', v_digest, 'nw_daily_id', v_daily_id), p_snapshot_at
  );
  insert into public.nw_snapshot_attempt_events (
    run_id, attempt_number, invocation_id, event_kind, outcome, evidence, occurred_at
  ) values (
    p_run_id, p_attempt_number, p_invocation_id, 'finished', 'published',
    jsonb_build_object('input_digest', v_digest, 'nw_daily_id', v_daily_id), p_snapshot_at
  );

  update public.nw_snapshot_runs r
  set status = 'published', snapshot_at = p_snapshot_at,
      quality_status = case when v_provisional_count > 0 then 'provisional' else 'complete' end,
      input_digest = v_digest, source_version = p_source_version,
      final_evidence = v_evidence, nw_daily_id = v_daily_id, completed_at = now(),
      active_attempt_number = null, active_invocation_id = null, active_started_at = null
  where r.id = p_run_id;

  return jsonb_build_object('state', 'published', 'run_id', p_run_id,
    'target_day', v_run.target_day, 'nw_daily_id', v_daily_id,
    'quality_status', case when v_provisional_count > 0 then 'provisional' else 'complete' end,
    'input_digest', v_digest);
end;
$$;

-- History is read-only for household clients. Trusted service orchestration
-- gets the minimum table privileges its SECURITY INVOKER contracts require.
alter table public.nw_snapshot_runs enable row level security;
alter table public.nw_snapshot_attempt_events enable row level security;
alter table public.nw_snapshot_items enable row level security;

drop policy if exists "nw snapshot runs household read" on public.nw_snapshot_runs;
create policy "nw snapshot runs household read" on public.nw_snapshot_runs
  for select to authenticated using ((select private.is_household_member()));
drop policy if exists "nw snapshot attempts household read" on public.nw_snapshot_attempt_events;
create policy "nw snapshot attempts household read" on public.nw_snapshot_attempt_events
  for select to authenticated using ((select private.is_household_member()));
drop policy if exists "nw snapshot items household read" on public.nw_snapshot_items;
create policy "nw snapshot items household read" on public.nw_snapshot_items
  for select to authenticated using ((select private.is_household_member()));

drop policy if exists "nw_daily household write" on public.nw_daily;
drop policy if exists "nw_daily household update" on public.nw_daily;
drop policy if exists "nw_daily household read" on public.nw_daily;
create policy "nw_daily household read" on public.nw_daily
  for select to authenticated using ((select private.is_household_member()));

drop policy if exists household_all on public.nw_snapshots;
drop policy if exists "nw_snapshots household read" on public.nw_snapshots;
create policy "nw_snapshots household read" on public.nw_snapshots
  for select to authenticated using ((select private.is_household_member()));

revoke all on table public.nw_snapshot_runs,
  public.nw_snapshot_attempt_events,
  public.nw_snapshot_items,
  public.nw_daily,
  public.nw_snapshots
  from public, anon, authenticated, service_role;

grant select on table public.nw_snapshot_runs,
  public.nw_snapshot_attempt_events,
  public.nw_snapshot_items,
  public.nw_daily,
  public.nw_snapshots
  to authenticated, service_role;
grant insert, update on table public.nw_snapshot_runs to service_role;
grant insert on table public.nw_snapshot_attempt_events,
  public.nw_snapshot_items,
  public.nw_daily to service_role;

revoke all on function public.evaluate_nw_snapshot_policy_v1(date, timestamptz, timestamptz, timestamptz, jsonb),
  public.claim_nw_snapshot_run(date, text, uuid, timestamptz),
  public.record_nw_snapshot_attempt_event(uuid, integer, uuid, text, text, jsonb, timestamptz),
  public.capture_nw_snapshot_v1(uuid, integer, uuid, timestamptz, text)
  from public, anon, authenticated, service_role;
grant execute on function public.evaluate_nw_snapshot_policy_v1(date, timestamptz, timestamptz, timestamptz, jsonb),
  public.claim_nw_snapshot_run(date, text, uuid, timestamptz),
  public.record_nw_snapshot_attempt_event(uuid, integer, uuid, text, text, jsonb, timestamptz),
  public.capture_nw_snapshot_v1(uuid, integer, uuid, timestamptz, text)
  to service_role;

comment on table public.nw_snapshots is
  'Deprecated monthly structure. SHR-113 keeps it empty/read-only; monthly history must be derived from qualified nw_daily points.';

commit;

-- Phase A production state: NOT APPLIED. Scheduler: INACTIVE / not installed.
