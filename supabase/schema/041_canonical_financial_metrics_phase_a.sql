-- 041_canonical_financial_metrics_phase_a.sql — SHR-111 Phase A
--
-- Additive canonical financial contracts. Existing views/RPCs and every
-- consumer remain unchanged. These surfaces execute with caller privileges so
-- the underlying household RLS policies remain authoritative.

begin;

-- New split writes retain the original economic amount/currency. Legacy split
-- rows remain valid for compatibility, but the canonical ledger marks a split
-- without this identity as incomplete instead of guessing an original amount.
alter table public.transactions
  add column if not exists split_original_amount numeric,
  add column if not exists split_original_currency text;

alter table public.transactions
  drop constraint if exists transactions_split_original_pairing;
alter table public.transactions
  add constraint transactions_split_original_pairing check (
    (split_original_amount is null and split_original_currency is null)
    or (
      split_original_amount is not null
      and split_original_currency is not null
      and group_kind = 'category_split'
      and currency = split_original_currency
    )
  );

comment on column public.transactions.split_original_amount is
  'SHR-111: original economic amount shared by every category-split line. Nullable only for legacy/non-split compatibility; missing identity makes a canonical split incomplete.';
comment on column public.transactions.split_original_currency is
  'SHR-111: original category-split currency. Cross-currency splits are unsupported; every identified line must use this currency.';

-- Preserve the existing four-argument API while making all new/replaced split
-- groups self-reconciling. Existing callers already provide the line amounts
-- and one base currency. When replacing an identified split, a different total
-- is an intentional edit and becomes the new original economic amount.
create or replace function public.replace_category_split(
  p_group_id       uuid,
  p_transaction_id uuid,
  p_base           jsonb,
  p_lines          jsonb
)
returns setof public.transactions
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_group_id         uuid := gen_random_uuid();
  v_line             jsonb;
  v_original_amount  numeric := 0;
  v_currency         text := coalesce(nullif(p_base ->> 'currency', ''), 'AED');
begin
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'replace_category_split requires at least one line';
  end if;

  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    if (v_line ->> 'amount') is null then
      raise exception 'every split line needs an amount';
    end if;
    v_original_amount := v_original_amount + (v_line ->> 'amount')::numeric;
  end loop;

  if round(v_original_amount, 2) <> v_original_amount then
    raise exception 'category split total must reconcile at AED-compatible 2-decimal precision';
  end if;

  if p_group_id is not null then
    update public.transactions
    set deleted_at = now()
    where transaction_group_id = p_group_id and deleted_at is null;
  elsif p_transaction_id is not null then
    update public.transactions
    set deleted_at = now()
    where id = p_transaction_id and deleted_at is null;
  end if;

  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    return query
    insert into public.transactions (
      date, amount, currency, account_id, category, owner, note, tags,
      source, needs_review, transaction_group_id, group_kind,
      split_original_amount, split_original_currency
    )
    values (
      (p_base ->> 'date')::date,
      (v_line ->> 'amount')::numeric,
      v_currency,
      nullif(p_base ->> 'account_id', '')::uuid,
      v_line ->> 'category',
      nullif(p_base ->> 'owner', ''),
      nullif(p_base ->> 'note', ''),
      coalesce(
        (select array_agg(value) from jsonb_array_elements_text(coalesce(p_base -> 'tags', '[]'::jsonb))),
        '{}'::text[]
      ),
      'manual',
      false,
      v_group_id,
      'category_split',
      v_original_amount,
      v_currency
    )
    returning *;
  end loop;
end;
$$;

comment on function public.replace_category_split(uuid, uuid, jsonb, jsonb) is
  'SHR-111/DATA-02: atomically replaces a split and records one original amount/currency on every line. Cross-currency and sub-cent totals are rejected.';

