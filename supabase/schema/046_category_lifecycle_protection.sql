-- 046_category_lifecycle_protection.sql — SHR-196
--
-- Category lifecycle and system-code protection foundation. This is the
-- database substrate that must exist before SHR-197 may reconcile stable
-- category references, and before SHR-198 may build a resolver on top of it.
--
-- It is deliberately dormant from the product's point of view:
--
--   * no category is given a system code here, and none is inferred from a
--     name — after this migration every categories.system_code is still NULL;
--   * no transaction or category-rule stable reference is added or backfilled;
--   * no rename API, archive API, reactivate API or resolver is enabled;
--   * no financial classification, budget actual, canonical view, Telegram
--     path or consumer read changes.
--
-- What it does add is the boundary the later packages depend on: a closed
-- system-code vocabulary, an assignment path only the migration/operator
-- authority can use, immutability of an assigned code, protection of a system
-- category from archive and delete, a fail-closed archive path, immutable
-- rename history, and an explicitly separate alias lifecycle.

begin;

-- ── 1. Additive lifecycle columns on categories ──────────────────────────
--
-- All three are additive and default-safe against the current production
-- shape (id, name, "group", icon, created_at). system_code and archived_at
-- stay NULL on every existing row; updated_at is seeded from each row's own
-- created_at rather than a wall-clock stamp, so the migration is
-- deterministic and adds no new information to a row that has never changed.

alter table public.categories add column if not exists system_code text;
alter table public.categories add column if not exists archived_at timestamptz;
alter table public.categories add column if not exists updated_at timestamptz;

update public.categories set updated_at = created_at where updated_at is null;
alter table public.categories alter column updated_at set default now();
alter table public.categories alter column updated_at set not null;

-- Only the two evidence-backed semantics approved by the SHR-157 contract
-- review are structurally accepted. An unsupported code is rejected by the
-- database, not by a caller convention. SHR-197 owns assigning either of
-- them to a real row after an independently reviewed evidence manifest.
alter table public.categories drop constraint if exists categories_system_code_check;
alter table public.categories add constraint categories_system_code_check
  check (system_code is null or system_code in ('transfer', 'savings_investment'));

-- A system semantic has exactly one anchor row.
create unique index if not exists categories_system_code_uidx
  on public.categories (system_code) where system_code is not null;

-- Declarative defence in depth for the guard trigger below: a registered
-- system category can never carry an archive timestamp, whatever path wrote it.
alter table public.categories drop constraint if exists categories_system_not_archivable_check;
alter table public.categories add constraint categories_system_not_archivable_check
  check (system_code is null or archived_at is null);

comment on column public.categories.system_code is
  'SHR-196 controlled system semantic. NULL for every ordinary category and for every row today. Only transfer and savings_investment are accepted; assignment is a migration/operator action (SHR-197), and an assigned code is immutable to every ordinary path. It is not an authorization concept and never participates in RLS.';
comment on column public.categories.archived_at is
  'SHR-196 lifecycle substrate. NULL is active. No product or API archive path is enabled: SHR-167 owns the current-budget predicate and SHR-160 owns atomic rule lifecycle, so archive fails closed until both exist.';
comment on column public.categories.updated_at is
  'Database-authored. Set by the lifecycle guard on every UPDATE; seeded from created_at for rows that predate SHR-196.';

-- ── 2. Immutable rename history ──────────────────────────────────────────
--
-- History is evidence, not behaviour. A row here records that a category's
-- display name changed; it never makes the former label resolvable again and
-- never reserves that label globally. Resolver behaviour lives in
-- category_aliases below, and is a separate, explicitly registered decision.

create table if not exists public.category_name_history (
  name_history_id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.categories(id),
  previous_name text not null,
  new_name text not null,
  changed_at timestamptz not null default now(),
  changed_by_access_user_id uuid,
  change_reason_code text not null default 'direct_name_change',
  schema_version smallint not null default 1,

  constraint category_name_history_names_differ_check
    check (previous_name <> new_name),
  constraint category_name_history_reason_check
    check (change_reason_code in ('direct_name_change')),
  constraint category_name_history_metadata_check
    check (schema_version = 1)
);

comment on table public.category_name_history is
  'SHR-196 immutable category rename evidence. A historical label recorded here is not an active resolver candidate and is not globally reserved; see public.category_aliases for compatibility resolution state.';
comment on column public.category_name_history.changed_by_access_user_id is
  'Access identity from auth.uid() when the change came from an authenticated session, NULL on migration/operator paths. It is never an economic owner or party inference.';

