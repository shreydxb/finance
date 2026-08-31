-- 048_access_party_reconciliation.sql — SHR-194
--
-- Evidence-reviewed access-to-party reconciliation and the audited mapping
-- lifecycle, built on the empty substrate SHR-193 left behind.
--
-- SHR-193 created the tables and refused to put anything in them. This package
-- adds the only sanctioned way rows get there, and it is deliberately narrow:
--
--   * a read-only preflight that can *prove* the current access roster and the
--     current economic state, as a count and as a digest over the exact
--     identity evidence;
--   * one transactional reconciliation entry point that takes an explicitly
--     approved manifest — the parties to create and the decision for every
--     access identity — checks the proven evidence against what the manifest
--     was approved against, and aborts before any DML if they disagree;
--   * an ordinary mapping lifecycle (create / change / deactivate / read) whose
--     decision timestamps are authored by the database;
--   * immutable per-decision history, and one SHR-191 audit event per decision
--     derived from that history rather than asserted alongside it;
--   * a narrow context API telling an authenticated caller who they are
--     economically and which scopes they may legitimately choose.
--
-- What it deliberately does not do, because a reviewer will look for each:
--
--   * it creates no economic party and no mapping decision when it is applied.
--     This migration is inert exactly as 047 was; every row is created later by
--     an explicit, separately approved manifest call. No party is inferred from
--     a display name, an email address, a Telegram identity, an account, a
--     transaction history or a historical percentage;
--   * it changes no authorization. public.household_members and
--     private.is_household_member() remain the only authorization root, no
--     policy on any financial table is touched, no new role is invented, and
--     economic identity still appears in no RLS predicate anywhere;
--   * it rewrites no historical financial fact. No transaction, account,
--     income, recurring item, goal, budget, investment or net-worth row is read
--     for inference or written at all. Ownership migration for each of those is
--     its own downstream contract (SHR-154/171/178/195);
--   * it stores no Telegram association. SHR-160/184 still own that;
--   * it does not use private.restore_access_party_mapping_v1(). That function
--     stays what SHR-193 made it — an administrative disaster-recovery path —
--     and the ordinary writer below refuses to run at all if its restore token
--     is set, so the two paths cannot be confused even by accident.
--
-- Release ordering is unchanged and this migration does not weaken it: 045 must
-- still be applied together with the reviewed backup source, because audit
-- evidence must not accumulate before backup coverage exists. 048 depends on
-- 045, 046 and 047 and can only be applied after all three.
--
-- One naming boundary is worth stating once, because the schema has no column
-- for it. SHR-193 gave *parties* an archive lifecycle and gave mappings three
-- statuses and no archive column. So "archiving" a mapping here means exactly
-- what that schema can express: the economic link is deactivated by moving the
-- decision to access_only, which keeps the household authorization untouched,
-- keeps the decision and its whole history, and is itself a new audited
-- decision. No mapping row is ever deleted, and no archived_at column is
-- invented for one.

begin;

-- ── 1. Structural household containment for mapping evidence ─────────────
--
-- access_party_mappings already guarantees that a mapping cannot reference a
-- party in another economic household (047's composite FK). The history table
-- below needs the mirror-image guarantee — that a history row cannot claim a
-- household its mapping does not belong to — and a composite foreign key is the
-- only way to get it structurally rather than by convention. That key needs a
-- unique constraint to target, so one is added here. It is implied by the
-- primary key and therefore constrains nothing new; it exists to be referenced.
--
-- Added conditionally rather than with drop-and-recreate for the same reason
-- 047 did: the foreign key below depends on this constraint's index, so
-- dropping it on a re-run would fail outright.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.access_party_mappings'::regclass
      and conname = 'access_party_mappings_household_scope_key'
  ) then
    alter table public.access_party_mappings
      add constraint access_party_mappings_household_scope_key
      unique (mapping_id, household_id);
  end if;
end $$;

-- ── 2. Immutable mapping decision history ────────────────────────────────
--
-- access_party_mappings holds exactly one row per (household, auth identity):
-- the *current* decision. A change updates it in place, which is correct — the
-- current decision is a single fact — but it means the table alone cannot
-- answer "what did this decision used to be?".
--
-- This table is that answer, and it is a separate object from audit_events on
-- purpose. SHR-191 states its own boundary explicitly: audit_events is action
-- evidence and is "not ownership, provenance, quality, attention, integration
-- logging, or telemetry", and its change_evidence is a deliberately minimized
-- coded projection. Mapping history is domain state — the household's own
-- durable record of who was reconciled to whom and when — so leaning on the
-- minimized audit projection to carry it would violate SHR-191's contract in
-- order to avoid a table. 046 drew the same line for category renames.
--
-- The two never drift, because the audit event for a decision is derived from
-- the history row rather than written alongside it (see section 5).

create table if not exists public.access_party_mapping_history (
  mapping_history_id uuid primary key default gen_random_uuid(),
  mapping_id uuid not null,
  household_id uuid not null,
  auth_user_id uuid not null,
  decision_version integer not null,
  action_code text not null,
  previous_status text,
  new_status text not null,
  previous_economic_party_id uuid,
  new_economic_party_id uuid,
  decided_at timestamptz not null,
  decided_by_access_user_id uuid,
  decision_evidence_ref text,
  recorded_at timestamptz not null default now(),
  schema_version smallint not null default 1,

  -- One row per decision version, which is also the concurrency backstop: two
  -- competing changes cannot both become version N.
  constraint access_party_mapping_history_version_key
    unique (mapping_id, decision_version),

  -- A history row cannot claim a household its own mapping does not belong to.
  constraint access_party_mapping_history_mapping_fk
    foreign key (mapping_id, household_id)
    references public.access_party_mappings (mapping_id, household_id) on delete restrict,

  -- Neither side of a recorded transition may name a party from another
  -- economic household — the same structural containment 047 gave the mapping
  -- itself, applied to the before and after states it changed between. Both
  -- columns are nullable, and a NULL party is simply not constrained (MATCH
  -- SIMPLE), which is exactly right: access_only has no party on that side.
  --
  -- These are two columns describing one transition, not a join: a decision
  -- still selects at most one party, which is the mapping row's own single
  -- economic_party_id. There is no allocation between them and no share.
  constraint access_party_mapping_history_previous_party_fk
    foreign key (previous_economic_party_id, household_id)
    references public.economic_parties (party_id, household_id) on delete restrict,
  constraint access_party_mapping_history_new_party_fk
    foreign key (new_economic_party_id, household_id)
    references public.economic_parties (party_id, household_id) on delete restrict,

  constraint access_party_mapping_history_version_check
    check (decision_version >= 1),

  constraint access_party_mapping_history_action_check
    check (action_code in (
      'economic.access_party_mapping.created',
      'economic.access_party_mapping.changed',
      'economic.access_party_mapping.deactivated')),

  -- Only a real decision is recorded. "unreviewed" is the absence of one and
  -- is never a history entry, and a decision can never be un-made.
  constraint access_party_mapping_history_new_status_check
    check (new_status in ('mapped', 'access_only')),
  constraint access_party_mapping_history_previous_status_check
    check (previous_status is null
           or previous_status in ('mapped', 'access_only', 'unreviewed')),

  -- The party half of the decision must agree with the status half, on both
  -- sides of the transition — the same shape rule 047 applies to the mapping.
  constraint access_party_mapping_history_new_party_shape_check
    check ((new_status = 'mapped' and new_economic_party_id is not null)
           or (new_status = 'access_only' and new_economic_party_id is null)),
  constraint access_party_mapping_history_previous_party_shape_check
    check ((previous_status = 'mapped' and previous_economic_party_id is not null)
           or (previous_status is distinct from 'mapped' and previous_economic_party_id is null)),

  -- A creation has nothing before it and is always version 1. A change or a
  -- deactivation always has a state it changed from.
  constraint access_party_mapping_history_created_shape_check
    check (action_code <> 'economic.access_party_mapping.created'
           or (previous_status is null and decision_version = 1)),
  constraint access_party_mapping_history_transition_shape_check
    check (action_code = 'economic.access_party_mapping.created'
           or previous_status is not null),

  -- Deactivation has exactly one meaning in this schema: an economic mapping
  -- becomes access_only. It is never a delete and never a regression to
  -- unreviewed.
  constraint access_party_mapping_history_deactivation_shape_check
    check (action_code <> 'economic.access_party_mapping.deactivated'
           or (previous_status = 'mapped' and new_status = 'access_only')),

  -- A recorded transition must actually change something.
  constraint access_party_mapping_history_effective_change_check
    check (action_code = 'economic.access_party_mapping.created'
           or previous_status is distinct from new_status
           or previous_economic_party_id is distinct from new_economic_party_id),

  constraint access_party_mapping_history_evidence_ref_check
    check (decision_evidence_ref is null
           or (decision_evidence_ref <> '' and decision_evidence_ref = btrim(decision_evidence_ref))),

  constraint access_party_mapping_history_time_order_check
    check (recorded_at >= decided_at),

  constraint access_party_mapping_history_metadata_check
    check (schema_version = 1)
);

