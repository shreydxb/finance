-- 045_immutable_audit_substrate.sql — SHR-191
--
-- The first V6.0 foundation: immutable, minimized action evidence with a
-- typed reference boundary. This migration deliberately integrates no
-- financial writer and synthesizes no historical events.

begin;

create table if not exists public.audit_events (
  event_id uuid primary key default gen_random_uuid(),
  occurred_at timestamptz not null,
  recorded_at timestamptz not null,
  producer_code text not null,
  producer_version smallint not null,
  actor_kind text not null,
  actor_access_user_id uuid,
  actor_telegram_sender_ref text,
  actor_service_code text,
  actor_system_code text,
  surface_code text not null,
  action_code text not null,
  target_kind text not null,
  target_id uuid not null,
  target_version_before integer,
  target_version_after integer,
  evidence_kind text not null,
  evidence_id uuid not null,
  evidence_version integer not null,
  request_id uuid not null,
  correlation_id uuid not null,
  causation_event_id uuid,
  idempotency_key_ref text not null,
  outcome text not null,
  outcome_code text not null,
  change_evidence jsonb not null,
  sensitivity_class text not null default 'household_private',
  schema_version smallint not null default 1,
  redaction_version smallint not null default 1,
  history_scope text not null default 'post_cutover_only',
  payload_digest text not null,

  constraint audit_events_time_order_check
    check (recorded_at >= occurred_at),
  constraint audit_events_producer_check
    check (producer_code = 'shr191.qa_fixture' and producer_version = 1),
  constraint audit_events_actor_kind_check
    check (actor_kind in ('authenticated_user', 'telegram_sender', 'service', 'system')),
  constraint audit_events_actor_shape_check
    check (
      (actor_kind = 'authenticated_user'
        and actor_access_user_id is not null
        and actor_telegram_sender_ref is null
        and actor_service_code is null
        and actor_system_code is null)
      or
      (actor_kind = 'telegram_sender'
        and actor_access_user_id is null
        and actor_telegram_sender_ref ~ '^tgref:v1:[0-9a-f]{64}$'
        and actor_service_code is null
        and actor_system_code is null)
      or
      (actor_kind = 'service'
        and actor_access_user_id is null
        and actor_telegram_sender_ref is null
        and actor_service_code = 'qa.audit_fixture_runner'
        and actor_system_code is null)
      or
      (actor_kind = 'system'
        and actor_access_user_id is null
        and actor_telegram_sender_ref is null
        and actor_service_code is null
        and actor_system_code = 'qa.audit_substrate')
    ),
  constraint audit_events_surface_check
    check (
      (actor_kind = 'authenticated_user' and surface_code in ('portal', 'operator_api'))
      or (actor_kind = 'telegram_sender' and surface_code = 'telegram')
      or (actor_kind = 'service' and surface_code in ('edge', 'operator_api'))
      or (actor_kind = 'system' and surface_code in ('scheduler', 'migration'))
    ),
  constraint audit_events_reference_check
    check (
      target_kind = 'audit.qa_fixture'
      and evidence_kind = 'audit.qa_fixture'
      and evidence_version = 1
    ),
  constraint audit_events_action_evidence_check
    check (
      (
        action_code = 'audit.qa_fixture.recorded'
        and target_version_before is null
        and target_version_after = 1
        and causation_event_id is null
        and outcome = 'succeeded'
        and outcome_code = 'fixture_recorded'
        and change_evidence = '{"field_code":"fixture_state","before_code":"absent","after_code":"recorded"}'::jsonb
      )
      or
      (
        action_code = 'audit.qa_fixture.verified'
        and target_version_before = 1
        and target_version_after = 2
        and causation_event_id is not null
        and outcome = 'succeeded'
        and outcome_code = 'fixture_verified'
        and change_evidence = '{"field_code":"fixture_state","before_code":"recorded","after_code":"verified"}'::jsonb
      )
    ),
  constraint audit_events_idempotency_ref_check
    check (idempotency_key_ref ~ '^sha256:[0-9a-f]{64}$'),
  constraint audit_events_payload_digest_check
    check (payload_digest ~ '^sha256:[0-9a-f]{64}$'),
  constraint audit_events_metadata_check
    check (
      sensitivity_class = 'household_private'
      and schema_version = 1
      and redaction_version = 1
      and history_scope = 'post_cutover_only'
    )
);

comment on table public.audit_events is
  'SHR-191 immutable action evidence. Not ownership, provenance, quality, attention, integration logging, or telemetry. No historical backfill; history before cutover is unknown.';
comment on column public.audit_events.actor_access_user_id is
  'Authenticated access identity only. It is never an economic owner or party inference.';
