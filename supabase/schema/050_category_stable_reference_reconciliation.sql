-- 050_category_stable_reference_reconciliation.sql — SHR-197
--
-- Additive stable category references and an evidence-gated reconciliation
-- capability. Applying this migration is inert: it assigns no system code,
-- populates no category_id, and changes no V1 consumer. A later release may
-- call the private reconciliation function only with an independently reviewed
-- manifest that names exact category UUIDs and is bound to an exact preflight.

begin;

-- ── 1. Nullable stable references ─────────────────────────────────────────

alter table public.transactions add column if not exists category_id uuid;
alter table public.category_rules add column if not exists category_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conname = 'transactions_category_id_fkey'
      and conrelid = 'public.transactions'::regclass
  ) then
    alter table public.transactions
      add constraint transactions_category_id_fkey
      foreign key (category_id) references public.categories(id) on delete restrict;
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conname = 'category_rules_category_id_fkey'
      and conrelid = 'public.category_rules'::regclass
  ) then
    alter table public.category_rules
      add constraint category_rules_category_id_fkey
      foreign key (category_id) references public.categories(id) on delete restrict;
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conname = 'transactions_category_id_requires_text'
      and conrelid = 'public.transactions'::regclass
  ) then
    alter table public.transactions
      add constraint transactions_category_id_requires_text
      check (category_id is null or category is not null);
  end if;
end $$;

create index if not exists transactions_category_id_idx
  on public.transactions (category_id) where category_id is not null;
create index if not exists category_rules_category_id_idx
  on public.category_rules (category_id) where category_id is not null;

comment on column public.transactions.category_id is
  'SHR-197 nullable stable identity for the row''s current category classification when evidence-resolved. Legacy category text remains unchanged and V1-authoritative until SHR-198; NULL means unresolved/uncategorized and is never coerced to Other.';
comment on column public.category_rules.category_id is
  'SHR-197 nullable stable identity for the rule''s current target when evidence-resolved. Legacy target text and all V1 rule behaviour remain unchanged; precedence/lifecycle belong to SHR-160.';

-- ── 2. Durable reconciliation evidence ───────────────────────────────────

create table if not exists public.category_reconciliation_runs (
  run_id uuid primary key default gen_random_uuid(),
  manifest_ref text not null,
  manifest_digest text not null,
  source_state_digest text not null,
  classification_digest_before text not null,
  classification_digest_after text not null,
  preflight_snapshot jsonb not null,
  category_count integer not null,
  transaction_count integer not null,
  active_transaction_count integer not null,
  soft_deleted_transaction_count integer not null,
  null_transaction_category_count integer not null,
  category_rule_count integer not null,
  distinct_legacy_label_count integer not null,
  unknown_label_count integer not null,
  ambiguous_label_count integer not null,
  system_assignment_count integer not null,
  resolved_transaction_count integer not null,
  unresolved_transaction_count integer not null,
  resolved_category_rule_count integer not null,
  unresolved_category_rule_count integer not null,
  applied_at timestamptz not null default now(),
  applied_by_access_user_id uuid,
  schema_version smallint not null default 1,

  constraint category_reconciliation_runs_manifest_key unique (manifest_ref),
  constraint category_reconciliation_runs_manifest_ref_check
    check (manifest_ref <> '' and manifest_ref = btrim(manifest_ref)),
  constraint category_reconciliation_runs_manifest_digest_check
    check (manifest_digest ~ '^sha256:[0-9a-f]{64}$'),
  constraint category_reconciliation_runs_source_digest_check
    check (source_state_digest ~ '^sha256:[0-9a-f]{64}$'),
  constraint category_reconciliation_runs_classification_digest_check
    check (classification_digest_before ~ '^sha256:[0-9a-f]{64}$'
      and classification_digest_after = classification_digest_before),
  constraint category_reconciliation_runs_counts_check check (
    category_count >= 0 and transaction_count >= 0
    and active_transaction_count >= 0 and soft_deleted_transaction_count >= 0
    and null_transaction_category_count >= 0 and category_rule_count >= 0
    and distinct_legacy_label_count >= 0 and unknown_label_count >= 0
    and ambiguous_label_count = 0 and system_assignment_count = 2
    and resolved_transaction_count >= 0 and unresolved_transaction_count >= 0
    and resolved_category_rule_count >= 0 and unresolved_category_rule_count >= 0
    and active_transaction_count + soft_deleted_transaction_count = transaction_count
    and resolved_transaction_count + unresolved_transaction_count
          + null_transaction_category_count = transaction_count
    and resolved_category_rule_count + unresolved_category_rule_count = category_rule_count
  ),
  constraint category_reconciliation_runs_snapshot_check
    check (jsonb_typeof(preflight_snapshot) = 'object'),
  constraint category_reconciliation_runs_metadata_check check (schema_version = 1)
);

create table if not exists public.category_reconciliation_system_entries (
  run_id uuid not null references public.category_reconciliation_runs(run_id) on delete restrict,
  entry_index integer not null check (entry_index >= 1),
  system_code text not null check (system_code in ('transfer', 'savings_investment')),
  category_id uuid not null references public.categories(id) on delete restrict,
  category_name text not null,
  category_archived_at timestamptz,
  previous_system_code text,
  assigned boolean not null,
  recorded_at timestamptz not null default now(),
  schema_version smallint not null default 1 check (schema_version = 1),
  primary key (run_id, entry_index),
  unique (run_id, system_code),
  unique (run_id, category_id),
  constraint category_reconciliation_system_active_check
    check (category_archived_at is null),
  constraint category_reconciliation_system_previous_check
    check (previous_system_code is null)
);