comment on table public.access_party_mapping_history is
  'SHR-194 immutable per-decision history for public.access_party_mappings. Append-only domain evidence: every create, change and deactivation is preserved, no row is ever updated or deleted, and a new decision never rewrites an older one to look historical. Distinct from public.audit_events by SHR-191''s own contract — that table is minimized action evidence and explicitly not ownership or provenance record — and the two cannot drift because each audit event is derived from the history row it describes.';
comment on column public.access_party_mapping_history.decision_version is
  'Monotonic per-mapping decision counter starting at 1. It is the audit event''s target/evidence version, and its unique constraint is what makes two competing decisions on one mapping fail closed rather than silently interleave.';
comment on column public.access_party_mapping_history.decided_at is
  'Copied from the mapping row''s database-authored decision time. No caller, operator included, supplies it on any ordinary path.';
comment on column public.access_party_mapping_history.decision_evidence_ref is
  'Opaque reference to the reviewed evidence behind this decision — typically the approved manifest row. It is never an identifier, never an authorization key, and never an economic-party key.';

create index if not exists access_party_mapping_history_mapping_idx
  on public.access_party_mapping_history (mapping_id, decision_version desc);
create index if not exists access_party_mapping_history_household_idx
  on public.access_party_mapping_history (household_id, auth_user_id, decision_version desc);

-- ── 3. Reconciliation run record ─────────────────────────────────────────
--
-- The durable answer to "has this exact approved manifest already been
-- applied?". It is what makes the reconciliation path safe against a retry, a
-- process restart, a migration re-run and a duplicated invocation: the manifest
-- reference is unique, and re-applying the same manifest is a proven replay
-- that performs no DML at all rather than a second set of decisions.
--
-- It also stores the roster digest that was actually proven at apply time, so a
-- reviewer can tell after the fact which access roster the decisions were
-- approved against.

create table if not exists public.access_party_reconciliation_runs (
  run_id uuid primary key default gen_random_uuid(),
  manifest_ref text not null,
  manifest_digest text not null,
  access_roster_digest text not null,
  access_member_count integer not null,
  economic_household_id uuid not null
    references public.economic_households(household_id) on delete restrict,
  party_count integer not null,
  decision_count integer not null,
  applied_at timestamptz not null default now(),
  applied_by_access_user_id uuid,
  schema_version smallint not null default 1,

  constraint access_party_reconciliation_runs_manifest_key unique (manifest_ref),
  constraint access_party_reconciliation_runs_manifest_ref_check
    check (manifest_ref <> '' and manifest_ref = btrim(manifest_ref)),
  constraint access_party_reconciliation_runs_manifest_digest_check
    check (manifest_digest ~ '^sha256:[0-9a-f]{64}$'),
  constraint access_party_reconciliation_runs_roster_digest_check
    check (access_roster_digest ~ '^sha256:[0-9a-f]{64}$'),
  constraint access_party_reconciliation_runs_counts_check
    check (access_member_count >= 0 and party_count >= 0 and decision_count >= 0),
  constraint access_party_reconciliation_runs_metadata_check
    check (schema_version = 1)
);

comment on table public.access_party_reconciliation_runs is
  'SHR-194 immutable record of an applied, evidence-reviewed reconciliation manifest. The unique manifest reference is the idempotency key: re-applying the same approved manifest is a no-DML replay, and the same reference carrying different content is refused as a conflict rather than silently reapplied.';
comment on column public.access_party_reconciliation_runs.access_roster_digest is
  'The access-roster digest actually proven by the preflight at apply time. A digest, never the roster: no email address or display name is stored here.';

-- ── 4. Read-only preflight ───────────────────────────────────────────────
--
-- Everything in this section is STABLE and reads only. Nothing here writes a
-- row, and nothing here decides anything: the preflight's whole job is to make
-- the current facts provable so a human can approve a manifest against them and
-- so the release path can refuse to run against different ones.
--
-- The roster digest covers the exact identity evidence the manifest was
-- approved against — every access identity and the email address observed for
-- it — so a revoked member, an added member, or a changed email all move the
-- digest and fail the release closed. The email is evidence only: it is hashed
-- into a digest here and is never stored, never an economic-party key, and
-- never returned to any API role.

create or replace function private.access_roster_digest_v1()
returns text
language sql
stable
security invoker
set search_path = ''
as $$
  select 'sha256:' || pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        coalesce(
          (select pg_catalog.string_agg(
                    hm.user_id::text || '|' || coalesce(u.email, ''),
                    pg_catalog.chr(10) order by hm.user_id)
             from public.household_members hm
             left join auth.users u on u.id = hm.user_id),
          ''),
        'UTF8'),
      'sha256'),
    'hex')
$$;

comment on function private.access_roster_digest_v1() is
  'SHR-194 read-only digest over the exact current access roster (identity plus observed email evidence). Operator-only. Any roster or identity-evidence change moves the digest, which is what makes a stale manifest fail closed.';