comment on column public.audit_events.actor_telegram_sender_ref is
  'Private irreversible Telegram sender reference (tgref:v1:sha256); never a raw Telegram identifier and never returned by audit_history_v1.';
comment on column public.audit_events.change_evidence is
  'Action-specific minimized evidence. Migration 045 permits only the two exact QA fixture projections; arbitrary payloads and request bodies are invalid.';
comment on column public.audit_events.causation_event_id is
  'Typed logical reference validated by the trusted append boundary. It is intentionally not a physical FK so an export can restore rows in any order.';

create unique index if not exists audit_events_success_replay_uidx
  on public.audit_events (producer_code, action_code, idempotency_key_ref);
create index if not exists audit_events_target_history_idx
  on public.audit_events (target_kind, target_id, occurred_at, event_id);
create index if not exists audit_events_correlation_idx
  on public.audit_events (correlation_id, occurred_at, event_id);

-- Table constraints reject malformed raw inserts. This insert trigger adds the
-- two relational checks that cannot be expressed as CHECK constraints without
-- weakening restore order: authenticated actors must be current access
-- members, and the QA verification action must cause from the matching
-- successful QA record action.
create or replace function private.validate_audit_event_insert()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.actor_kind = 'authenticated_user' and not exists (
    select 1 from public.household_members hm
    where hm.user_id = new.actor_access_user_id
  ) then
    raise exception 'SHR191_AUDIT_ACTOR_NOT_HOUSEHOLD_MEMBER' using errcode = '23514';
  end if;

  if new.action_code = 'audit.qa_fixture.verified' and not exists (
    select 1 from public.audit_events cause
    where cause.event_id = new.causation_event_id
      and cause.action_code = 'audit.qa_fixture.recorded'
      and cause.target_kind = new.target_kind
      and cause.target_id = new.target_id
      and cause.outcome = 'succeeded'
  ) then
    raise exception 'SHR191_AUDIT_CAUSATION_INVALID' using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists audit_events_validate_insert on public.audit_events;
create trigger audit_events_validate_insert
before insert on public.audit_events
for each row execute function private.validate_audit_event_insert();

-- UPDATE and DELETE are rejected even if an application role accidentally
-- receives a broad grant. The database owner can deliberately disable/drop
-- this trigger; SHR-191 documents that real administrative trust boundary
-- instead of claiming an impossible absolute guarantee against the owner.
create or replace function private.reject_audit_event_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception 'audit_events rows are immutable' using errcode = '55000';
end;
$$;

drop trigger if exists audit_events_immutable on public.audit_events;
create trigger audit_events_immutable
before update or delete on public.audit_events
for each row execute function private.reject_audit_event_mutation();

-- Owner-only primitive. No API role can execute this function directly.
-- Future audited mutation RPCs may call it inside their own transaction after
-- that action receives an independently reviewed typed policy.
create or replace function private.append_audit_event_v1(
  p_actor_kind text,
  p_actor_access_user_id uuid,
  p_actor_telegram_sender_ref text,
  p_actor_service_code text,
  p_actor_system_code text,
  p_surface_code text,
  p_action_code text,
  p_target_id uuid,
  p_evidence_id uuid,
  p_request_id uuid,
  p_correlation_id uuid,
  p_causation_event_id uuid,
  p_idempotency_key_ref text
)
returns table (event_id uuid, occurred_at timestamptz, replayed boolean)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_before integer;
  v_after integer;
  v_outcome_code text;
  v_change_evidence jsonb;
  v_payload jsonb;
  v_payload_digest text;
  v_existing public.audit_events%rowtype;
  v_inserted public.audit_events%rowtype;