create table if not exists public.category_reconciliation_manifest_entries (
  run_id uuid not null references public.category_reconciliation_runs(run_id) on delete restrict,
  entry_index integer not null check (entry_index >= 1),
  legacy_label text not null,
  resolution text not null check (resolution in ('mapped', 'unresolved_unknown')),
  category_id uuid references public.categories(id) on delete restrict,
  candidate_category_count integer not null check (candidate_category_count >= 0),
  active_transaction_count integer not null check (active_transaction_count >= 0),
  soft_deleted_transaction_count integer not null check (soft_deleted_transaction_count >= 0),
  category_rule_count integer not null check (category_rule_count >= 0),
  evidence_ref text,
  recorded_at timestamptz not null default now(),
  schema_version smallint not null default 1 check (schema_version = 1),
  primary key (run_id, entry_index),
  unique (run_id, legacy_label),
  constraint category_reconciliation_manifest_shape_check check (
    (resolution = 'mapped' and category_id is not null and candidate_category_count = 1)
    or (resolution = 'unresolved_unknown' and category_id is null and candidate_category_count = 0)
  ),
  constraint category_reconciliation_manifest_evidence_ref_check check (
    evidence_ref is null or (evidence_ref <> '' and evidence_ref = btrim(evidence_ref))
  )
);

create table if not exists public.category_reconciliation_row_evidence (
  run_id uuid not null references public.category_reconciliation_runs(run_id) on delete restrict,
  subject_kind text not null check (subject_kind in ('transaction', 'category_rule')),
  subject_id uuid not null,
  legacy_label text,
  category_id uuid references public.categories(id) on delete restrict,
  resolution text not null check (
    resolution in ('mapped', 'unresolved_unknown', 'uncategorized_null')
  ),
  transaction_soft_deleted boolean,
  recorded_at timestamptz not null default now(),
  schema_version smallint not null default 1 check (schema_version = 1),
  primary key (run_id, subject_kind, subject_id),
  constraint category_reconciliation_row_shape_check check (
    (subject_kind = 'transaction'
      and transaction_soft_deleted is not null
      and ((legacy_label is null and category_id is null and resolution = 'uncategorized_null')
        or (legacy_label is not null and category_id is not null and resolution = 'mapped')
        or (legacy_label is not null and category_id is null and resolution = 'unresolved_unknown')))
    or
    (subject_kind = 'category_rule'
      and transaction_soft_deleted is null
      and legacy_label is not null
      and ((category_id is not null and resolution = 'mapped')
        or (category_id is null and resolution = 'unresolved_unknown')))
  )
);

create table if not exists public.category_reconciliation_replay_evidence (
  replay_id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.category_reconciliation_runs(run_id) on delete restrict,
  manifest_ref text not null,
  manifest_digest text not null,
  classification_digest text not null,
  mismatch_count integer not null check (mismatch_count = 0),
  replayed_at timestamptz not null default now(),
  replayed_by_access_user_id uuid,
  schema_version smallint not null default 1 check (schema_version = 1),
  constraint category_reconciliation_replay_manifest_ref_check
    check (manifest_ref <> '' and manifest_ref = btrim(manifest_ref)),
  constraint category_reconciliation_replay_manifest_digest_check
    check (manifest_digest ~ '^sha256:[0-9a-f]{64}$'),
  constraint category_reconciliation_replay_classification_digest_check
    check (classification_digest ~ '^sha256:[0-9a-f]{64}$')
);

comment on table public.category_reconciliation_runs is
  'SHR-197 immutable record of an exact evidence-reviewed reconciliation. Stores the reviewed source snapshot/digest, exact manifest digest, parity digest and aggregate outcome. Unique manifest_ref provides replay/conflict semantics.';
comment on table public.category_reconciliation_system_entries is
  'SHR-197 immutable exact UUID evidence for the two approved system-code assignments. Names are recorded only as reviewed evidence; UUIDs are authoritative.';
comment on table public.category_reconciliation_manifest_entries is
  'SHR-197 immutable exhaustive decision roster for every distinct non-NULL legacy transaction/rule label. No category name join is used to write a reference.';
comment on table public.category_reconciliation_row_evidence is
  'SHR-197 immutable per-row outcome evidence, including active and soft-deleted transactions, NULL uncategorized rows and unresolved unknown labels. Subject IDs are logical references so evidence outlives ordinary row lifecycle.';
comment on table public.category_reconciliation_replay_evidence is
  'SHR-197 immutable evidence that an exact-reference/exact-content replay was accepted as a safe no-op after verifying the original per-row outcomes still match. The original run remains immutable.';

-- ── 3. Guards ─────────────────────────────────────────────────────────────

create or replace function private.reject_category_reconciliation_evidence_mutation()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  raise exception 'SHR197_RECONCILIATION_EVIDENCE_IMMUTABLE' using errcode = '55000';
end;
$$;