create or replace function private.access_party_preflight_v1()
returns table (
  observed_at timestamptz,
  access_member_count integer,
  access_roster_digest text,
  economic_household_count integer,
  economic_party_count integer,
  mapping_count integer,
  reconciliation_run_count integer
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    pg_catalog.now(),
    (select pg_catalog.count(*)::integer from public.household_members),
    private.access_roster_digest_v1(),
    (select pg_catalog.count(*)::integer from public.economic_households),
    (select pg_catalog.count(*)::integer from public.economic_parties),
    (select pg_catalog.count(*)::integer from public.access_party_mappings),
    (select pg_catalog.count(*)::integer from public.access_party_reconciliation_runs)
$$;

comment on function private.access_party_preflight_v1() is
  'SHR-194 release-time read-only preflight. Returns the exact current access roster evidence and economic-identity state a manifest must be approved against. It writes nothing and decides nothing.';

create or replace function private.access_party_roster_v1()
returns table (
  auth_user_id uuid,
  access_email text,
  economic_household_id uuid,
  mapping_status text,
  economic_party_id uuid
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    hm.user_id,
    u.email,
    m.household_id,
    coalesce(m.status, 'unmapped'),
    m.economic_party_id
  from public.household_members hm
  left join auth.users u on u.id = hm.user_id
  left join public.access_party_mappings m on m.auth_user_id = hm.user_id
  order by hm.user_id
$$;

comment on function private.access_party_roster_v1() is
  'SHR-194 read-only per-identity roster evidence for building an approvable manifest. Operator-only and executable by no API role, because it returns email evidence. It proposes nothing: no party, no mapping and no identity is inferred from any value it returns.';

-- ── 5. The SHR-191 typed audit policy for mapping decisions ──────────────
--
-- SHR-191 anticipated exactly this: "Future audited mutation RPCs may call it
-- inside their own transaction after that action receives an independently
-- reviewed typed policy." So this section registers SHR-194's typed policy on
-- the existing substrate. It creates no second audit table and no second
-- immutability model; audit_events, its triggers, its replay index and its
-- redacted read contract are all reused unchanged.
--
-- The constraints below are widened additively. Both SHR-191 QA branches are
-- reproduced verbatim, so every 045 assertion and every existing payload digest
-- is unaffected.

alter table public.audit_events drop constraint if exists audit_events_producer_check;
alter table public.audit_events add constraint audit_events_producer_check
  check (
    (producer_code = 'shr191.qa_fixture' and producer_version = 1)
    or (producer_code = 'shr194.access_party_mapping' and producer_version = 1)
  );

-- The acting identity is either a real access identity (an operator acting
-- through an authenticated session, already required by 045's insert trigger to
-- be a current household member) or the migration/operator authority itself,
-- which has no access identity and is recorded as a system actor. No new actor
-- kind and no new surface code is introduced: 'operator_api' and 'migration'
-- already exist in 045's surface check for exactly these two actor kinds.
alter table public.audit_events drop constraint if exists audit_events_actor_shape_check;
alter table public.audit_events add constraint audit_events_actor_shape_check
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
      and actor_system_code in ('qa.audit_substrate', 'shr194.access_party_reconciliation'))
  );

alter table public.audit_events drop constraint if exists audit_events_reference_check;
alter table public.audit_events add constraint audit_events_reference_check
  check (
    (target_kind = 'audit.qa_fixture'
      and evidence_kind = 'audit.qa_fixture'
      and evidence_version = 1)
    or
    -- The target is the mapping decision itself; the evidence is the immutable
    -- history row for that exact decision version, so an auditor can reach the
    -- full before/after state from the event without trusting the event's own
    -- minimized projection.
    (target_kind = 'economic.access_party_mapping'
      and evidence_kind = 'economic.access_party_mapping_decision'
      and evidence_version >= 1)
  );

alter table public.audit_events drop constraint if exists audit_events_action_evidence_check;
alter table public.audit_events add constraint audit_events_action_evidence_check
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
    or
    (
      -- SHR-194 mapping lifecycle. The projection is closed: exactly these
      -- seven keys, no more, so an arbitrary payload or a request body cannot
      -- be smuggled into audit evidence. It carries opaque identifiers and
      -- coded states only — no display name, no email address, and only a
      -- digest of the free-text evidence reference.
      action_code in (
        'economic.access_party_mapping.created',
        'economic.access_party_mapping.changed',
        'economic.access_party_mapping.deactivated')
      and producer_code = 'shr194.access_party_mapping'
      and target_kind = 'economic.access_party_mapping'
      and causation_event_id is null
      and outcome = 'succeeded'
      and target_version_after >= 1
      and evidence_version = target_version_after
      and (target_version_before is null
           or target_version_before = target_version_after - 1)
      and (target_version_after > 1 or target_version_before is null)
      and outcome_code = case action_code
            when 'economic.access_party_mapping.created' then 'mapping_created'
            when 'economic.access_party_mapping.changed' then 'mapping_changed'
            else 'mapping_deactivated'
          end
      and change_evidence ?& array[
            'field_code', 'before_code', 'after_code',
            'before_party_id', 'after_party_id',
            'household_id', 'evidence_ref_digest']
      and (change_evidence - array[
            'field_code', 'before_code', 'after_code',
            'before_party_id', 'after_party_id',
            'household_id', 'evidence_ref_digest']) = '{}'::jsonb
      and change_evidence ->> 'field_code' = 'mapping_status'
      and change_evidence ->> 'after_code' in ('mapped', 'access_only')
      and change_evidence ->> 'before_code' in
            ('absent', 'unreviewed', 'mapped', 'access_only')
      and jsonb_typeof(change_evidence -> 'before_party_id') in ('null', 'string')
      and jsonb_typeof(change_evidence -> 'after_party_id') in ('null', 'string')
      and jsonb_typeof(change_evidence -> 'household_id') = 'string'
      and jsonb_typeof(change_evidence -> 'evidence_ref_digest') in ('null', 'string')
      -- The party half of the projection agrees with the status half, on both
      -- sides, exactly as the mapping and history rows require.
      and ((change_evidence ->> 'after_code' = 'mapped'
             and jsonb_typeof(change_evidence -> 'after_party_id') = 'string')
           or (change_evidence ->> 'after_code' = 'access_only'
             and jsonb_typeof(change_evidence -> 'after_party_id') = 'null'))
      and ((change_evidence ->> 'before_code' = 'mapped'
             and jsonb_typeof(change_evidence -> 'before_party_id') = 'string')
           or (change_evidence ->> 'before_code' <> 'mapped'
             and jsonb_typeof(change_evidence -> 'before_party_id') = 'null'))
      and (action_code <> 'economic.access_party_mapping.created'
           or (change_evidence ->> 'before_code' = 'absent'
               and target_version_after = 1))
      and (action_code <> 'economic.access_party_mapping.deactivated'
           or (change_evidence ->> 'before_code' = 'mapped'
               and change_evidence ->> 'after_code' = 'access_only'))
    )
  );

comment on column public.audit_events.change_evidence is
  'Action-specific minimized evidence. Migration 045 permitted only the two exact QA fixture projections; 048 adds the closed SHR-194 mapping-decision projection — coded states and opaque identifiers plus a digest of the evidence reference, never a name, an email address or a request body. Arbitrary payloads remain invalid.';

-- The one append primitive, extended rather than duplicated.
--
-- Its 13-argument signature is unchanged, so every 045 grant, revoke and test
-- continues to apply to exactly this function, and the two QA branches produce
-- byte-identical payloads and digests to before. What changes is that the
-- producer, target kind, evidence kind, versions, outcome code and change
-- evidence are now derived per action instead of hardcoded to the QA policy.
--
-- The SHR-194 branch derives all of that from the immutable history row named
-- by p_evidence_id. That is the important property: an audit event cannot
-- disagree with the decision it describes, and an event cannot be fabricated
-- for a decision that never happened, because there would be no history row to
-- derive it from.
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
  v_producer text;
  v_target_kind text;
  v_evidence_kind text;
  v_evidence_version integer;
  v_before integer;
  v_after integer;
  v_outcome_code text;
  v_change_evidence jsonb;
  v_payload jsonb;
  v_payload_digest text;
  v_hist public.access_party_mapping_history%rowtype;
  v_existing public.audit_events%rowtype;
  v_inserted public.audit_events%rowtype;