-- Ledger/economic classification. Precedence is intentionally explicit:
-- typed transfers, legacy exact Transfer compatibility, explicit savings
-- movement, then consumption (including uncategorised and negative refunds).
create or replace view public.v_canonical_ledger_aed
with (security_invoker = true)
as
with fx as (
  select s.value as rates, s.updated_at
  from public.settings s
  where s.key = 'fx_rates'
), base as (
  select
    t.*,
    (fx.rates ->> t.currency)::numeric as fx_rate_to_aed,
    fx.updated_at as fx_updated_at,
    t.amount * (fx.rates ->> t.currency)::numeric as amount_aed,
    case
      when t.group_kind = 'transfer' then 'internal_transfer'
      when t.category = 'Transfer' then 'internal_transfer'
      when t.category = 'Savings & Investments' then 'savings_movement'
      else 'consumption_spend'
    end as economic_classification,
    case
      when t.group_kind = 'transfer' then 'typed_transfer'
      when t.category = 'Transfer' then 'legacy_exact_transfer_category'
      when t.category = 'Savings & Investments' then 'legacy_exact_savings_category'
      when t.category is null then 'uncategorised_consumption'
      else 'categorised_consumption'
    end as classification_reason
  from public.transactions t
  left join fx on true
  where t.deleted_at is null
), reconciled as (
  select
    b.*,
    count(*) filter (where b.group_kind = 'category_split')
      over (partition by b.transaction_group_id) as split_line_count,
    min(b.currency) filter (where b.group_kind = 'category_split')
      over (partition by b.transaction_group_id) as split_currency_min,
    max(b.currency) filter (where b.group_kind = 'category_split')
      over (partition by b.transaction_group_id) as split_currency_max,
    sum(b.amount) filter (where b.group_kind = 'category_split')
      over (partition by b.transaction_group_id) as split_lines_total,
    min(b.split_original_amount) filter (where b.group_kind = 'category_split')
      over (partition by b.transaction_group_id) as split_original_min,
    max(b.split_original_amount) filter (where b.group_kind = 'category_split')
      over (partition by b.transaction_group_id) as split_original_max,
    min(b.split_original_currency) filter (where b.group_kind = 'category_split')
      over (partition by b.transaction_group_id) as split_original_currency_min,
    max(b.split_original_currency) filter (where b.group_kind = 'category_split')
      over (partition by b.transaction_group_id) as split_original_currency_max
  from base b
)
select
  r.*,
  case
    when r.group_kind is distinct from 'category_split' then 'not_applicable'
    when r.split_original_amount is null or r.split_original_currency is null then 'missing_identity'
    when r.split_currency_min is distinct from r.split_currency_max
      or r.split_original_currency_min is distinct from r.split_original_currency_max then 'cross_currency'
    when r.split_original_min is distinct from r.split_original_max then 'inconsistent_identity'
    when round(r.split_lines_total, 2) <> round(r.split_original_amount, 2) then 'unreconciled'
    else 'reconciled'
  end as split_reconciliation_status,
  case
    when r.fx_rate_to_aed is null then 'incomplete'
    when r.needs_review and r.amount = 0 then 'incomplete'
    when r.group_kind = 'category_split' and (
      r.split_original_amount is null
      or r.split_original_currency is null
      or r.split_currency_min is distinct from r.split_currency_max
      or r.split_original_currency_min is distinct from r.split_original_currency_max
      or r.split_original_min is distinct from r.split_original_max
      or round(r.split_lines_total, 2) <> round(r.split_original_amount, 2)
    ) then 'incomplete'
    when r.needs_review then 'provisional'
    else 'complete'
  end as quality_status,
  case when r.economic_classification = 'consumption_spend' then r.amount_aed end
    as consumption_spend_aed,
  case when r.economic_classification = 'savings_movement' then r.amount_aed end
    as savings_movement_aed
from reconciled r;

comment on view public.v_canonical_ledger_aed is
  'SHR-111 Phase A canonical active-ledger classification. Distinguishes consumption_spend, savings_movement, and internal_transfer; flags missing FX, provisional review rows, zero placeholders, and unreconciled splits.';