create index if not exists category_name_history_category_idx
  on public.category_name_history (category_id, changed_at desc, name_history_id);

-- ── 3. Explicit resolver aliases, with a real lifecycle ──────────────────
--
-- An alias is a deliberately registered compatibility input. It starts
-- compatibility_active and may be retired exactly once to history_only, which
-- is terminal. Only compatibility_active aliases participate in the ambiguity
-- constraint, so retiring an alias releases the label rather than reserving an
-- ordinary former name forever — the R1 refinement. Nothing in SHR-196 reads
-- these rows: the resolver itself is SHR-198.

create table if not exists public.category_aliases (
  alias_id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.categories(id),
  alias_name text not null,
  state text not null default 'compatibility_active',
  source_name_history_id uuid references public.category_name_history(name_history_id),
  registered_at timestamptz not null default now(),
  retired_at timestamptz,
  schema_version smallint not null default 1,

  constraint category_aliases_state_check
    check (state in ('compatibility_active', 'history_only')),
  constraint category_aliases_retirement_check
    check (
      (state = 'compatibility_active' and retired_at is null)
      or (state = 'history_only' and retired_at is not null)
    ),
  constraint category_aliases_name_check
    check (alias_name <> '' and alias_name = btrim(alias_name)),
  constraint category_aliases_metadata_check
    check (schema_version = 1)
);

comment on table public.category_aliases is
  'SHR-196 explicit compatibility aliases. compatibility_active aliases are unique against each other and against current category names; history_only is terminal and releases the label. Registration is never automatic from rename history.';

-- Ambiguity is blocked only while compatibility actually depends on the
-- alias. Exact text equality on purpose: no normalization algorithm has been
-- specified or reviewed yet, and inventing one here would silently create a
-- second authoritative identity rule.
create unique index if not exists category_aliases_active_name_uidx
  on public.category_aliases (alias_name) where state = 'compatibility_active';

create index if not exists category_aliases_category_idx
  on public.category_aliases (category_id, state, alias_id);

-- ── 4. Lifecycle guards ──────────────────────────────────────────────────
--
-- Every guard below is SECURITY INVOKER so that current_user is the role that
-- actually issued the statement, and so an ordinary path can never be
-- mistaken for the operator path.
--
-- "Operator authority" is not a new role and not a taxonomy administrator. It
-- is exactly the existing database-owner authority that runs migrations: the
-- role that owns public.categories. anon, authenticated and service_role are
-- not members of it in this project (verified read-only against production),
-- so none of them can reach an operator-only transition. The database owner
-- can of course also disable or drop these triggers by DDL; that real trust
-- root is documented here rather than claimed away.

create or replace function private.category_operator_authority()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select pg_catalog.pg_has_role(
    current_user,
    (select c.relowner
       from pg_catalog.pg_class c
       join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = 'categories'),
    'USAGE'
  )
$$;

comment on function private.category_operator_authority() is
  'True only for the database-owner/migration authority that owns public.categories. Not a product role, not an RLS predicate, and never granted to an API role.';

create or replace function private.guard_category_lifecycle()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_operator boolean := pg_catalog.pg_has_role(
    current_user,
    (select c.relowner
       from pg_catalog.pg_class c
       join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = 'categories'),
    'USAGE'
  );