begin
  if p_action_code = 'audit.qa_fixture.recorded' then
    v_producer := 'shr191.qa_fixture';
    v_target_kind := 'audit.qa_fixture';
    v_evidence_kind := 'audit.qa_fixture';
    v_evidence_version := 1;
    v_before := null;
    v_after := 1;
    v_outcome_code := 'fixture_recorded';
    v_change_evidence := '{"field_code":"fixture_state","before_code":"absent","after_code":"recorded"}'::jsonb;
  elsif p_action_code = 'audit.qa_fixture.verified' then
    v_producer := 'shr191.qa_fixture';
    v_target_kind := 'audit.qa_fixture';
    v_evidence_kind := 'audit.qa_fixture';
    v_evidence_version := 1;
    v_before := 1;
    v_after := 2;
    v_outcome_code := 'fixture_verified';
    v_change_evidence := '{"field_code":"fixture_state","before_code":"recorded","after_code":"verified"}'::jsonb;
  elsif p_action_code in (
      'economic.access_party_mapping.created',
      'economic.access_party_mapping.changed',
      'economic.access_party_mapping.deactivated') then
    select h.* into v_hist
      from public.access_party_mapping_history h
     where h.mapping_history_id = p_evidence_id;
    if not found then
      raise exception 'SHR194_AUDIT_EVIDENCE_NOT_FOUND' using errcode = '23514';
    end if;
    -- The event must describe the decision its own evidence describes.
    if v_hist.mapping_id is distinct from p_target_id
       or v_hist.action_code is distinct from p_action_code then
      raise exception 'SHR194_AUDIT_EVIDENCE_MISMATCH' using errcode = '23514';
    end if;

    v_producer := 'shr194.access_party_mapping';
    v_target_kind := 'economic.access_party_mapping';
    v_evidence_kind := 'economic.access_party_mapping_decision';
    v_evidence_version := v_hist.decision_version;
    v_after := v_hist.decision_version;
    v_before := case when v_hist.decision_version > 1
                     then v_hist.decision_version - 1 end;
    v_outcome_code := case p_action_code
      when 'economic.access_party_mapping.created' then 'mapping_created'
      when 'economic.access_party_mapping.changed' then 'mapping_changed'
      else 'mapping_deactivated'
    end;
    v_change_evidence := jsonb_build_object(
      'field_code', 'mapping_status',
      'before_code', coalesce(v_hist.previous_status, 'absent'),
      'after_code', v_hist.new_status,
      'before_party_id', v_hist.previous_economic_party_id,
      'after_party_id', v_hist.new_economic_party_id,
      'household_id', v_hist.household_id,
      'evidence_ref_digest',
        case when v_hist.decision_evidence_ref is null then null
             else 'sha256:' || pg_catalog.encode(
                    extensions.digest(
                      pg_catalog.convert_to(v_hist.decision_evidence_ref, 'UTF8'),
                      'sha256'),
                    'hex')
        end
    );
  else
    raise exception 'SHR191_AUDIT_ACTION_NOT_ALLOWED' using errcode = '22023';
  end if;

  v_payload := jsonb_build_object(
    'producer_code', v_producer,
    'producer_version', 1,
    'actor_kind', p_actor_kind,
    'actor_access_user_id', p_actor_access_user_id,
    'actor_telegram_sender_ref', p_actor_telegram_sender_ref,
    'actor_service_code', p_actor_service_code,
    'actor_system_code', p_actor_system_code,
    'surface_code', p_surface_code,
    'action_code', p_action_code,
    'target_kind', v_target_kind,
    'target_id', p_target_id,
    'target_version_before', v_before,
    'target_version_after', v_after,
    'evidence_kind', v_evidence_kind,
    'evidence_id', p_evidence_id,
    'evidence_version', v_evidence_version,
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
  where e.producer_code = v_producer
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
      v_now, v_now, v_producer, 1,
      p_actor_kind, p_actor_access_user_id, p_actor_telegram_sender_ref,
      p_actor_service_code, p_actor_system_code, p_surface_code,
      p_action_code, v_target_kind, p_target_id, v_before,
      v_after, v_evidence_kind, p_evidence_id, v_evidence_version,
      p_request_id, p_correlation_id, p_causation_event_id, p_idempotency_key_ref,
      'succeeded', v_outcome_code, v_change_evidence, 'household_private',
      1, 1, 'post_cutover_only', v_payload_digest
    ) returning * into v_inserted;
  exception when unique_violation then
    select e.* into v_existing
    from public.audit_events e
    where e.producer_code = v_producer
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
  'Owner-only typed append primitive. No API role may execute it directly. Exact successful replay returns the original event; a changed payload under the same action/key fails. SHR-194 registered the mapping-decision policy on it: those events derive their producer, kinds, versions and change evidence from the immutable history row named by p_evidence_id, so an audit event can neither disagree with the decision it describes nor exist without one.';

-- The redacted household read contract gains the SHR-194 target kind. Nothing
-- else about it changes: the same membership authorization, the same redaction,
-- and Telegram sender refs still never leave the database.
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
  if p_target_kind is not null
     and p_target_kind not in ('audit.qa_fixture', 'economic.access_party_mapping') then
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
  'Authenticated household-member redacted audit read. Authorization is private.is_household_member(); Telegram sender refs are never returned. SHR-194 added economic.access_party_mapping to the readable target kinds.';

-- ── 6. Immutability guards for the new evidence tables ───────────────────
--
-- Both tables are append-only for every role, the database owner's ordinary DML
-- included, for the same reason 047 refuses to delete a mapping decision: they
-- are the household's record of what was decided and when, and a rollback that
-- erased them would destroy the only evidence that a decision was ever made.
-- Rollback for this package is route-level, exactly as for 045, 046 and 047.
--
-- SECURITY INVOKER so current_user is the role that actually issued the
-- statement, matching every other guard in this schema.

create or replace function private.reject_access_party_evidence_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    raise exception 'SHR194_MAPPING_EVIDENCE_IMMUTABLE' using errcode = '55000';
  end if;
  raise exception 'SHR194_MAPPING_EVIDENCE_DELETE_FORBIDDEN' using errcode = '55000';
end;
$$;

comment on function private.reject_access_party_evidence_mutation() is
  'SHR-194 append-only boundary for mapping decision history and reconciliation run records. Never rewrite an old decision to make a new state look historical, and never delete decision history.';

create or replace function private.reject_access_party_evidence_truncate()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception 'SHR194_MAPPING_EVIDENCE_TRUNCATE_FORBIDDEN' using errcode = '55000';
end;
$$;

drop trigger if exists access_party_mapping_history_immutable
  on public.access_party_mapping_history;
create trigger access_party_mapping_history_immutable
before update or delete on public.access_party_mapping_history
for each row execute function private.reject_access_party_evidence_mutation();

drop trigger if exists access_party_mapping_history_no_truncate
  on public.access_party_mapping_history;
create trigger access_party_mapping_history_no_truncate
before truncate on public.access_party_mapping_history
for each statement execute function private.reject_access_party_evidence_truncate();

drop trigger if exists access_party_reconciliation_runs_immutable
  on public.access_party_reconciliation_runs;
create trigger access_party_reconciliation_runs_immutable
before update or delete on public.access_party_reconciliation_runs
for each row execute function private.reject_access_party_evidence_mutation();

drop trigger if exists access_party_reconciliation_runs_no_truncate
  on public.access_party_reconciliation_runs;
create trigger access_party_reconciliation_runs_no_truncate
before truncate on public.access_party_reconciliation_runs
for each statement execute function private.reject_access_party_evidence_truncate();

-- ── 7. Approved economic party creation ──────────────────────────────────
--
-- The only sanctioned way an economic party comes into existence. It creates
-- exactly the party it is told to create and infers nothing: no display name is
-- derived from an email address or an authentication identity, and the legacy
-- label — frozen forever once set, per SHR-193 — is supplied explicitly by the
-- approved manifest or not at all.

create or replace function private.create_economic_party_v1(
  p_household_id uuid,
  p_display_name text,
  p_legacy_owner_label text default null
)
returns public.economic_parties
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_row public.economic_parties%rowtype;
begin
  if not private.economic_identity_operator_authority() then
    raise exception 'SHR194_PARTY_CREATE_FORBIDDEN' using errcode = '42501';
  end if;
  if p_household_id is null then
    raise exception 'SHR194_PARTY_REQUIRES_HOUSEHOLD' using errcode = '22023';
  end if;
  if p_display_name is null or btrim(p_display_name) = '' then
    raise exception 'SHR194_PARTY_REQUIRES_DISPLAY_NAME' using errcode = '22023';
  end if;

  insert into public.economic_parties (household_id, display_name, legacy_owner_label)
  values (p_household_id, btrim(p_display_name), nullif(btrim(coalesce(p_legacy_owner_label, '')), ''))
  returning * into v_row;
  return v_row;
