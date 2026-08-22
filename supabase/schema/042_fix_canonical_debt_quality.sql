-- 042_fix_canonical_debt_quality.sql — SHR-111 / SHR-121
--
-- Correct the Phase A goal-quality predicate without changing goal facts,
-- progress arithmetic, contribution evidence, consumers, or historical data.

begin;

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
    when b.kind = 'save_up' and (b.target_amount is null or b.target_amount <= 0) then 'incomplete'
    when b.invalid_contribution_count > 0 then 'incomplete'
    when b.kind = 'save_up' and b.linked_account_id is not null and b.linked_account_name is null then 'incomplete'
    when b.kind = 'save_up' and b.linked_account_id is not null and b.linked_account_quality_status = 'incomplete' then 'incomplete'
    when b.kind = 'pay_down' and (b.starting_balance is null or b.starting_balance <= 0) then 'incomplete'
    when b.kind = 'pay_down' and (
      b.linked_account_id is null
      or b.linked_account_name is null
      or not coalesce(b.linked_account_is_liability, false)
    ) then 'incomplete'
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
  'SHR-111/SHR-121: one progress basis per goal. Positive target is required only for save-up; pay-down quality uses positive AED starting balance plus a valid canonical linked liability. Activity never double-counts linked progress.';

revoke all on table public.v_canonical_goal_progress
  from public, anon, authenticated, service_role;
grant select on table public.v_canonical_goal_progress
  to authenticated, service_role;

commit;