begin
  if tg_op = 'DELETE' then
    -- No user or API hard delete exists in v6, for any category. Ordinary
    -- removal semantics are archive, and archive itself is not enabled yet.
    if old.system_code is not null then
      raise exception 'SHR196_SYSTEM_CATEGORY_DELETE_FORBIDDEN' using errcode = '55000';
    end if;
    raise exception 'SHR196_CATEGORY_DELETE_FORBIDDEN' using errcode = '55000';
  end if;

  if tg_op = 'UPDATE' then
    if new.id is distinct from old.id then
      raise exception 'SHR196_CATEGORY_IDENTITY_IMMUTABLE' using errcode = '55000';
    end if;
    if new.created_at is distinct from old.created_at then
      raise exception 'SHR196_CATEGORY_CREATED_AT_IMMUTABLE' using errcode = '55000';
    end if;

    -- An assigned system code is the canonical anchor for a financial
    -- semantic. Nothing visible to this trigger may change it or clear it,
    -- operator included: reassignment would silently move meaning between
    -- rows, which is what the SHR-157 review's R8 refinement forbids.
    if old.system_code is not null and new.system_code is distinct from old.system_code then
      raise exception 'SHR196_SYSTEM_CODE_IMMUTABLE' using errcode = '55000';
    end if;
    if old.system_code is null and new.system_code is not null and not v_operator then
      raise exception 'SHR196_SYSTEM_CODE_ASSIGNMENT_FORBIDDEN' using errcode = '42501';
    end if;

    if new.archived_at is distinct from old.archived_at then
      if coalesce(new.system_code, old.system_code) is not null then
        raise exception 'SHR196_SYSTEM_CATEGORY_ARCHIVE_FORBIDDEN' using errcode = '55000';
      end if;
      if not v_operator then
        raise exception 'SHR196_CATEGORY_ARCHIVE_NOT_ENABLED' using errcode = '55000';
      end if;
      if old.archived_at is null and new.archived_at is not null then
        -- Fail closed rather than invent the missing predicates. SHR-167 owns
        -- what a "currently active" budget plan means and SHR-160 owns
        -- deterministic rule enable/disable; until both exist, any reference
        -- blocks archive. This is a temporary conservative block, not the
        -- final eligibility rule, and historical references must not block
        -- lifecycle forever.
        if exists (select 1 from public.budgets b where b.category_id = old.id) then
          raise exception 'SHR196_CATEGORY_ARCHIVE_BUDGET_PREDICATE_UNDEFINED' using errcode = '55000';
        end if;
        if exists (select 1 from public.category_rules r where r.category = old.name) then
          raise exception 'SHR196_CATEGORY_ARCHIVE_RULE_LIFECYCLE_UNDEFINED' using errcode = '55000';
        end if;
      end if;
    end if;

    if new.name is distinct from old.name then
      -- Display-only rename of a registered system category is blocked while
      -- any consumer still reads category text. SHR-157 R12 requires a
      -- measurable zero-text-semantic-consumer inventory before it opens.
      if old.system_code is not null and not v_operator then
        raise exception 'SHR196_SYSTEM_CATEGORY_RENAME_FORBIDDEN' using errcode = '55000';
      end if;
      if exists (
        select 1 from public.category_aliases a
        where a.state = 'compatibility_active'
          and a.alias_name = new.name
          and a.category_id <> new.id
      ) then
        raise exception 'SHR196_CATEGORY_NAME_ALIAS_CONFLICT' using errcode = '23505';
      end if;
    end if;

    new.updated_at := now();
    return new;
  end if;

  -- INSERT
  if new.system_code is not null and not v_operator then
    raise exception 'SHR196_SYSTEM_CODE_ASSIGNMENT_FORBIDDEN' using errcode = '42501';
  end if;
  if new.archived_at is not null and not v_operator then
    raise exception 'SHR196_CATEGORY_ARCHIVE_NOT_ENABLED' using errcode = '55000';
  end if;
  if exists (
    select 1 from public.category_aliases a
    where a.state = 'compatibility_active' and a.alias_name = new.name
  ) then
    raise exception 'SHR196_CATEGORY_NAME_ALIAS_CONFLICT' using errcode = '23505';
  end if;
  return new;
end;
$$;

comment on function private.guard_category_lifecycle() is
  'SHR-196 database boundary for category identity, system-code and lifecycle mutation. Invoker-mode so the acting role is real; never bypassed by an application convention.';

-- Rename evidence is written by the database, not by a caller, so history
-- cannot be omitted by whichever path performed the rename. SECURITY DEFINER
-- is what lets it write a table no API role may write; it is fired only by
-- the trigger and its EXECUTE is revoked from every role.
create or replace function private.record_category_name_history()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.category_name_history (
    category_id, previous_name, new_name, changed_by_access_user_id, change_reason_code
  ) values (
    new.id, old.name, new.name, auth.uid(), 'direct_name_change'
  );
  return null;
end;
$$;

comment on function private.record_category_name_history() is
  'SHR-196 trigger-only history writer. It records evidence of a rename; it never registers a compatibility alias, which is a separate explicit decision.';

create or replace function private.reject_category_history_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception 'category_name_history rows are immutable' using errcode = '55000';
end;
$$;

create or replace function private.guard_category_history_insert()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not pg_catalog.pg_has_role(
    current_user,
    (select c.relowner
       from pg_catalog.pg_class c
       join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = 'categories'),
    'USAGE'
  ) then
    raise exception 'SHR196_HISTORY_DIRECT_INSERT_FORBIDDEN' using errcode = '42501';
  end if;
  return new;
end;
$$;