end;
$$;

comment on function private.create_economic_party_v1(uuid, text, text) is
  'SHR-194 approved economic party creation. Operator authority only, executable by no API role, and purely explicit: nothing is inferred from an email address, a display name, a Telegram identity or any financial history.';

-- ── 8. The ordinary mapping lifecycle writer ─────────────────────────────
--
-- Create, change and deactivate all travel through this one function, and every
-- decision it makes is an ordinary INSERT or UPDATE on access_party_mappings —
-- which is precisely what makes 047's lifecycle trigger author the decision
-- timestamp. It never calls private.restore_access_party_mapping_v1(), never
-- sets that function's token, and refuses to run at all if the token is set, so
-- the restore boundary cannot be reached from an ordinary decision even by
-- accident or by a caller who set it deliberately beforehand.
--
-- Concurrency is deterministic and fail-closed at three independent levels:
--
--   1. a transaction-scoped advisory lock on the exact decision subject
--      serializes competing writers, so the second one observes the first one's
--      committed row and records a real change rather than colliding;
--   2. SELECT ... FOR UPDATE holds the existing row for the rest of the
--      transaction;
--   3. if both were somehow bypassed, the unique key on
--      (mapping_id, decision_version) and 047's unique key on
--      (household_id, auth_user_id) refuse the write. Neither an ambiguous
--      current state nor a lost history row is representable.
--
-- Re-applying a decision that is already exactly in force is an explicit no-op:
-- no new decision timestamp, no history row, no audit event. That is not a
-- silently swallowed mismatch — there is nothing different to record — and it
-- is what makes a retry safe. A decision that differs in any way is a real
-- change and is recorded as one.

create or replace function private.set_access_party_mapping_v1(
  p_household_id uuid,
  p_auth_user_id uuid,
  p_status text,
  p_economic_party_id uuid default null,
  p_decision_evidence_ref text default null,
  p_acting_access_user_id uuid default null,
  p_request_id uuid default null,
  p_correlation_id uuid default null
)
returns table (
  mapping_id uuid,
  decision_version integer,
  action_code text,
  changed boolean,
  audit_event_id uuid
)
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_existing public.access_party_mappings%rowtype;
  v_row public.access_party_mappings%rowtype;
  v_hist public.access_party_mapping_history%rowtype;
  v_version integer;
  v_action text;
  v_event_id uuid;
  v_actor_kind text;
  v_surface text;
  v_key text;
begin
  if not private.economic_identity_operator_authority() then
    raise exception 'SHR194_MAPPING_WRITE_FORBIDDEN' using errcode = '42501';
  end if;

  -- A new decision must never ride the SHR-193 restore boundary. That path
  -- exists to re-import a decision that already happened, with its original
  -- timestamp and possibly an archived party; a decision being made now has no
  -- business reaching it.
  if nullif(pg_catalog.current_setting('shr193.restore_mapping_id', true), '') is not null then
    raise exception 'SHR194_RESTORE_TOKEN_SET_ON_ORDINARY_DECISION' using errcode = '55000';
  end if;

  if p_household_id is null or p_auth_user_id is null then
    raise exception 'SHR194_MAPPING_SUBJECT_REQUIRED' using errcode = '22023';
  end if;
  -- unreviewed is the absence of a decision, so it is not something this
  -- function can be asked to decide. 047 refuses the regression anyway.
  if p_status is null or p_status not in ('mapped', 'access_only') then
    raise exception 'SHR194_MAPPING_STATUS_NOT_ALLOWED' using errcode = '22023';
  end if;
  if p_status = 'mapped' and p_economic_party_id is null then
    raise exception 'SHR194_MAPPING_REQUIRES_PARTY' using errcode = '22023';
  end if;
  if p_status = 'access_only' and p_economic_party_id is not null then
    raise exception 'SHR194_ACCESS_ONLY_FORBIDS_PARTY' using errcode = '22023';
  end if;
  if p_decision_evidence_ref is not null and btrim(p_decision_evidence_ref) = '' then
    raise exception 'SHR194_MAPPING_EVIDENCE_REF_INVALID' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      p_household_id::text || ':' || p_auth_user_id::text, 194)
  );

  select m.* into v_existing
    from public.access_party_mappings m
   where m.household_id = p_household_id
     and m.auth_user_id = p_auth_user_id
   for update;

  if found
     and v_existing.status = p_status
     and v_existing.economic_party_id is not distinct from p_economic_party_id then
    return query
      select v_existing.mapping_id,
             coalesce((select pg_catalog.max(h.decision_version)
                         from public.access_party_mapping_history h
                        where h.mapping_id = v_existing.mapping_id), 0),
             'economic.access_party_mapping.unchanged'::text,
             false,
             null::uuid;
    return;
  end if;

  if not found then
    v_action := 'economic.access_party_mapping.created';
    insert into public.access_party_mappings (
      household_id, auth_user_id, economic_party_id, status,
      decided_by_access_user_id, decision_evidence_ref
    ) values (
      p_household_id, p_auth_user_id, p_economic_party_id, p_status,
      p_acting_access_user_id, btrim(p_decision_evidence_ref)
    ) returning * into v_row;
    v_version := 1;
  else
    v_action := case
      when v_existing.status = 'mapped' and p_status = 'access_only'
        then 'economic.access_party_mapping.deactivated'
      else 'economic.access_party_mapping.changed'
    end;
    update public.access_party_mappings m
       set status = p_status,
           economic_party_id = p_economic_party_id,
           decided_by_access_user_id = p_acting_access_user_id,
           decision_evidence_ref = btrim(p_decision_evidence_ref)
     where m.mapping_id = v_existing.mapping_id
     returning * into v_row;

    select coalesce(pg_catalog.max(h.decision_version), 0) + 1 into v_version
      from public.access_party_mapping_history h
     where h.mapping_id = v_row.mapping_id;
  end if;

  insert into public.access_party_mapping_history (
    mapping_id, household_id, auth_user_id, decision_version, action_code,
    previous_status, new_status,
    previous_economic_party_id, new_economic_party_id,
    decided_at, decided_by_access_user_id, decision_evidence_ref
  ) values (
    v_row.mapping_id, v_row.household_id, v_row.auth_user_id, v_version, v_action,
    case when v_action = 'economic.access_party_mapping.created'
         then null else v_existing.status end,
    v_row.status,
    case when v_action = 'economic.access_party_mapping.created'
         then null else v_existing.economic_party_id end,
    v_row.economic_party_id,
    v_row.decided_at, p_acting_access_user_id, v_row.decision_evidence_ref
  ) returning * into v_hist;

  -- Derived from the decision itself, so a retry of the same decision version
  -- replays the same audit event instead of appending a second one.
  v_key := 'sha256:' || pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        v_row.mapping_id::text || ':' || v_version::text, 'UTF8'),
      'sha256'),
    'hex');

  if p_acting_access_user_id is not null then
    v_actor_kind := 'authenticated_user';
    v_surface := 'operator_api';
  else
    v_actor_kind := 'system';
    v_surface := 'migration';
  end if;

  select a.event_id into v_event_id
  from private.append_audit_event_v1(
    v_actor_kind,
    case when v_actor_kind = 'authenticated_user' then p_acting_access_user_id end,
    null,
    null,
    case when v_actor_kind = 'system' then 'shr194.access_party_reconciliation' end,
    v_surface,
    v_action,
    v_row.mapping_id,
    v_hist.mapping_history_id,
    coalesce(p_request_id,
             (pg_catalog.md5('shr194.request:' || v_hist.mapping_history_id::text))::uuid),
    coalesce(p_correlation_id,
             (pg_catalog.md5('shr194.correlation:' || v_row.mapping_id::text))::uuid),
    null,
    v_key
  ) a;

  return query select v_row.mapping_id, v_version, v_action, true, v_event_id;