create or replace view public.v_canonical_income_aed
with (security_invoker = true)
as
with fx as (
  select s.value as rates, s.updated_at
  from public.settings s
  where s.key = 'fx_rates'
)
select
  i.*,
  (fx.rates ->> i.currency)::numeric as fx_rate_to_aed,
  fx.updated_at as fx_updated_at,
  i.amount * (fx.rates ->> i.currency)::numeric as amount_aed,
  case when (fx.rates ->> i.currency)::numeric is null then 'incomplete' else 'complete' end
    as quality_status
from public.income i
left join fx on true;

comment on view public.v_canonical_income_aed is
  'SHR-111 posted income normalized to current-rate AED. Recurring income is deliberately absent; missing FX is incomplete.';

-- Current account/holding primitive. Quoted investments use quantity × the
-- authoritative last price; manual holdings retain accounts.value but carry
-- explicit manual/provisional metadata. No universal stale threshold is
-- invented: timestamp and age are exposed for caller policy.
create or replace view public.v_canonical_accounts_aed
with (security_invoker = true)
as
with fx as (
  select s.value as rates, s.updated_at
  from public.settings s
  where s.key = 'fx_rates'
), valued as (
  select
    a.*,
    (fx.rates ->> a.currency)::numeric as fx_rate_to_aed,
    fx.updated_at as fx_updated_at,
    case
      when a.type = 'investment' and a.last_price is not null and a.quantity is not null
        then a.quantity * a.last_price
      else a.value
    end as canonical_value_native,
    case
      when a.type <> 'investment' then 'account_balance'
      when a.last_price is not null and a.quantity is not null then 'quantity_times_last_price'
      else 'manual_account_value'
    end as valuation_method,
    case
      when a.type = 'investment' and a.last_price is not null then a.price_updated_at
      when a.type = 'investment' then a.updated_at
      else a.updated_at
    end as valuation_as_of,
    case
      when a.type <> 'investment' then 'account_balance'
      when a.last_price is null then 'manual'
      when a.price_updated_at is null then 'missing_timestamp'
      else 'timestamped'
    end as freshness_status,
    case
      when a.type = 'investment' and a.quantity is not null and a.avg_cost is not null
        then a.quantity * a.avg_cost
    end as cost_basis_native,
    case
      when a.type = 'investment' and a.quantity is not null and a.avg_cost is not null then
        (case
          when a.last_price is not null then a.quantity * a.last_price
          else a.value
        end) - (a.quantity * a.avg_cost)
    end as unrealized_pnl_native
  from public.accounts a
  left join fx on true
)
select
  v.*,
  v.canonical_value_native * v.fx_rate_to_aed as canonical_value_aed,
  v.cost_basis_native * v.fx_rate_to_aed as cost_basis_aed,
  v.unrealized_pnl_native * v.fx_rate_to_aed as unrealized_pnl_aed,
  case
    when v.fx_rate_to_aed is null then 'incomplete'
    when v.value < 0 then 'incomplete'
    when v.is_liability <> (v.type in ('credit_card', 'loan', 'mortgage', 'other_liability')) then 'incomplete'
    when v.type = 'investment' and v.last_price is not null and v.quantity is null then 'incomplete'
    when v.type = 'investment' and v.last_price is not null and v.price_updated_at is null then 'incomplete'
    when v.type = 'investment' and v.last_price is not null
      and round(v.value, 2) <> round(v.canonical_value_native, 2) then 'incomplete'
    when v.type = 'investment' and v.last_price is null then 'provisional'
    else 'complete'
  end as quality_status,
  case
    when v.type <> 'investment' then 'not_applicable'
    when v.quantity is null or v.avg_cost is null then 'incomplete'
    when v.fx_rate_to_aed is null then 'incomplete'
    when v.value < 0 then 'incomplete'
    when v.last_price is not null and (v.price_updated_at is null or round(v.value, 2) <> round(v.canonical_value_native, 2)) then 'incomplete'
    when v.last_price is null then 'provisional'
    else 'complete'
  end as pnl_quality_status,
  case when v.valuation_as_of is null then null else extract(epoch from (now() - v.valuation_as_of))::bigint end
    as valuation_age_seconds