create or replace function private.guard_category_alias_lifecycle()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_operator boolean := pg_catalog.pg_has_role(
    current_user,
    (select c.relowner
       from pg_catalog.pg_class c
       join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = 'categories'),
    'USAGE'
  );
begin
  if tg_op = 'DELETE' then
    raise exception 'SHR196_ALIAS_DELETE_FORBIDDEN' using errcode = '55000';
  end if;

  if not v_operator then
    raise exception 'SHR196_ALIAS_WRITE_FORBIDDEN' using errcode = '42501';
  end if;

  if tg_op = 'INSERT' then
    -- Ambiguity only matters while an alias is actually resolvable. A
    -- history_only row may legitimately carry a label some category now uses,
    -- because retirement releases the label — and a restore has to be able to
    -- put exactly that pair back. The state/retired_at pairing itself is
    -- already guaranteed by category_aliases_retirement_check.
    if new.state = 'compatibility_active'
      and exists (select 1 from public.categories c where c.name = new.alias_name)
    then
      raise exception 'SHR196_ALIAS_NAME_CONFLICTS_WITH_CURRENT_CATEGORY' using errcode = '23505';
    end if;
    return new;
  end if;

  -- UPDATE: the single permitted transition is retirement. Everything else
  -- about an alias row is immutable, and history_only is terminal, so a
  -- retired label can never be silently reactivated as a resolver candidate.
  if new.alias_id is distinct from old.alias_id
    or new.category_id is distinct from old.category_id
    or new.alias_name is distinct from old.alias_name
    or new.source_name_history_id is distinct from old.source_name_history_id
    or new.registered_at is distinct from old.registered_at
    or new.schema_version is distinct from old.schema_version
  then
    raise exception 'SHR196_ALIAS_IMMUTABLE_FIELD' using errcode = '55000';
  end if;
  if not (old.state = 'compatibility_active'
          and new.state = 'history_only'
          and new.retired_at is not null) then
    raise exception 'SHR196_ALIAS_STATE_TRANSITION_INVALID' using errcode = '22023';
  end if;
  return new;
end;
$$;

create or replace function private.reject_category_truncate()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception 'SHR196_CATEGORY_TRUNCATE_FORBIDDEN' using errcode = '55000';
end;
$$;

drop trigger if exists categories_lifecycle_guard on public.categories;
create trigger categories_lifecycle_guard
before insert or update or delete on public.categories
for each row execute function private.guard_category_lifecycle();

drop trigger if exists categories_record_name_history on public.categories;
create trigger categories_record_name_history
after update on public.categories
for each row when (old.name is distinct from new.name)
execute function private.record_category_name_history();

drop trigger if exists categories_no_truncate on public.categories;
create trigger categories_no_truncate
before truncate on public.categories
for each statement execute function private.reject_category_truncate();

drop trigger if exists category_name_history_guard_insert on public.category_name_history;
create trigger category_name_history_guard_insert
before insert on public.category_name_history
for each row execute function private.guard_category_history_insert();

drop trigger if exists category_name_history_immutable on public.category_name_history;
create trigger category_name_history_immutable
before update or delete on public.category_name_history
for each row execute function private.reject_category_history_mutation();

drop trigger if exists category_name_history_no_truncate on public.category_name_history;
create trigger category_name_history_no_truncate
before truncate on public.category_name_history
for each statement execute function private.reject_category_truncate();

drop trigger if exists category_aliases_lifecycle_guard on public.category_aliases;
create trigger category_aliases_lifecycle_guard
before insert or update or delete on public.category_aliases
for each row execute function private.guard_category_alias_lifecycle();

drop trigger if exists category_aliases_no_truncate on public.category_aliases;
create trigger category_aliases_no_truncate
before truncate on public.category_aliases
for each statement execute function private.reject_category_truncate();

-- ── 5. Named operator paths for the packages that come next ──────────────
--
-- SHR-197 assigns the two reviewed system codes and SHR-198 registers the
-- first compatibility aliases. Both need a named, testable path rather than
-- ad-hoc DML, and neither is executable by any API role.

create or replace function private.assign_category_system_code_v1(
  p_category_id uuid,
  p_system_code text
)
returns public.categories
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_row public.categories%rowtype;
begin
  if p_system_code is null or p_system_code not in ('transfer', 'savings_investment') then
    raise exception 'SHR196_SYSTEM_CODE_NOT_ALLOWED' using errcode = '22023';
  end if;

  select c.* into v_row from public.categories c where c.id = p_category_id for update;
  if not found then
    raise exception 'SHR196_CATEGORY_NOT_FOUND' using errcode = '22023';
  end if;
  if v_row.system_code is not null then
    raise exception 'SHR196_SYSTEM_CODE_IMMUTABLE' using errcode = '55000';
  end if;
  if v_row.archived_at is not null then
    raise exception 'SHR196_CATEGORY_ARCHIVED' using errcode = '55000';
  end if;

  update public.categories set system_code = p_system_code where id = p_category_id
  returning * into v_row;
  return v_row;