create or replace function private.reject_category_reconciliation_evidence_truncate()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  raise exception 'SHR197_RECONCILIATION_EVIDENCE_TRUNCATE_FORBIDDEN' using errcode = '55000';
end;
$$;

do $$
declare v_table text;
begin
  foreach v_table in array array[
    'category_reconciliation_runs',
    'category_reconciliation_system_entries',
    'category_reconciliation_manifest_entries',
    'category_reconciliation_row_evidence',
    'category_reconciliation_replay_evidence'
  ] loop
    execute format('drop trigger if exists %I_immutable on public.%I', v_table, v_table);
    execute format(
      'create trigger %I_immutable before update or delete on public.%I for each row execute function private.reject_category_reconciliation_evidence_mutation()',
      v_table, v_table);
    execute format('drop trigger if exists %I_no_truncate on public.%I', v_table, v_table);
    execute format(
      'create trigger %I_no_truncate before truncate on public.%I for each statement execute function private.reject_category_reconciliation_evidence_truncate()',
      v_table, v_table);
  end loop;
end $$;

-- Existing V1 writers may continue omitting category_id. No API role may
-- fabricate, change or clear a stable identity before SHR-198 defines the
-- compatible writer. The database owner/migration authority remains the same
-- documented administrative trust root as migration 046.
create or replace function private.guard_category_stable_reference()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare
  v_operator boolean := pg_catalog.pg_has_role(
    current_user,
    (select c.relowner from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = 'categories'),
    'USAGE');
begin
  if tg_op = 'INSERT' and new.category_id is not null and not v_operator then
    raise exception 'SHR197_CATEGORY_REFERENCE_WRITE_FORBIDDEN' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and new.category_id is distinct from old.category_id and not v_operator then
    raise exception 'SHR197_CATEGORY_REFERENCE_WRITE_FORBIDDEN' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and old.category_id is not null
     and new.category is distinct from old.category and not v_operator then
    raise exception 'SHR197_RESOLVED_LEGACY_TEXT_WRITE_FORBIDDEN' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists transactions_category_reference_guard on public.transactions;
create trigger transactions_category_reference_guard
before insert or update on public.transactions
for each row execute function private.guard_category_stable_reference();

drop trigger if exists category_rules_category_reference_guard on public.category_rules;
create trigger category_rules_category_reference_guard
before insert or update on public.category_rules
for each row execute function private.guard_category_stable_reference();

-- ── 4. Deterministic read-only evidence ──────────────────────────────────

create or replace function private.category_legacy_label_candidates_v1()
returns table (
  legacy_label text,
  active_transaction_count integer,
  soft_deleted_transaction_count integer,
  category_rule_count integer,
  candidate_category_ids uuid[],
  candidate_category_count integer
)
language sql stable security invoker set search_path = '' as $$
  with labels as (
    select t.category as label from public.transactions t where t.category is not null
    union
    select r.category from public.category_rules r
  ), candidates as (
    select l.label, c.id as category_id
      from labels l join public.categories c on c.name = l.label
    union
    select l.label, a.category_id
      from labels l join public.category_aliases a
        on a.alias_name = l.label and a.state = 'compatibility_active'
  )
  select
    l.label,
    (select count(*)::integer from public.transactions t
      where t.category = l.label and t.deleted_at is null),
    (select count(*)::integer from public.transactions t
      where t.category = l.label and t.deleted_at is not null),
    (select count(*)::integer from public.category_rules r where r.category = l.label),
    coalesce((select array_agg(distinct c.category_id order by c.category_id)
      from candidates c where c.label = l.label), '{}'::uuid[]),
    (select count(distinct c.category_id)::integer from candidates c where c.label = l.label)
  from labels l
  order by l.label
$$;

create or replace function private.category_classification_text_digest_v1()
returns text language sql stable security invoker set search_path = '' as $$
  select 'sha256:' || pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
    jsonb_build_object(
      'transactions', coalesce((select jsonb_agg(jsonb_build_array(t.id, t.category) order by t.id)
        from public.transactions t), '[]'::jsonb),
      'category_rules', coalesce((select jsonb_agg(jsonb_build_array(r.id, r.category) order by r.id)
        from public.category_rules r), '[]'::jsonb)
    )::text, 'UTF8'), 'sha256'), 'hex')
$$;

create or replace function private.category_reconciliation_state_digest_v1()
returns text language sql stable security invoker set search_path = '' as $$
  select 'sha256:' || pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
    jsonb_build_object(
      'categories', coalesce((select jsonb_agg(jsonb_build_array(
          c.id, c.name, c."group", c.icon, c.system_code, c.archived_at, c.created_at, c.updated_at
        ) order by c.id) from public.categories c), '[]'::jsonb),
      'transactions', coalesce((select jsonb_agg(jsonb_build_array(
          t.id, t.category, t.category_id, t.deleted_at
        ) order by t.id) from public.transactions t), '[]'::jsonb),
      'category_rules', coalesce((select jsonb_agg(jsonb_build_array(
          r.id, r.category, r.category_id
        ) order by r.id) from public.category_rules r), '[]'::jsonb),
      'run_count', (select count(*) from public.category_reconciliation_runs)
    )::text, 'UTF8'), 'sha256'), 'hex')
$$;