end;
$$;

comment on function private.set_access_party_mapping_v1(uuid, uuid, text, uuid, text, uuid, uuid, uuid) is
  'SHR-194 ordinary mapping lifecycle writer: create, change and deactivate. Operator authority, invoker-mode, executable by no API role. Every decision is an ordinary INSERT/UPDATE so 047 authors the decision timestamp; the SHR-193 restore path is never called and its token being set is a hard refusal. Applying a decision already exactly in force is an explicit no-op with no history row and no audit event.';

create or replace function private.deactivate_access_party_mapping_v1(
  p_household_id uuid,
  p_auth_user_id uuid,
  p_decision_evidence_ref text default null,
  p_acting_access_user_id uuid default null
)
returns table (
  mapping_id uuid,
  decision_version integer,
  action_code text,
  changed boolean,
  audit_event_id uuid
)
language sql
volatile
security invoker
set search_path = ''
as $$
  select * from private.set_access_party_mapping_v1(
    p_household_id, p_auth_user_id, 'access_only', null,
    p_decision_evidence_ref, p_acting_access_user_id, null, null)
$$;

comment on function private.deactivate_access_party_mapping_v1(uuid, uuid, text, uuid) is
  'SHR-194 mapping deactivation, which is what "archive" means for a mapping in the SHR-193 schema: the economic link is withdrawn by moving the decision to access_only. Household authorization is untouched, the mapping row and its whole history survive, and the withdrawal is itself an audited decision. No mapping is ever deleted and no archived_at column is invented.';

create or replace function private.current_access_party_mapping_v1(
  p_household_id uuid,
  p_auth_user_id uuid
)
returns public.access_party_mappings
language sql
stable
security invoker
set search_path = ''
as $$
  select m.* from public.access_party_mappings m
   where m.household_id = p_household_id
     and m.auth_user_id = p_auth_user_id
$$;

comment on function private.current_access_party_mapping_v1(uuid, uuid) is
  'SHR-194 current mapping retrieval for the operator lifecycle. Read-only. Household members read the same state through public.access_scope_context_v1().';

-- ── 9. The evidence-gated reconciliation path ────────────────────────────
--
-- One transactional entry point for applying an approved manifest. Every fact
-- it acts on is supplied explicitly and checked against proven evidence; it
-- infers nothing whatsoever. In particular it never looks at a display name, an
-- email address, a Telegram sender id, a transaction, an account, a category, a
-- goal or any historical percentage to decide who anybody is.
--
-- Order is the safety property. The manifest replay check and the entire
-- preflight comparison happen before the first write, so a stale count, a
-- changed roster or an unexpected economic state aborts with nothing applied.
-- Everything after that point is a single transaction, so partial application
-- is not representable: either the household, every approved party, every
-- approved decision, all their history rows, all their audit events and the run
-- record all commit, or none of them do.
--
--   p_parties   jsonb array of {party_key, display_name, legacy_owner_label?}
--   p_decisions jsonb array of {auth_user_id, status, party_key?, evidence_ref?}
--
-- party_key is a manifest-local label used only to join a decision to a party
-- being created in the same call. It is never stored, and it is never an
-- economic-party identity — the generated UUID is.