begin
  if p_action_code = 'audit.qa_fixture.recorded' then
    v_before := null;
    v_after := 1;
    v_outcome_code := 'fixture_recorded';
    v_change_evidence := '{"field_code":"fixture_state","before_code":"absent","after_code":"recorded"}'::jsonb;
  elsif p_action_code = 'audit.qa_fixture.verified' then
    v_before := 1;
    v_after := 2;
    v_outcome_code := 'fixture_verified';
    v_change_evidence := '{"field_code":"fixture_state","before_code":"recorded","after_code":"verified"}'::jsonb;
  else
    raise exception 'SHR191_AUDIT_ACTION_NOT_ALLOWED' using errcode = '22023';
  end if;

  v_payload := jsonb_build_object(
    'producer_code', 'shr191.qa_fixture',
    'producer_version', 1,
    'actor_kind', p_actor_kind,
    'actor_access_user_id', p_actor_access_user_id,
    'actor_telegram_sender_ref', p_actor_telegram_sender_ref,
    'actor_service_code', p_actor_service_code,
    'actor_system_code', p_actor_system_code,
    'surface_code', p_surface_code,
    'action_code', p_action_code,
    'target_kind', 'audit.qa_fixture',
    'target_id', p_target_id,
    'target_version_before', v_before,
    'target_version_after', v_after,
    'evidence_kind', 'audit.qa_fixture',
    'evidence_id', p_evidence_id,
    'evidence_version', 1,
    'request_id', p_request_id,
    'correlation_id', p_correlation_id,
    'causation_event_id', p_causation_event_id,
    'idempotency_key_ref', p_idempotency_key_ref,
    'outcome', 'succeeded',
    'outcome_code', v_outcome_code,
    'change_evidence', v_change_evidence,
    'sensitivity_class', 'household_private',
    'schema_version', 1,
    'redaction_version', 1,
    'history_scope', 'post_cutover_only'
  );
  v_payload_digest := 'sha256:' || encode(
    extensions.digest(convert_to(v_payload::text, 'UTF8'), 'sha256'), 'hex'
  );

  select e.* into v_existing
  from public.audit_events e
  where e.producer_code = 'shr191.qa_fixture'
    and e.action_code = p_action_code
    and e.idempotency_key_ref = p_idempotency_key_ref;

  if found then
    if v_existing.payload_digest <> v_payload_digest then
      raise exception 'SHR191_AUDIT_IDEMPOTENCY_CONFLICT' using errcode = '23505';
    end if;
    return query select v_existing.event_id, v_existing.occurred_at, true;
    return;
  end if;

  begin
    insert into public.audit_events (
      occurred_at, recorded_at, producer_code, producer_version,
      actor_kind, actor_access_user_id, actor_telegram_sender_ref,
      actor_service_code, actor_system_code, surface_code,
      action_code, target_kind, target_id, target_version_before,
      target_version_after, evidence_kind, evidence_id, evidence_version,
      request_id, correlation_id, causation_event_id, idempotency_key_ref,
      outcome, outcome_code, change_evidence, sensitivity_class,
      schema_version, redaction_version, history_scope, payload_digest
    ) values (
      v_now, v_now, 'shr191.qa_fixture', 1,
      p_actor_kind, p_actor_access_user_id, p_actor_telegram_sender_ref,
      p_actor_service_code, p_actor_system_code, p_surface_code,
      p_action_code, 'audit.qa_fixture', p_target_id, v_before,
      v_after, 'audit.qa_fixture', p_evidence_id, 1,
      p_request_id, p_correlation_id, p_causation_event_id, p_idempotency_key_ref,
      'succeeded', v_outcome_code, v_change_evidence, 'household_private',
      1, 1, 'post_cutover_only', v_payload_digest
    ) returning * into v_inserted;
  exception when unique_violation then
    select e.* into v_existing
    from public.audit_events e
    where e.producer_code = 'shr191.qa_fixture'
      and e.action_code = p_action_code
      and e.idempotency_key_ref = p_idempotency_key_ref;

    if not found or v_existing.payload_digest <> v_payload_digest then
      raise exception 'SHR191_AUDIT_IDEMPOTENCY_CONFLICT' using errcode = '23505';
    end if;
    return query select v_existing.event_id, v_existing.occurred_at, true;
    return;
  end;

  return query select v_inserted.event_id, v_inserted.occurred_at, false;
end;
$$;

comment on function private.append_audit_event_v1(text, uuid, text, text, text, text, text, uuid, uuid, uuid, uuid, uuid, text) is
  'Owner-only typed append primitive. No API role may execute it directly. Exact successful replay returns the original event; a changed payload under the same action/key fails.';

-- QA-only reference surface. It demonstrates the trusted append contract for
-- all four actor representations without integrating any production writer.
create or replace function public.record_audit_qa_fixture_v1(
  p_actor_kind text,
  p_actor_access_user_id uuid,
  p_actor_telegram_sender_ref text,
  p_actor_service_code text,
  p_actor_system_code text,
  p_surface_code text,
  p_action_code text,
  p_target_id uuid,
  p_evidence_id uuid,
  p_request_id uuid,
  p_correlation_id uuid,
  p_causation_event_id uuid,
  p_idempotency_key_ref text
)
returns table (event_id uuid, occurred_at timestamptz, replayed boolean)
language sql
volatile
security definer
set search_path = ''
as $$
  select * from private.append_audit_event_v1(
    p_actor_kind,
    p_actor_access_user_id,
    p_actor_telegram_sender_ref,
    p_actor_service_code,
    p_actor_system_code,
    p_surface_code,
    p_action_code,
    p_target_id,
    p_evidence_id,
    p_request_id,
    p_correlation_id,
    p_causation_event_id,
    p_idempotency_key_ref
  )
$$;