create or replace function private.category_reconciliation_roster_v1()
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'schema_version', 1,
    'categories', coalesce((select jsonb_agg(jsonb_build_object(
      'category_id', c.id,
      'legacy_name', c.name,
      'system_code', c.system_code,
      'archived_at', c.archived_at,
      'active_transaction_count', (select count(*) from public.transactions t where t.category = c.name and t.deleted_at is null),
      'soft_deleted_transaction_count', (select count(*) from public.transactions t where t.category = c.name and t.deleted_at is not null),
      'category_rule_count', (select count(*) from public.category_rules r where r.category = c.name)
    ) order by c.id) from public.categories c), '[]'::jsonb),
    'legacy_labels', coalesce((select jsonb_agg(jsonb_build_object(
      'legacy_label', x.legacy_label,
      'active_transaction_count', x.active_transaction_count,
      'soft_deleted_transaction_count', x.soft_deleted_transaction_count,
      'category_rule_count', x.category_rule_count,
      'candidate_category_ids', to_jsonb(x.candidate_category_ids),
      'candidate_category_count', x.candidate_category_count,
      'status', case when x.candidate_category_count = 0 then 'unknown'
                     when x.candidate_category_count = 1 then 'unique_candidate'
                     else 'ambiguous' end
    ) order by x.legacy_label) from private.category_legacy_label_candidates_v1() x), '[]'::jsonb),
    'null_transaction_categories', jsonb_build_object(
      'active_count', (select count(*) from public.transactions t where t.category is null and t.deleted_at is null),
      'soft_deleted_count', (select count(*) from public.transactions t where t.category is null and t.deleted_at is not null)
    )
  )
$$;

create or replace function private.category_reconciliation_preflight_v1()
returns table (
  observed_at timestamptz,
  source_state_digest text,
  classification_text_digest text,
  category_count integer,
  active_category_count integer,
  archived_category_count integer,
  assigned_system_code_count integer,
  transaction_count integer,
  active_transaction_count integer,
  soft_deleted_transaction_count integer,
  null_transaction_category_count integer,
  resolved_transaction_count integer,
  category_rule_count integer,
  resolved_category_rule_count integer,
  distinct_legacy_label_count integer,
  unknown_label_count integer,
  ambiguous_label_count integer,
  reconciliation_run_count integer,
  roster jsonb
)
language sql stable security invoker set search_path = '' as $$
  select pg_catalog.now(),
    private.category_reconciliation_state_digest_v1(),
    private.category_classification_text_digest_v1(),
    (select count(*)::integer from public.categories),
    (select count(*)::integer from public.categories where archived_at is null),
    (select count(*)::integer from public.categories where archived_at is not null),
    (select count(*)::integer from public.categories where system_code is not null),
    (select count(*)::integer from public.transactions),
    (select count(*)::integer from public.transactions where deleted_at is null),
    (select count(*)::integer from public.transactions where deleted_at is not null),
    (select count(*)::integer from public.transactions where category is null),
    (select count(*)::integer from public.transactions where category_id is not null),
    (select count(*)::integer from public.category_rules),
    (select count(*)::integer from public.category_rules where category_id is not null),
    (select count(*)::integer from private.category_legacy_label_candidates_v1()),
    (select count(*)::integer from private.category_legacy_label_candidates_v1() where candidate_category_count = 0),
    (select count(*)::integer from private.category_legacy_label_candidates_v1() where candidate_category_count > 1),
    (select count(*)::integer from public.category_reconciliation_runs),
    private.category_reconciliation_roster_v1()
$$;

-- ── 5. Evidence-gated reconciliation ─────────────────────────────────────

create or replace function private.reconcile_category_references_v1(
  p_manifest_ref text,
  p_expected_source_state_digest text,
  p_expected_category_count integer,
  p_expected_transaction_count integer,
  p_expected_category_rule_count integer,
  p_expected_null_transaction_category_count integer,
  p_expected_soft_deleted_transaction_count integer,
  p_expected_distinct_legacy_label_count integer,
  p_expected_unknown_label_count integer,
  p_expected_reconciliation_run_count integer,
  p_system_categories jsonb,
  p_classifications jsonb,
  p_acting_access_user_id uuid default null
)
returns jsonb language plpgsql volatile security invoker set search_path = '' as $$
declare
  v_pre record;
  v_existing public.category_reconciliation_runs%rowtype;
  v_manifest_digest text;
  v_run_id uuid := gen_random_uuid();
  v_entry jsonb;
  v_index integer;
  v_code text;
  v_category_id uuid;
  v_category public.categories%rowtype;
  v_label text;
  v_resolution text;
  v_evidence_ref text;
  v_manifest_labels text[] := '{}'::text[];
  v_current_labels text[];
  v_seen_codes text[] := '{}'::text[];
  v_seen_categories uuid[] := '{}'::uuid[];
  v_candidate record;
  v_resolved_tx integer := 0;
  v_unresolved_tx integer := 0;
  v_resolved_rules integer := 0;
  v_unresolved_rules integer := 0;
  v_after_digest text;
  v_mismatch_count integer;
  v_replay_id uuid;