create or replace function private.reconcile_access_parties_v1(
  p_manifest_ref text,
  p_expected_access_member_count integer,
  p_expected_access_roster_digest text,
  p_expected_economic_household_count integer,
  p_expected_economic_party_count integer,
  p_expected_mapping_count integer,
  p_household_display_name text,
  p_parties jsonb,
  p_decisions jsonb,
  p_acting_access_user_id uuid default null
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_pre record;
  v_existing_run public.access_party_reconciliation_runs%rowtype;
  v_manifest_digest text;
  v_household_id uuid;
  v_party_ids jsonb := '{}'::jsonb;
  v_party jsonb;
  v_decision jsonb;
  v_party_key text;
  v_status text;
  v_auth_user_id uuid;
  v_party_id uuid;
  v_decision_users uuid[] := '{}'::uuid[];
  v_roster_users uuid[];
  v_result jsonb := '[]'::jsonb;
  v_written record;
begin
  if not private.economic_identity_operator_authority() then
    raise exception 'SHR194_RECONCILE_FORBIDDEN' using errcode = '42501';
  end if;
  if p_manifest_ref is null or btrim(p_manifest_ref) = '' then
    raise exception 'SHR194_MANIFEST_REF_REQUIRED' using errcode = '22023';
  end if;
  if p_household_display_name is null or btrim(p_household_display_name) = '' then
    raise exception 'SHR194_MANIFEST_HOUSEHOLD_NAME_REQUIRED' using errcode = '22023';
  end if;
  if p_parties is null or jsonb_typeof(p_parties) <> 'array'
     or p_decisions is null or jsonb_typeof(p_decisions) <> 'array' then
    raise exception 'SHR194_MANIFEST_SHAPE_INVALID' using errcode = '22023';
  end if;
  if p_expected_access_member_count is null
     or p_expected_access_roster_digest is null
     or p_expected_economic_household_count is null
     or p_expected_economic_party_count is null
     or p_expected_mapping_count is null then
    raise exception 'SHR194_PREFLIGHT_EXPECTATIONS_REQUIRED' using errcode = '22023';
  end if;

  v_manifest_digest := 'sha256:' || pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        btrim(p_manifest_ref) || pg_catalog.chr(10)
        || btrim(p_household_display_name) || pg_catalog.chr(10)
        || p_parties::text || pg_catalog.chr(10)
        || p_decisions::text,
        'UTF8'),
      'sha256'),
    'hex');

  -- Replay before anything else: an already-applied manifest performs no DML at
  -- all, and the same reference carrying different content is a hard conflict
  -- rather than a second, silently different application.
  select r.* into v_existing_run
    from public.access_party_reconciliation_runs r
   where r.manifest_ref = btrim(p_manifest_ref);
  if found then
    if v_existing_run.manifest_digest <> v_manifest_digest then
      raise exception 'SHR194_MANIFEST_CONFLICT' using errcode = '23505';
    end if;
    return jsonb_build_object(
      'replayed', true,
      'run_id', v_existing_run.run_id,
      'manifest_ref', v_existing_run.manifest_ref,
      'economic_household_id', v_existing_run.economic_household_id,
      'party_count', v_existing_run.party_count,
      'decision_count', v_existing_run.decision_count,
      'decisions', '[]'::jsonb
    );
  end if;

  -- ── Preflight. Nothing below this block has written anything yet. ──
  select * into v_pre from private.access_party_preflight_v1();

  if v_pre.access_member_count <> p_expected_access_member_count then
    raise exception
      'SHR194_PREFLIGHT_ACCESS_COUNT_STALE: manifest approved against % access identities, database has %',
      p_expected_access_member_count, v_pre.access_member_count
      using errcode = '55000';
  end if;
  if v_pre.access_roster_digest <> p_expected_access_roster_digest then
    raise exception
      'SHR194_PREFLIGHT_ROSTER_STALE: access roster evidence has changed since the manifest was approved'
      using errcode = '55000';
  end if;
  if v_pre.economic_household_count <> p_expected_economic_household_count
     or v_pre.economic_party_count <> p_expected_economic_party_count
     or v_pre.mapping_count <> p_expected_mapping_count then
    raise exception
      'SHR194_PREFLIGHT_ECONOMIC_STATE_STALE: expected %/%/% economic households/parties/mappings, database has %/%/%',
      p_expected_economic_household_count, p_expected_economic_party_count,
      p_expected_mapping_count,
      v_pre.economic_household_count, v_pre.economic_party_count, v_pre.mapping_count
      using errcode = '55000';
  end if;

  -- Every access identity in the roster must receive an explicit decision, and
  -- no decision may name an identity that is not in it. That is what makes the
  -- approved manifest exhaustive: nobody is silently left unreviewed, and
  -- nobody is reconciled who is not actually an access identity.
  select pg_catalog.array_agg(hm.user_id order by hm.user_id)
    into v_roster_users
    from public.household_members hm;
  v_roster_users := coalesce(v_roster_users, '{}'::uuid[]);

  for v_decision in select * from jsonb_array_elements(p_decisions) loop
    if v_decision ->> 'auth_user_id' is null then
      raise exception 'SHR194_MANIFEST_DECISION_REQUIRES_IDENTITY' using errcode = '22023';
    end if;
    v_decision_users := v_decision_users || (v_decision ->> 'auth_user_id')::uuid;
  end loop;

  select pg_catalog.array_agg(u order by u) into v_decision_users
    from unnest(v_decision_users) u;
  v_decision_users := coalesce(v_decision_users, '{}'::uuid[]);

  if pg_catalog.array_length(v_decision_users, 1) is distinct from
     pg_catalog.array_length(coalesce(v_roster_users, '{}'::uuid[]), 1)
     or v_decision_users <> v_roster_users then
    raise exception
      'SHR194_MANIFEST_DECISIONS_DO_NOT_COVER_ROSTER: every current access identity needs exactly one explicit decision'
      using errcode = '22023';
  end if;

  -- ── Applying. From here on it is one transaction or nothing. ──
  insert into public.economic_households (display_name)
  values (btrim(p_household_display_name))
  returning household_id into v_household_id;

  for v_party in select * from jsonb_array_elements(p_parties) loop
    v_party_key := v_party ->> 'party_key';
    if v_party_key is null or btrim(v_party_key) = '' then
      raise exception 'SHR194_MANIFEST_PARTY_REQUIRES_KEY' using errcode = '22023';
    end if;
    if v_party_ids ? v_party_key then
      raise exception 'SHR194_MANIFEST_DUPLICATE_PARTY_KEY: %', v_party_key
        using errcode = '22023';
    end if;
    v_party_id := (private.create_economic_party_v1(
      v_household_id,
      v_party ->> 'display_name',
      v_party ->> 'legacy_owner_label')).party_id;
    v_party_ids := v_party_ids || jsonb_build_object(v_party_key, v_party_id);
  end loop;

  for v_decision in select * from jsonb_array_elements(p_decisions) loop
    v_auth_user_id := (v_decision ->> 'auth_user_id')::uuid;
    v_status := v_decision ->> 'status';
    v_party_key := v_decision ->> 'party_key';

    if v_status not in ('mapped', 'access_only') then
      raise exception 'SHR194_MANIFEST_DECISION_STATUS_NOT_ALLOWED: %', v_status
        using errcode = '22023';
    end if;
    if v_status = 'mapped' then
      if v_party_key is null or not (v_party_ids ? v_party_key) then
        raise exception 'SHR194_MANIFEST_DECISION_PARTY_UNKNOWN: %', coalesce(v_party_key, '<null>')
          using errcode = '22023';
      end if;
      v_party_id := (v_party_ids ->> v_party_key)::uuid;
    else
      if v_party_key is not null then
        raise exception 'SHR194_MANIFEST_ACCESS_ONLY_FORBIDS_PARTY' using errcode = '22023';
      end if;
      v_party_id := null;
    end if;

    select * into v_written from private.set_access_party_mapping_v1(
      v_household_id,
      v_auth_user_id,
      v_status,
      v_party_id,
      coalesce(v_decision ->> 'evidence_ref', btrim(p_manifest_ref)),
      p_acting_access_user_id,
      null,
      null
    );

    v_result := v_result || jsonb_build_object(
      'auth_user_id', v_auth_user_id,
      'status', v_status,
      'mapping_id', v_written.mapping_id,
      'decision_version', v_written.decision_version,
      'action_code', v_written.action_code,
      'audit_event_id', v_written.audit_event_id
    );
  end loop;

  insert into public.access_party_reconciliation_runs (
    manifest_ref, manifest_digest, access_roster_digest, access_member_count,
    economic_household_id, party_count, decision_count, applied_by_access_user_id
  ) values (
    btrim(p_manifest_ref), v_manifest_digest, v_pre.access_roster_digest,
    v_pre.access_member_count, v_household_id,
    jsonb_array_length(p_parties), jsonb_array_length(p_decisions),
    p_acting_access_user_id
  );

  return jsonb_build_object(
    'replayed', false,
    'manifest_ref', btrim(p_manifest_ref),
    'economic_household_id', v_household_id,
    'party_count', jsonb_array_length(p_parties),
    'decision_count', jsonb_array_length(p_decisions),
    'decisions', v_result
  );
end;
$$;

comment on function private.reconcile_access_parties_v1(
  text, integer, text, integer, integer, integer, text, jsonb, jsonb, uuid) is
  'SHR-194 transactional, evidence-gated reconciliation of an approved manifest. Operator authority, executable by no API role. Preflight and manifest-replay checks complete before the first write, so stale counts or stale identity evidence abort with zero DML; application is one transaction, so partial application is not representable. Nothing is inferred: every party and every decision is explicit, and no name, email, Telegram id, account, transaction or historical percentage is consulted.';

-- ── 10. Context API ──────────────────────────────────────────────────────
--
-- The narrow read a later consumer needs in order to know who the authenticated
-- caller is economically and which scopes it may legitimately offer them. It is
-- deliberately not a financial aggregation engine: it returns no amount, no
-- balance, no transaction and no allocation, and it computes no share, weight,
-- percentage or ratio of any kind.
--
-- The four states it must keep distinct, and does:
--
--   mapped       the caller represents a specific economic party
--   access_only  the caller is legitimately authorized and is deliberately not
--                an economic party — the state the test access identity holds
--   unreviewed   a decision exists as a placeholder but has not been made
--   unmapped     no decision row exists for this caller at all
--
-- Scope options always lead with the whole-household scope, which is the "Both"
-- semantic: whole-household truth counted once, never the sum of personal
-- scopes and never a shared fact duplicated into each of them. Personal scopes
-- are the household's active economic parties and nothing else. There is no
-- percentage anywhere in the contract, and specifically no 69/31.
--
-- "Me" and "Partner" are returned as presentation codes computed here, exactly
-- as SHR-193 intended: Partner appears only when precisely one other active
-- party exists. Neither is stored, and neither is a role.
--
-- Cross-household containment is structural rather than an added policy: the
-- caller's own mapping decision is what names their economic household, so a
-- caller can only ever be given the household a reviewed decision placed them
-- in. Naming any other household returns forbidden, whether or not it exists.