from valued v;

comment on view public.v_canonical_accounts_aed is
  'SHR-111 current account/holding valuation. Assets/liabilities use positive magnitudes. Quoted investments reconcile quantity × last_price; manual values are provisional; missing FX/input is incomplete.';

create or replace function public.canonical_period_metrics(
  p_start date,
  p_end date,
  p_scope text default 'household',
  p_person text default null
)
returns table (
  period_start date,
  period_end date,
  scope text,
  person text,
  posted_income_aed numeric,
  consumption_spend_aed numeric,
  savings_movement_aed numeric,
  cash_retained_aed numeric,
  savings_aed numeric,
  cash_flow_aed numeric,
  savings_rate_percent numeric,
  savings_rate_reason text,
  quality_status text,
  missing_fx_count bigint,
  needs_review_count bigint,
  zero_placeholder_count bigint,
  quality_metadata jsonb
)
language sql
stable
security invoker
set search_path = ''
as $$
with tx as (
  select l.*
  from public.v_canonical_ledger_aed l
  where l.date between p_start and p_end
    and (
      p_scope = 'household'
      or (p_scope = 'person' and l.owner is not distinct from p_person)
    )
), inc as (
  select i.*
  from public.v_canonical_income_aed i
  where i.date between p_start and p_end
    and (
      p_scope = 'household'
      or (p_scope = 'person' and i.person is not distinct from p_person)
    )
), txa as (
  select
    coalesce(sum(amount_aed) filter (where economic_classification = 'consumption_spend'), 0) as consumption_raw,
    coalesce(sum(amount_aed) filter (where economic_classification = 'savings_movement'), 0) as savings_movement_raw,
    count(*) filter (where quality_status = 'incomplete' and economic_classification = 'consumption_spend') as consumption_incomplete,
    count(*) filter (where quality_status = 'incomplete' and economic_classification = 'savings_movement') as savings_movement_incomplete,
    count(*) filter (where quality_status = 'provisional') as provisional_count,
    count(*) filter (where fx_rate_to_aed is null) as missing_fx_count,
    count(*) filter (where needs_review) as needs_review_count,
    count(*) filter (where needs_review and amount = 0) as zero_placeholder_count,
    coalesce(jsonb_agg(distinct currency) filter (where fx_rate_to_aed is null), '[]'::jsonb) as missing_fx_currencies,
    max(fx_updated_at) as fx_updated_at
  from tx
), ia as (
  select
    coalesce(sum(amount_aed), 0) as income_raw,
    count(*) filter (where quality_status = 'incomplete') as income_incomplete,
    count(*) filter (where fx_rate_to_aed is null) as missing_fx_count,
    coalesce(jsonb_agg(distinct currency) filter (where fx_rate_to_aed is null), '[]'::jsonb) as missing_fx_currencies,
    max(fx_updated_at) as fx_updated_at
  from inc
), amounts as (
  select
    case when ia.income_incomplete = 0 then round(ia.income_raw, 2) end as income_aed,
    case when txa.consumption_incomplete = 0 then round(txa.consumption_raw, 2) end as consumption_aed,
    case when txa.savings_movement_incomplete = 0 then round(txa.savings_movement_raw, 2) end as movement_aed,
    ia.income_incomplete,
    ia.missing_fx_count as income_missing_fx_count,
    ia.missing_fx_currencies as income_missing_fx_currencies,
    ia.fx_updated_at as income_fx_updated_at,
    txa.consumption_incomplete,
    txa.savings_movement_incomplete,
    txa.provisional_count,
    txa.missing_fx_count as transaction_missing_fx_count,
    txa.needs_review_count,
    txa.zero_placeholder_count,
    txa.missing_fx_currencies as transaction_missing_fx_currencies,
    txa.fx_updated_at as transaction_fx_updated_at
  from ia cross join txa
)
select
  p_start,
  p_end,
  p_scope,
  p_person,
  a.income_aed,
  a.consumption_aed,
  a.movement_aed,
  case when a.income_aed is not null and a.consumption_aed is not null and a.movement_aed is not null
    then round(a.income_aed - a.consumption_aed - a.movement_aed, 2) end,
  case when a.income_aed is not null and a.consumption_aed is not null
    then round(a.income_aed - a.consumption_aed, 2) end,
  case when a.income_aed is not null and a.consumption_aed is not null and a.movement_aed is not null
    then round(a.income_aed - a.consumption_aed - a.movement_aed, 2) end,
  case
    when a.income_aed is null or a.consumption_aed is null then null
    when a.income_aed <= 0 then null
    else round(100 * (a.income_aed - a.consumption_aed) / a.income_aed, 2)
  end,
  case
    when a.income_aed is null or a.consumption_aed is null then 'incomplete_inputs'
    when a.income_aed <= 0 then 'nonpositive_income'
    else null
  end,
  case
    when a.income_incomplete > 0 or a.consumption_incomplete > 0 or a.savings_movement_incomplete > 0 then 'incomplete'
    when a.provisional_count > 0 then 'provisional'
    else 'complete'
  end,
  a.income_missing_fx_count + a.transaction_missing_fx_count,
  a.needs_review_count,
  a.zero_placeholder_count,
  jsonb_build_object(
    'fx_basis', 'current_rate_aed',
    'fx_updated_at', greatest(a.income_fx_updated_at, a.transaction_fx_updated_at),
    'missing_fx_currencies', a.income_missing_fx_currencies || a.transaction_missing_fx_currencies,
    'income_incomplete_count', a.income_incomplete,
    'consumption_incomplete_count', a.consumption_incomplete,
    'savings_movement_incomplete_count', a.savings_movement_incomplete,
    'provisional_transaction_count', a.provisional_count,
    'zero_placeholder_count', a.zero_placeholder_count,
    'classification_version', 'shr-111-phase-a-v1'
  )