begin
  if not private.category_operator_authority() then
    raise exception 'SHR197_RECONCILE_FORBIDDEN' using errcode = '42501';
  end if;
  if p_manifest_ref is null or btrim(p_manifest_ref) = '' then
    raise exception 'SHR197_MANIFEST_REF_REQUIRED' using errcode = '22023';
  end if;
  if p_system_categories is null or jsonb_typeof(p_system_categories) <> 'array'
     or p_classifications is null or jsonb_typeof(p_classifications) <> 'array' then
    raise exception 'SHR197_MANIFEST_SHAPE_INVALID' using errcode = '22023';
  end if;
  if p_expected_source_state_digest is null
     or p_expected_category_count is null or p_expected_transaction_count is null
     or p_expected_category_rule_count is null
     or p_expected_null_transaction_category_count is null
     or p_expected_soft_deleted_transaction_count is null
     or p_expected_distinct_legacy_label_count is null
     or p_expected_unknown_label_count is null
     or p_expected_reconciliation_run_count is null then
    raise exception 'SHR197_PREFLIGHT_EXPECTATIONS_REQUIRED' using errcode = '22023';
  end if;

  v_manifest_digest := 'sha256:' || pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
    jsonb_build_object(
      'manifest_ref', btrim(p_manifest_ref),
      'expected_source_state_digest', p_expected_source_state_digest,
      'expected_category_count', p_expected_category_count,
      'expected_transaction_count', p_expected_transaction_count,
      'expected_category_rule_count', p_expected_category_rule_count,
      'expected_null_transaction_category_count', p_expected_null_transaction_category_count,
      'expected_soft_deleted_transaction_count', p_expected_soft_deleted_transaction_count,
      'expected_distinct_legacy_label_count', p_expected_distinct_legacy_label_count,
      'expected_unknown_label_count', p_expected_unknown_label_count,
      'expected_reconciliation_run_count', p_expected_reconciliation_run_count,
      'system_categories', p_system_categories,
      'classifications', p_classifications
    )::text, 'UTF8'), 'sha256'), 'hex');

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('shr197.category_reconciliation.v1', 197));

  select r.* into v_existing from public.category_reconciliation_runs r
    where r.manifest_ref = btrim(p_manifest_ref);
  if found then
    if v_existing.manifest_digest <> v_manifest_digest then
      raise exception 'SHR197_MANIFEST_CONFLICT' using errcode = '23505';
    end if;
    if private.category_classification_text_digest_v1()
       <> v_existing.classification_digest_after then
      raise exception 'SHR197_REPLAY_STATE_MISMATCH' using errcode = '55000';
    end if;
    select count(*)::integer into v_mismatch_count
      from private.category_reconciliation_mismatch_report_v1(v_existing.run_id);
    v_mismatch_count := v_mismatch_count + (
      select count(*)::integer
      from public.category_reconciliation_system_entries e
      left join public.categories c on c.id = e.category_id
      where e.run_id = v_existing.run_id
        and (c.id is null or c.system_code is distinct from e.system_code)
    );
    if v_mismatch_count <> 0 then
      raise exception 'SHR197_REPLAY_STATE_MISMATCH' using errcode = '55000';
    end if;
    insert into public.category_reconciliation_replay_evidence (
      run_id, manifest_ref, manifest_digest, classification_digest,
      mismatch_count, replayed_by_access_user_id
    ) values (
      v_existing.run_id, v_existing.manifest_ref, v_existing.manifest_digest,
      private.category_classification_text_digest_v1(), 0,
      p_acting_access_user_id
    ) returning replay_id into v_replay_id;
    return jsonb_build_object(
      'replayed', true, 'run_id', v_existing.run_id,
      'replay_id', v_replay_id,
      'manifest_ref', v_existing.manifest_ref,
      'resolved_transaction_count', v_existing.resolved_transaction_count,
      'unresolved_transaction_count', v_existing.unresolved_transaction_count,
      'resolved_category_rule_count', v_existing.resolved_category_rule_count,
      'unresolved_category_rule_count', v_existing.unresolved_category_rule_count);
  end if;

  -- Freeze every source table for the rest of this transaction. The exact
  -- digest check and every exhaustive validation below precede the first row
  -- mutation; concurrent V1 writes cannot make approved evidence stale between
  -- the check and application.
  lock table public.categories, public.transactions, public.category_rules
    in share row exclusive mode;

  select * into v_pre from private.category_reconciliation_preflight_v1();
  if v_pre.source_state_digest <> p_expected_source_state_digest then
    raise exception 'SHR197_PREFLIGHT_DIGEST_STALE' using errcode = '55000';
  end if;
  if v_pre.category_count <> p_expected_category_count
     or v_pre.transaction_count <> p_expected_transaction_count
     or v_pre.category_rule_count <> p_expected_category_rule_count
     or v_pre.null_transaction_category_count <> p_expected_null_transaction_category_count
     or v_pre.soft_deleted_transaction_count <> p_expected_soft_deleted_transaction_count
     or v_pre.distinct_legacy_label_count <> p_expected_distinct_legacy_label_count
     or v_pre.unknown_label_count <> p_expected_unknown_label_count
     or v_pre.reconciliation_run_count <> p_expected_reconciliation_run_count then
    raise exception 'SHR197_PREFLIGHT_COUNTS_STALE' using errcode = '55000';
  end if;
  if v_pre.ambiguous_label_count <> 0 then
    raise exception 'SHR197_PREFLIGHT_AMBIGUOUS_LABELS' using errcode = '55000';
  end if;
  if v_pre.assigned_system_code_count <> 0
     or v_pre.resolved_transaction_count <> 0
     or v_pre.resolved_category_rule_count <> 0 then
    raise exception 'SHR197_PREFLIGHT_ALREADY_POPULATED' using errcode = '55000';
  end if;

  -- Exactly the two approved codes, each on a different explicit UUID.
  if jsonb_array_length(p_system_categories) <> 2 then
    raise exception 'SHR197_SYSTEM_MANIFEST_MUST_CONTAIN_EXACTLY_TWO' using errcode = '22023';
  end if;
  v_index := 0;
  for v_entry in select value from jsonb_array_elements(p_system_categories) loop
    v_index := v_index + 1;
    v_code := v_entry ->> 'system_code';
    if v_code is null or v_code not in ('transfer', 'savings_investment') then
      raise exception 'SHR197_SYSTEM_CODE_NOT_ALLOWED: %', coalesce(v_code, '<null>') using errcode = '22023';
    end if;
    if v_code = any(v_seen_codes) then
      raise exception 'SHR197_SYSTEM_CODE_DUPLICATE: %', v_code using errcode = '22023';
    end if;
    if v_entry ->> 'category_id' is null then
      raise exception 'SHR197_SYSTEM_CATEGORY_UUID_REQUIRED: %', v_code using errcode = '22023';
    end if;
    v_category_id := (v_entry ->> 'category_id')::uuid;
    if v_category_id = any(v_seen_categories) then
      raise exception 'SHR197_SYSTEM_CATEGORY_UUID_DUPLICATE: %', v_category_id using errcode = '22023';
    end if;
    select c.* into v_category from public.categories c where c.id = v_category_id;
    if not found then
      raise exception 'SHR197_SYSTEM_CATEGORY_UNKNOWN: %', v_category_id using errcode = '23503';
    end if;
    if v_category.archived_at is not null then
      raise exception 'SHR197_SYSTEM_CATEGORY_ARCHIVED: %', v_category_id using errcode = '55000';
    end if;
    if v_category.system_code is not null then
      raise exception 'SHR197_SYSTEM_CATEGORY_ALREADY_CODED: %', v_category_id using errcode = '55000';
    end if;
    v_seen_codes := v_seen_codes || v_code;
    v_seen_categories := v_seen_categories || v_category_id;
  end loop;
  if not ('transfer' = any(v_seen_codes) and 'savings_investment' = any(v_seen_codes)) then
    raise exception 'SHR197_SYSTEM_CODE_SET_INCOMPLETE' using errcode = '22023';
  end if;

  -- Every current non-NULL label exactly once; duplicates are ambiguity and
  -- extras/omissions are a non-exhaustive manifest. Unknown labels may only be
  -- explicitly left unresolved. A unique live candidate is evidence for human
  -- review, never the UUID written: the manifest's explicit category_id is.
  for v_entry in select value from jsonb_array_elements(p_classifications) loop
    v_label := v_entry ->> 'legacy_label';
    if v_label is null then
      raise exception 'SHR197_MANIFEST_LABEL_REQUIRED' using errcode = '22023';
    end if;
    if v_label = any(v_manifest_labels) then
      raise exception 'SHR197_MANIFEST_LABEL_AMBIGUOUS: %', v_label using errcode = '22023';
    end if;
    v_manifest_labels := v_manifest_labels || v_label;
  end loop;
  select coalesce(array_agg(x.legacy_label order by x.legacy_label), '{}'::text[])
    into v_current_labels from private.category_legacy_label_candidates_v1() x;
  select coalesce(array_agg(x order by x), '{}'::text[])
    into v_manifest_labels from unnest(v_manifest_labels) x;
  if v_manifest_labels <> v_current_labels then
    raise exception 'SHR197_MANIFEST_LABEL_COVERAGE_MISMATCH' using errcode = '22023';
  end if;

  for v_entry in select value from jsonb_array_elements(p_classifications) loop
    v_label := v_entry ->> 'legacy_label';
    v_resolution := v_entry ->> 'resolution';
    v_category_id := nullif(v_entry ->> 'category_id', '')::uuid;
    select * into v_candidate from private.category_legacy_label_candidates_v1() x
      where x.legacy_label = v_label;
    if v_candidate.candidate_category_count > 1 then
      raise exception 'SHR197_MANIFEST_LABEL_AMBIGUOUS: %', v_label using errcode = '55000';
    elsif v_candidate.candidate_category_count = 0 then
      if v_resolution <> 'unresolved_unknown' or v_category_id is not null then
        raise exception 'SHR197_UNKNOWN_LABEL_MUST_REMAIN_UNRESOLVED: %', v_label using errcode = '22023';
      end if;
    elsif v_resolution <> 'mapped' or v_category_id is null then
      raise exception 'SHR197_KNOWN_LABEL_REQUIRES_EXPLICIT_UUID: %', v_label using errcode = '22023';
    end if;
    if v_resolution not in ('mapped', 'unresolved_unknown') then
      raise exception 'SHR197_RESOLUTION_NOT_ALLOWED: %', coalesce(v_resolution, '<null>') using errcode = '22023';
    end if;
    if v_category_id is not null and not exists (
      select 1 from public.categories c where c.id = v_category_id
    ) then
      raise exception 'SHR197_MANIFEST_CATEGORY_UNKNOWN: %', v_category_id using errcode = '23503';
    end if;
  end loop;

  select coalesce(sum(x.active_transaction_count + x.soft_deleted_transaction_count)
      filter (where (e.value ->> 'resolution') = 'mapped'), 0)::integer,
    coalesce(sum(x.active_transaction_count + x.soft_deleted_transaction_count)
      filter (where (e.value ->> 'resolution') = 'unresolved_unknown'), 0)::integer,
    coalesce(sum(x.category_rule_count)
      filter (where (e.value ->> 'resolution') = 'mapped'), 0)::integer,
    coalesce(sum(x.category_rule_count)
      filter (where (e.value ->> 'resolution') = 'unresolved_unknown'), 0)::integer
    into v_resolved_tx, v_unresolved_tx, v_resolved_rules, v_unresolved_rules
    from jsonb_array_elements(p_classifications) e(value)
    join private.category_legacy_label_candidates_v1() x
      on x.legacy_label = e.value ->> 'legacy_label';

  -- First mutation. All source/preflight/shape/coverage/reference checks above
  -- have completed. Any later failure rolls this insert and every later write
  -- back as one transaction.
  insert into public.category_reconciliation_runs (
    run_id, manifest_ref, manifest_digest, source_state_digest,
    classification_digest_before, classification_digest_after, preflight_snapshot,
    category_count, transaction_count, active_transaction_count,
    soft_deleted_transaction_count, null_transaction_category_count,
    category_rule_count, distinct_legacy_label_count, unknown_label_count,
    ambiguous_label_count, system_assignment_count,
    resolved_transaction_count, unresolved_transaction_count,
    resolved_category_rule_count, unresolved_category_rule_count,
    applied_by_access_user_id
  ) values (
    v_run_id, btrim(p_manifest_ref), v_manifest_digest, v_pre.source_state_digest,
    v_pre.classification_text_digest, v_pre.classification_text_digest, v_pre.roster,
    v_pre.category_count, v_pre.transaction_count, v_pre.active_transaction_count,
    v_pre.soft_deleted_transaction_count, v_pre.null_transaction_category_count,
    v_pre.category_rule_count, v_pre.distinct_legacy_label_count, v_pre.unknown_label_count,
    0, 2, v_resolved_tx, v_unresolved_tx, v_resolved_rules, v_unresolved_rules,
    p_acting_access_user_id
  );

  v_index := 0;
  for v_entry in select value from jsonb_array_elements(p_system_categories) loop
    v_index := v_index + 1;
    v_code := v_entry ->> 'system_code';
    v_category_id := (v_entry ->> 'category_id')::uuid;
    select c.* into v_category from public.categories c where c.id = v_category_id;
    perform private.assign_category_system_code_v1(v_category_id, v_code);
    insert into public.category_reconciliation_system_entries (
      run_id, entry_index, system_code, category_id, category_name,
      category_archived_at, previous_system_code, assigned
    ) values (v_run_id, v_index, v_code, v_category_id, v_category.name,
      v_category.archived_at, v_category.system_code, true);
  end loop;

  v_index := 0;
  for v_entry in select value from jsonb_array_elements(p_classifications) loop
    v_index := v_index + 1;
    v_label := v_entry ->> 'legacy_label';
    v_resolution := v_entry ->> 'resolution';
    v_category_id := nullif(v_entry ->> 'category_id', '')::uuid;
    v_evidence_ref := nullif(btrim(coalesce(v_entry ->> 'evidence_ref', '')), '');
    select * into v_candidate from private.category_legacy_label_candidates_v1() x
      where x.legacy_label = v_label;

    insert into public.category_reconciliation_manifest_entries (
      run_id, entry_index, legacy_label, resolution, category_id,
      candidate_category_count, active_transaction_count,
      soft_deleted_transaction_count, category_rule_count, evidence_ref
    ) values (
      v_run_id, v_index, v_label, v_resolution, v_category_id,
      v_candidate.candidate_category_count, v_candidate.active_transaction_count,
      v_candidate.soft_deleted_transaction_count, v_candidate.category_rule_count,
      coalesce(v_evidence_ref, btrim(p_manifest_ref))
    );

    if v_resolution = 'mapped' then
      update public.transactions set category_id = v_category_id where category = v_label;
      update public.category_rules set category_id = v_category_id where category = v_label;
    end if;
  end loop;

  with decisions as (
    select e.value ->> 'legacy_label' as legacy_label,
      e.value ->> 'resolution' as resolution,
      nullif(e.value ->> 'category_id', '')::uuid as category_id
    from jsonb_array_elements(p_classifications) e(value)
  )
  insert into public.category_reconciliation_row_evidence (
    run_id, subject_kind, subject_id, legacy_label, category_id,
    resolution, transaction_soft_deleted
  )
  select v_run_id, 'transaction', t.id, t.category, t.category_id,
    case when t.category is null then 'uncategorized_null'
         when d.resolution = 'mapped' then 'mapped'
         else 'unresolved_unknown' end,
    t.deleted_at is not null
  from public.transactions t left join decisions d on d.legacy_label = t.category;

  with decisions as (
    select e.value ->> 'legacy_label' as legacy_label,
      e.value ->> 'resolution' as resolution
    from jsonb_array_elements(p_classifications) e(value)
  )
  insert into public.category_reconciliation_row_evidence (
    run_id, subject_kind, subject_id, legacy_label, category_id,
    resolution, transaction_soft_deleted
  )
  select v_run_id, 'category_rule', r.id, r.category, r.category_id,
    case when d.resolution = 'mapped' then 'mapped' else 'unresolved_unknown' end,
    null
  from public.category_rules r join decisions d on d.legacy_label = r.category;

  v_after_digest := private.category_classification_text_digest_v1();
  if v_after_digest <> v_pre.classification_text_digest then
    raise exception 'SHR197_CLASSIFICATION_PARITY_MISMATCH' using errcode = '55000';
  end if;

  return jsonb_build_object(
    'replayed', false, 'run_id', v_run_id,
    'manifest_ref', btrim(p_manifest_ref),
    'resolved_transaction_count', v_resolved_tx,
    'unresolved_transaction_count', v_unresolved_tx,
    'null_transaction_category_count', v_pre.null_transaction_category_count,
    'soft_deleted_transaction_count', v_pre.soft_deleted_transaction_count,
    'resolved_category_rule_count', v_resolved_rules,
    'unresolved_category_rule_count', v_unresolved_rules,
    'classification_digest', v_after_digest);