end;
$$;

comment on function private.assign_category_system_code_v1(uuid, text) is
  'SHR-196 operator-only, one-way system-code assignment. SHR-196 itself calls it for nothing: no production category receives a code in this package.';

create or replace function private.register_category_alias_v1(
  p_category_id uuid,
  p_alias_name text,
  p_source_name_history_id uuid default null
)
returns public.category_aliases
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_row public.category_aliases%rowtype;
begin
  insert into public.category_aliases (category_id, alias_name, source_name_history_id)
  values (p_category_id, p_alias_name, p_source_name_history_id)
  returning * into v_row;
  return v_row;
end;
$$;

comment on function private.register_category_alias_v1(uuid, text, uuid) is
  'SHR-196 operator-only alias registration. Rename history never calls it: turning a historical label into an active resolver candidate is always an explicit decision.';

create or replace function private.retire_category_alias_v1(p_alias_id uuid)
returns public.category_aliases
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_row public.category_aliases%rowtype;
begin
  update public.category_aliases
     set state = 'history_only', retired_at = now()
   where alias_id = p_alias_id and state = 'compatibility_active'
  returning * into v_row;
  if not found then
    raise exception 'SHR196_ALIAS_NOT_COMPATIBILITY_ACTIVE' using errcode = '55000';
  end if;
  return v_row;
end;
$$;

comment on function private.retire_category_alias_v1(uuid) is
  'SHR-196 operator-only alias retirement. history_only is terminal; the released label stops participating in the active-alias ambiguity constraint.';

-- ── 6. RLS and least-privilege ACLs ──────────────────────────────────────
--
-- Authorization stays exactly where the rest of this database puts it:
-- private.is_household_member(). No category-level, system-code-level or
-- owner-level predicate is introduced, and no taxonomy administrator role is
-- invented. Members may read their household's category evidence; nobody
-- reaches it through a browser write.

alter table public.category_name_history enable row level security;
alter table public.category_aliases enable row level security;

drop policy if exists "household read category name history" on public.category_name_history;
create policy "household read category name history" on public.category_name_history
  for select to authenticated
  using (private.is_household_member());

drop policy if exists "household read category aliases" on public.category_aliases;
create policy "household read category aliases" on public.category_aliases
  for select to authenticated
  using (private.is_household_member());

-- Supabase's platform grants are broad on public tables; the new objects must
-- not inherit them. Revoke everything, then grant only the household read and
-- the raw read the encrypted backup exporter needs.
revoke all on table public.category_name_history
  from public, anon, authenticated, service_role;
revoke all on table public.category_aliases
  from public, anon, authenticated, service_role;
grant select on table public.category_name_history to authenticated, service_role;
grant select on table public.category_aliases to authenticated, service_role;

-- Trigger functions are fired by the trigger machinery, which does not check
-- EXECUTE, so revoking it everywhere leaves the guards working while making
-- them uncallable as functions. The operator paths are revoked for the same
-- reason: the database owner reaches them, no API role does.
revoke all on function
  private.guard_category_lifecycle(),
  private.record_category_name_history(),
  private.reject_category_history_mutation(),
  private.guard_category_history_insert(),
  private.guard_category_alias_lifecycle(),
  private.reject_category_truncate(),
  private.assign_category_system_code_v1(uuid, text),
  private.register_category_alias_v1(uuid, text, uuid),
  private.retire_category_alias_v1(uuid)
  from public, anon, authenticated, service_role;

-- The named authority predicate exists so SHR-197 and the QA suite have one
-- reviewable definition of operator authority. The guards deliberately inline
-- the same expression instead of calling it: service_role and anon hold no
-- USAGE on the private schema, and a guard that depended on that grant would
-- fail with a privilege error rather than its own contract error. No API role
-- needs the predicate, so none receives it.
revoke all on function private.category_operator_authority()
  from public, anon, authenticated, service_role;

commit;

-- Rollback is route-level, exactly as for 045: stop any future consumer while
-- retaining the additive columns, the immutable history, the alias evidence
-- and the guards. Never roll back by deleting category identity or history.