comment on function public.record_audit_qa_fixture_v1(text, uuid, text, text, text, text, text, uuid, uuid, uuid, uuid, uuid, text) is
  'SHR-191 QA-only trusted reference writer. Service role only; not a production financial, category, party, Telegram, or attention integration.';

-- Redacted household read contract. Raw table SELECT is never granted to an
-- authenticated client because doing so would expose the private sender ref.
-- This SECURITY DEFINER RPC derives the caller from auth.uid(), authorizes
-- only through the existing membership root, and returns no raw sender ref.
create or replace function public.audit_history_v1(
  p_target_kind text default null,
  p_target_id uuid default null,
  p_limit integer default 100
)
returns table (
  event_id uuid,
  occurred_at timestamptz,
  recorded_at timestamptz,
  producer_code text,
  producer_version smallint,
  actor_kind text,
  actor_access_user_id uuid,
  actor_code text,
  has_private_actor_reference boolean,
  surface_code text,
  action_code text,
  target_kind text,
  target_id uuid,
  target_version_before integer,
  target_version_after integer,
  evidence_kind text,
  evidence_id uuid,
  evidence_version integer,
  request_id uuid,
  correlation_id uuid,
  causation_event_id uuid,
  idempotency_key_ref text,
  outcome text,
  outcome_code text,
  change_evidence jsonb,
  sensitivity_class text,
  schema_version smallint,
  redaction_version smallint,
  history_scope text,
  payload_digest text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not private.is_household_member() then
    raise exception 'AUDIT_HISTORY_FORBIDDEN' using errcode = '42501';
  end if;
  if p_target_kind is not null and p_target_kind <> 'audit.qa_fixture' then
    raise exception 'AUDIT_HISTORY_TARGET_KIND_NOT_ALLOWED' using errcode = '22023';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 200 then
    raise exception 'AUDIT_HISTORY_LIMIT_INVALID' using errcode = '22023';
  end if;

  return query
  select
    e.event_id,
    e.occurred_at,
    e.recorded_at,
    e.producer_code,
    e.producer_version,
    e.actor_kind,
    e.actor_access_user_id,
    case
      when e.actor_kind = 'service' then e.actor_service_code
      when e.actor_kind = 'system' then e.actor_system_code
      else null
    end as actor_code,
    e.actor_telegram_sender_ref is not null as has_private_actor_reference,
    e.surface_code,
    e.action_code,
    e.target_kind,
    e.target_id,
    e.target_version_before,
    e.target_version_after,
    e.evidence_kind,
    e.evidence_id,
    e.evidence_version,
    e.request_id,
    e.correlation_id,
    e.causation_event_id,
    e.idempotency_key_ref,
    e.outcome,
    e.outcome_code,
    e.change_evidence,
    'household_redacted'::text as sensitivity_class,
    e.schema_version,
    e.redaction_version,
    e.history_scope,
    e.payload_digest
  from public.audit_events e
  where (p_target_kind is null or e.target_kind = p_target_kind)
    and (p_target_id is null or e.target_id = p_target_id)
  order by e.occurred_at desc, e.event_id desc
  limit p_limit;
end;
$$;

comment on function public.audit_history_v1(text, uuid, integer) is
  'Authenticated household-member redacted audit read. Authorization is private.is_household_member(); Telegram sender refs are never returned.';

alter table public.audit_events enable row level security;

drop policy if exists "audit events deny raw api access" on public.audit_events;
create policy "audit events deny raw api access" on public.audit_events
  for all to anon, authenticated
  using (false)
  with check (false);

-- Supabase projects may auto-create broad default grants on public tables.
-- Revoke first and grant only the raw read needed by the trusted encrypted
-- backup exporter. No API role receives raw INSERT/UPDATE/DELETE.
revoke all on table public.audit_events
  from public, anon, authenticated, service_role;
grant select on table public.audit_events to service_role;

revoke all on function private.validate_audit_event_insert(),
  private.reject_audit_event_mutation(),
  private.append_audit_event_v1(text, uuid, text, text, text, text, text, uuid, uuid, uuid, uuid, uuid, text)
  from public, anon, authenticated, service_role;

revoke all on function public.record_audit_qa_fixture_v1(text, uuid, text, text, text, text, text, uuid, uuid, uuid, uuid, uuid, text),
  public.audit_history_v1(text, uuid, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.record_audit_qa_fixture_v1(text, uuid, text, text, text, text, text, uuid, uuid, uuid, uuid, uuid, text)
  to service_role;
grant execute on function public.audit_history_v1(text, uuid, integer)
  to authenticated;

commit;

-- Rollback is route-level only: stop future typed writers and readers while
-- retaining public.audit_events and its immutable evidence. Do not drop rows.