end;
$$;

-- Deterministic post-run drift report. It compares current text/reference/delete
-- state with immutable per-row evidence; zero rows is the parity result.
create or replace function private.category_reconciliation_mismatch_report_v1(p_run_id uuid)
returns table (
  subject_kind text,
  subject_id uuid,
  mismatch_code text,
  expected_legacy_label text,
  current_legacy_label text,
  expected_category_id uuid,
  current_category_id uuid
)
language sql stable security invoker set search_path = '' as $$
  select e.subject_kind, e.subject_id,
    case when t.id is null then 'subject_missing'
         when t.category is distinct from e.legacy_label then 'legacy_text_changed'
         when t.category_id is distinct from e.category_id then 'stable_reference_changed'
         when (t.deleted_at is not null) is distinct from e.transaction_soft_deleted then 'soft_delete_state_changed'
    end,
    e.legacy_label, t.category, e.category_id, t.category_id
  from public.category_reconciliation_row_evidence e
  left join public.transactions t on e.subject_kind = 'transaction' and t.id = e.subject_id
  where e.run_id = p_run_id and e.subject_kind = 'transaction'
    and (t.id is null or t.category is distinct from e.legacy_label
      or t.category_id is distinct from e.category_id
      or (t.deleted_at is not null) is distinct from e.transaction_soft_deleted)
  union all
  select e.subject_kind, e.subject_id,
    case when r.id is null then 'subject_missing'
         when r.category is distinct from e.legacy_label then 'legacy_text_changed'
         when r.category_id is distinct from e.category_id then 'stable_reference_changed'
    end,
    e.legacy_label, r.category, e.category_id, r.category_id
  from public.category_reconciliation_row_evidence e
  left join public.category_rules r on e.subject_kind = 'category_rule' and r.id = e.subject_id
  where e.run_id = p_run_id and e.subject_kind = 'category_rule'
    and (r.id is null or r.category is distinct from e.legacy_label
      or r.category_id is distinct from e.category_id)
  order by 1, 2