from amounts a
where p_start is not null
  and p_end is not null
  and p_start <= p_end
  and p_scope in ('household', 'person')
  and exists (select 1 from public.household_members);
$$;

comment on function public.canonical_period_metrics(date, date, text, text) is
  'SHR-111 canonical posted period metrics. cash_flow = cash_retained = income - consumption_spend - savings_movement; savings = income - consumption_spend. Missing required inputs null dependent amounts.';

create or replace function public.canonical_balance_sheet(
  p_scope text default 'household',
  p_person text default null
)
returns table (
  scope text,
  person text,
  assets_aed numeric,
  liabilities_aed numeric,
  net_worth_aed numeric,
  quality_status text,
  incomplete_account_count bigint,
  provisional_account_count bigint,
  missing_fx_count bigint,
  quality_metadata jsonb
)
language sql
stable
security invoker
set search_path = ''
as $$
with scoped as (
  select a.*
  from public.v_canonical_accounts_aed a
  where p_scope = 'household'
     or (p_scope = 'person' and a.owner is not distinct from p_person)
), agg as (
  select
    coalesce(sum(canonical_value_aed) filter (where not is_liability), 0) as assets_raw,
    coalesce(sum(canonical_value_aed) filter (where is_liability), 0) as liabilities_raw,
    count(*) filter (where quality_status = 'incomplete') as incomplete_count,
    count(*) filter (where quality_status = 'provisional') as provisional_count,
    count(*) filter (where fx_rate_to_aed is null) as missing_fx_count,
    count(*) filter (where value < 0) as negative_value_count,
    count(*) filter (where is_liability <> (type in ('credit_card', 'loan', 'mortgage', 'other_liability'))) as type_mismatch_count,
    count(*) filter (where valuation_method = 'manual_account_value') as manual_valuation_count,
    coalesce(jsonb_agg(distinct currency) filter (where fx_rate_to_aed is null), '[]'::jsonb) as missing_fx_currencies,
    max(fx_updated_at) as fx_updated_at
  from scoped
)
select
  p_scope,
  p_person,
  case when a.incomplete_count = 0 then round(a.assets_raw, 2) end,
  case when a.incomplete_count = 0 then round(a.liabilities_raw, 2) end,
  case when a.incomplete_count = 0 then round(a.assets_raw, 2) - round(a.liabilities_raw, 2) end,
  case when a.incomplete_count > 0 then 'incomplete' when a.provisional_count > 0 then 'provisional' else 'complete' end,
  a.incomplete_count,
  a.provisional_count,
  a.missing_fx_count,
  jsonb_build_object(
    'fx_basis', 'current_rate_aed',
    'fx_updated_at', a.fx_updated_at,
    'missing_fx_currencies', a.missing_fx_currencies,
    'negative_value_count', a.negative_value_count,
    'liability_type_mismatch_count', a.type_mismatch_count,
    'manual_valuation_count', a.manual_valuation_count,
    'classification_version', 'shr-111-phase-a-v1'
  )