create or replace function public.access_scope_context_v1(
  p_economic_household_id uuid default null
)
returns table (
  access_user_id uuid,
  access_state text,
  is_economic_party boolean,
  economic_party_id uuid,
  economic_party_display_name text,
  economic_household_id uuid,
  economic_household_display_name text,
  active_party_count integer,
  scope_options jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_map public.access_party_mappings%rowtype;
  v_mapping_count integer;
  v_household public.economic_households%rowtype;
  v_party public.economic_parties%rowtype;
  v_active_count integer := 0;
  v_options jsonb := '[]'::jsonb;
  v_state text;
begin
  if v_uid is null or not private.is_household_member() then
    raise exception 'ACCESS_SCOPE_CONTEXT_FORBIDDEN' using errcode = '42501';
  end if;

  if p_economic_household_id is null then
    select pg_catalog.count(*)::integer into v_mapping_count
      from public.access_party_mappings m
     where m.auth_user_id = v_uid;
    -- Fail closed rather than pick one: which household a caller means is not
    -- something this function may guess.
    if v_mapping_count > 1 then
      raise exception 'ACCESS_SCOPE_CONTEXT_HOUSEHOLD_AMBIGUOUS' using errcode = '22023';
    end if;
    select m.* into v_map
      from public.access_party_mappings m
     where m.auth_user_id = v_uid;
  else
    select m.* into v_map
      from public.access_party_mappings m
     where m.auth_user_id = v_uid
       and m.household_id = p_economic_household_id;
    -- A household the caller holds no decision in is not theirs to read,
    -- whether or not it exists.
    if not found then
      raise exception 'ACCESS_SCOPE_CONTEXT_FORBIDDEN' using errcode = '42501';
    end if;
  end if;

  if v_map.mapping_id is null then
    return query select
      v_uid, 'unmapped'::text, false,
      null::uuid, null::text, null::uuid, null::text,
      0, '[]'::jsonb;
    return;
  end if;

  v_state := v_map.status;

  select h.* into v_household
    from public.economic_households h
   where h.household_id = v_map.household_id;

  if v_map.economic_party_id is not null then
    select p.* into v_party
      from public.economic_parties p
     where p.party_id = v_map.economic_party_id;
  end if;

  select pg_catalog.count(*)::integer into v_active_count
    from public.economic_parties p
   where p.household_id = v_map.household_id
     and p.archived_at is null;

  -- The whole-household scope, counted once.
  v_options := v_options || jsonb_build_object(
    'scope_kind', 'household',
    'scope_code', 'both',
    'economic_household_id', v_household.household_id,
    'display_name', v_household.display_name,
    'counted_once', true
  );

  -- Personal scopes: the household's active economic parties. An archived party
  -- stays resolvable for historical reads but is never offered as a new choice.
  v_options := v_options || coalesce(
    (select jsonb_agg(
       jsonb_build_object(
         'scope_kind', 'party',
         'scope_code', 'party',
         'economic_party_id', p.party_id,
         'display_name', p.display_name,
         -- Never NULL: an access_only or unreviewed caller owns no party, and
         -- "is this me?" is then a definite no rather than an unknown.
         'is_self', p.party_id is not distinct from v_map.economic_party_id,
         'presentation_code',
           case
             when p.party_id = v_map.economic_party_id then 'me'
             when v_map.economic_party_id is not null and v_active_count = 2 then 'partner'
             else null
           end)
       order by p.display_name, p.party_id)
       from public.economic_parties p
      where p.household_id = v_map.household_id
        and p.archived_at is null),
    '[]'::jsonb);

  return query select
    v_uid,
    v_state,
    v_map.economic_party_id is not null,
    v_map.economic_party_id,
    v_party.display_name,
    v_household.household_id,
    v_household.display_name,
    v_active_count,
    v_options;
end;
$$;

comment on function public.access_scope_context_v1(uuid) is
  'SHR-194 current-access and scope-options context for the authenticated caller. Authorization is the existing private.is_household_member() root and nothing else; economic identity grants no access. It distinguishes mapped, access_only, unreviewed and unmapped callers, returns the whole-household ("Both") scope counted once plus the active economic parties, and computes Me/Partner as presentation only. It exposes no email, no Telegram identity, no amount and no allocation share, and a caller can only ever see the economic household their own reviewed decision placed them in.';

-- ── 11. RLS and least-privilege ACLs ─────────────────────────────────────
--
-- Authorization is unchanged, and that is the load-bearing claim of this whole
-- package. private.is_household_member() remains the only predicate; no policy
-- on any existing table — financial or otherwise — is created, dropped or
-- altered here; no role is created; and economic identity still appears in no
-- authorization predicate anywhere. A mapping decision grants nothing, and
-- neither does a mapping history row.
--
-- Write capability is granted to no API role on any object in this package.
-- Every writer lives in private, is invoker-mode, checks the operator authority
-- itself, and is executable by nobody but the migration/operator authority — so
-- a browser session or an Edge Function cannot reach a mapping decision even if
-- a policy were misconfigured, because Postgres refuses the command before RLS
-- is consulted.

alter table public.access_party_mapping_history enable row level security;
alter table public.access_party_reconciliation_runs enable row level security;

-- Mapping history is household-readable on exactly the same terms as the
-- mapping decisions it describes: it holds the same class of information, and
-- 047 already grants members SELECT on public.access_party_mappings.
drop policy if exists "household read access party mapping history"
  on public.access_party_mapping_history;
create policy "household read access party mapping history"
  on public.access_party_mapping_history
  for select to authenticated
  using ((select private.is_household_member()));

-- Run records are operator/release evidence rather than household record: they
-- carry roster digests and manifest references and answer no product question.
-- They follow the audit_events pattern instead — no API read at all, and the
-- raw read the encrypted backup exporter needs.
drop policy if exists "reconciliation runs deny raw api access"
  on public.access_party_reconciliation_runs;
create policy "reconciliation runs deny raw api access"
  on public.access_party_reconciliation_runs
  for all to anon, authenticated
  using (false)
  with check (false);

-- Supabase's platform grants on public tables are broad and must not be
-- inherited. Revoke everything first, then grant only what is actually needed.
revoke all on table public.access_party_mapping_history
  from public, anon, authenticated, service_role;
revoke all on table public.access_party_reconciliation_runs
  from public, anon, authenticated, service_role;

grant select on table public.access_party_mapping_history to authenticated, service_role;
grant select on table public.access_party_reconciliation_runs to service_role;

-- Trigger functions are fired by the trigger machinery, which does not consult
-- EXECUTE, so revoking it everywhere leaves the guards working while making
-- them uncallable. Every SHR-194 writer, preflight and roster function is
-- revoked for the same least-privilege reason: the operator reaches them
-- through the database owner, and no API role has any business calling them.
-- The roster function in particular returns email evidence and must never be
-- reachable from a browser.
revoke all on function
  private.reject_access_party_evidence_mutation(),
  private.reject_access_party_evidence_truncate(),
  private.access_roster_digest_v1(),
  private.access_party_preflight_v1(),
  private.access_party_roster_v1(),
  private.create_economic_party_v1(uuid, text, text),
  private.set_access_party_mapping_v1(uuid, uuid, text, uuid, text, uuid, uuid, uuid),
  private.deactivate_access_party_mapping_v1(uuid, uuid, text, uuid),
  private.current_access_party_mapping_v1(uuid, uuid),
  private.reconcile_access_parties_v1(
    text, integer, text, integer, integer, integer, text, jsonb, jsonb, uuid)
  from public, anon, authenticated, service_role;

-- Re-asserted because 048 replaced the function body: replacing a function does
-- not reset its ACL, but stating it here keeps the exact intended grant visible
-- in one place and keeps a re-run of this file idempotent against a hand-edited
-- privilege.
revoke all on function
  private.append_audit_event_v1(
    text, uuid, text, text, text, text, text, uuid, uuid, uuid, uuid, uuid, text)
  from public, anon, authenticated, service_role;

-- The context API is the one product-facing surface this package adds, and it
-- is a read. Authenticated household members only; anon and service_role get
-- nothing.
revoke all on function public.access_scope_context_v1(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.access_scope_context_v1(uuid) to authenticated;

revoke all on function public.audit_history_v1(text, uuid, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.audit_history_v1(text, uuid, integer) to authenticated;

commit;

-- Rollback is route-level, exactly as for 045, 046 and 047: stop the context
-- consumers and retain every object and every row. Never roll back by deleting
-- a mapping decision, its history or its audit evidence — the decision is the
-- reviewed record of who an access identity economically is, and the database
-- refuses to destroy it rather than relying on convention. Withdrawing an
-- economic mapping is a forward action: deactivate it, which is itself audited
-- and preserves everything that came before.