$$;

-- ── 6. RLS and least privilege ───────────────────────────────────────────

alter table public.category_reconciliation_runs enable row level security;
alter table public.category_reconciliation_system_entries enable row level security;
alter table public.category_reconciliation_manifest_entries enable row level security;
alter table public.category_reconciliation_row_evidence enable row level security;
alter table public.category_reconciliation_replay_evidence enable row level security;

do $$
declare v_table text;
begin
  foreach v_table in array array[
    'category_reconciliation_runs',
    'category_reconciliation_system_entries',
    'category_reconciliation_manifest_entries',
    'category_reconciliation_row_evidence',
    'category_reconciliation_replay_evidence'
  ] loop
    execute format('drop policy if exists "category reconciliation evidence deny raw api access" on public.%I', v_table);
    execute format(
      'create policy "category reconciliation evidence deny raw api access" on public.%I for all to anon, authenticated using (false) with check (false)',
      v_table);
    execute format('revoke all on table public.%I from public, anon, authenticated, service_role', v_table);
    execute format('grant select on table public.%I to service_role', v_table);
  end loop;
end $$;

revoke all on function
  private.reject_category_reconciliation_evidence_mutation(),
  private.reject_category_reconciliation_evidence_truncate(),
  private.guard_category_stable_reference(),
  private.category_legacy_label_candidates_v1(),
  private.category_classification_text_digest_v1(),
  private.category_reconciliation_state_digest_v1(),
  private.category_reconciliation_roster_v1(),
  private.category_reconciliation_preflight_v1(),
  private.reconcile_category_references_v1(
    text, text, integer, integer, integer, integer, integer,
    integer, integer, integer, jsonb, jsonb, uuid),
  private.category_reconciliation_mismatch_report_v1(uuid)
  from public, anon, authenticated, service_role;

commit;

-- No production manifest is embedded here. Production remains through 044;
-- 045 must still ship with its reviewed backup source, and 046–050 must remain
-- separately authorized. Rollback is route-level: retain references/evidence
-- and stop future consumers. Never delete reconciliation evidence.