from agg a
where p_scope in ('household', 'person')
  and exists (select 1 from public.household_members);
$$;

create or replace function public.canonical_investment_metrics(
  p_scope text default 'household',
  p_person text default null,
  p_stale_before timestamptz default null
)
returns table (
  scope text,
  person text,
  investment_value_aed numeric,
  cost_basis_aed numeric,
  unrealized_pnl_aed numeric,
  quality_status text,
  incomplete_value_count bigint,
  incomplete_pnl_count bigint,
  provisional_count bigint,
  manual_value_count bigint,
  stale_value_count bigint,
  missing_fx_count bigint,
  quality_metadata jsonb
)
language sql
stable
security invoker
set search_path = ''
as $$
with scoped as (
  select a.*
  from public.v_canonical_accounts_aed a
  where a.type = 'investment'
    and (p_scope = 'household' or (p_scope = 'person' and a.owner is not distinct from p_person))
), agg as (
  select
    coalesce(sum(canonical_value_aed), 0) as value_raw,
    coalesce(sum(cost_basis_aed), 0) as cost_raw,
    coalesce(sum(unrealized_pnl_aed), 0) as pnl_raw,
    count(*) filter (where quality_status = 'incomplete') as incomplete_value_count,
    count(*) filter (where pnl_quality_status = 'incomplete') as incomplete_pnl_count,
    count(*) filter (where quality_status = 'provisional' or pnl_quality_status = 'provisional') as provisional_count,
    count(*) filter (where freshness_status = 'manual') as manual_count,
    count(*) filter (where p_stale_before is not null and valuation_as_of < p_stale_before) as stale_count,
    count(*) filter (where fx_rate_to_aed is null) as missing_fx_count,
    min(valuation_as_of) as oldest_valuation_at,
    max(valuation_as_of) as newest_valuation_at,
    coalesce(jsonb_agg(distinct currency) filter (where fx_rate_to_aed is null), '[]'::jsonb) as missing_fx_currencies
  from scoped
)
select
  p_scope,
  p_person,
  case when a.incomplete_value_count = 0 then round(a.value_raw, 2) end,
  case when a.incomplete_pnl_count = 0 then round(a.cost_raw, 2) end,
  case when a.incomplete_pnl_count = 0 then round(a.pnl_raw, 2) end,
  case
    when a.incomplete_value_count > 0 or a.incomplete_pnl_count > 0 then 'incomplete'
    when a.provisional_count > 0 or a.stale_count > 0 then 'provisional'
    else 'complete'
  end,
  a.incomplete_value_count,
  a.incomplete_pnl_count,
  a.provisional_count,
  a.manual_count,
  a.stale_count,
  a.missing_fx_count,
  jsonb_build_object(
    'fx_basis', 'current_rate_aed',
    'pnl_basis', 'unrealized_all_time',
    'stale_before', p_stale_before,
    'oldest_valuation_at', a.oldest_valuation_at,
    'newest_valuation_at', a.newest_valuation_at,
    'manual_value_count', a.manual_count,
    'stale_value_count', a.stale_count,
    'missing_fx_currencies', a.missing_fx_currencies,
    'classification_version', 'shr-111-phase-a-v1'
  )
from agg a
where p_scope in ('household', 'person')
  and exists (select 1 from public.household_members);
$$;

create or replace function public.canonical_budget_actuals(
  p_start date,
  p_end date,
  p_scope text default 'household',
  p_person text default null
)
returns table (
  category text,
  actual_aed numeric,
  quality_status text,
  transaction_count bigint,
  needs_review_count bigint,
  zero_placeholder_count bigint,
  missing_fx_count bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
select
  coalesce(l.category, 'Uncategorised') as category,
  case when count(*) filter (where l.quality_status = 'incomplete') = 0
    then round(coalesce(sum(l.consumption_spend_aed), 0), 2) end as actual_aed,
  case
    when count(*) filter (where l.quality_status = 'incomplete') > 0 then 'incomplete'
    when count(*) filter (where l.quality_status = 'provisional') > 0 then 'provisional'
    else 'complete'
  end as quality_status,
  count(*) as transaction_count,
  count(*) filter (where l.needs_review) as needs_review_count,
  count(*) filter (where l.needs_review and l.amount = 0) as zero_placeholder_count,
  count(*) filter (where l.fx_rate_to_aed is null) as missing_fx_count
from public.v_canonical_ledger_aed l
where l.date between p_start and p_end
  and l.economic_classification = 'consumption_spend'
  and (p_scope = 'household' or (p_scope = 'person' and l.owner is not distinct from p_person))
  and p_start <= p_end
  and p_scope in ('household', 'person')
  and exists (select 1 from public.household_members)
group by coalesce(l.category, 'Uncategorised')
order by coalesce(l.category, 'Uncategorised');
$$;

comment on function public.canonical_budget_actuals(date, date, text, text) is
  'SHR-111 budget actual by category, including Uncategorised and budgetless categories, exactly on canonical consumption_spend. Transfer and savings_movement are excluded.';

create or replace view public.v_canonical_goal_progress
with (security_invoker = true)
as
with contribution as (
  select
    gc.goal_id,
    coalesce(sum(gc.amount), 0) as contribution_activity_aed,
    count(*) as contribution_count,
    count(*) filter (where gc.amount <= 0) as invalid_contribution_count
  from public.goal_contributions gc
  group by gc.goal_id
), based as (
  select
    g.*,
    a.name as linked_account_name,
    a.type as linked_account_type,
    a.is_liability as linked_account_is_liability,
    a.canonical_value_aed as linked_account_value_aed,
    a.quality_status as linked_account_quality_status,
    coalesce(c.contribution_activity_aed, 0) as contribution_activity_aed,
    coalesce(c.contribution_count, 0) as contribution_count,
    coalesce(c.invalid_contribution_count, 0) as invalid_contribution_count,
    case
      when g.kind = 'save_up' and g.linked_account_id is not null then 'linked_account'
      when g.kind = 'save_up' then 'contributions_implicit_aed'
      when g.kind = 'pay_down' then 'linked_liability_balance'
    end as progress_basis
  from public.goals g
  left join public.v_canonical_accounts_aed a on a.id = g.linked_account_id
  left join contribution c on c.goal_id = g.id
)
select
  b.*,
  case
    when b.kind = 'save_up' and b.linked_account_id is not null then b.linked_account_value_aed
    when b.kind = 'save_up' then round(b.contribution_activity_aed, 2)
    when b.kind = 'pay_down' then b.linked_account_value_aed
  end as current_amount_aed,
  case
    when b.kind = 'save_up' and b.linked_account_id is not null then b.linked_account_value_aed
    when b.kind = 'save_up' then round(b.contribution_activity_aed, 2)
    when b.kind = 'pay_down' and b.starting_balance is not null and b.linked_account_value_aed is not null
      then round(b.starting_balance - b.linked_account_value_aed, 2)
  end as raw_progress_aed,
  case
    when b.kind = 'save_up' and b.target_amount > 0 then
      round(100 * (case when b.linked_account_id is not null then b.linked_account_value_aed else b.contribution_activity_aed end) / b.target_amount, 2)
    when b.kind = 'pay_down' and b.starting_balance > 0 and b.linked_account_value_aed is not null then
      round(100 * (b.starting_balance - b.linked_account_value_aed) / b.starting_balance, 2)
  end as raw_progress_percent,
  case
    when b.kind = 'save_up' and b.target_amount > 0 then
      round(b.target_amount - (case when b.linked_account_id is not null then b.linked_account_value_aed else b.contribution_activity_aed end), 2)
    when b.kind = 'pay_down' then b.linked_account_value_aed
  end as raw_remaining_aed,
  case
    when b.target_amount <= 0 then 'incomplete'
    when b.invalid_contribution_count > 0 then 'incomplete'
    when b.kind = 'save_up' and b.linked_account_id is not null and b.linked_account_name is null then 'incomplete'
    when b.kind = 'save_up' and b.linked_account_id is not null and b.linked_account_quality_status = 'incomplete' then 'incomplete'
    when b.kind = 'pay_down' and (b.starting_balance is null or b.starting_balance <= 0) then 'incomplete'
    when b.kind = 'pay_down' and (b.linked_account_name is null or not coalesce(b.linked_account_is_liability, false)) then 'incomplete'
    when b.kind = 'pay_down' and b.linked_account_quality_status = 'incomplete' then 'incomplete'
    when b.linked_account_quality_status = 'provisional' then 'provisional'
    else 'complete'
  end as quality_status,
  jsonb_build_object(
    'basis', b.progress_basis,
    'target_currency', 'AED',
    'starting_balance_currency', case when b.kind = 'pay_down' then 'AED' else null end,
    'contribution_currency_basis', 'legacy_implicit_AED',
    'contributions_are_activity_only', b.linked_account_id is not null,
    'transaction_goal_id_is_display_only', true,
    'classification_version', 'shr-111-phase-a-v1'
  ) as quality_metadata
from based b;

comment on view public.v_canonical_goal_progress is
  'SHR-111 one progress basis per goal. Linked save-up uses canonical account value; unlinked save-up uses implicit-AED contributions; pay-down uses starting AED balance minus linked liability value. Activity never double-counts linked progress.';

-- Least-privilege exposed read contracts. Functions are SECURITY INVOKER and
-- views are security_invoker, so authenticated callers still require and obey
-- every underlying household policy.
revoke all on table public.v_canonical_ledger_aed,
  public.v_canonical_income_aed,
  public.v_canonical_accounts_aed,
  public.v_canonical_goal_progress
  from public, anon, authenticated, service_role;
grant select on table public.v_canonical_ledger_aed,
  public.v_canonical_income_aed,
  public.v_canonical_accounts_aed,
  public.v_canonical_goal_progress
  to authenticated, service_role;

revoke all on function public.canonical_period_metrics(date, date, text, text),
  public.canonical_balance_sheet(text, text),
  public.canonical_investment_metrics(text, text, timestamptz),
  public.canonical_budget_actuals(date, date, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.canonical_period_metrics(date, date, text, text),
  public.canonical_balance_sheet(text, text),
  public.canonical_investment_metrics(text, text, timestamptz),
  public.canonical_budget_actuals(date, date, text, text)
  to authenticated, service_role;

commit;

-- Production is deliberately NOT APPLIED by this implementation task.
