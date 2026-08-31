-- 046_category_lifecycle_foundation.sql — SHR-196
--
-- Additive category identity/lifecycle substrate only. Existing category names
-- remain the V1 compatibility and classification input. This migration seeds
-- no system code, records no fabricated history, exposes no resolver, and
-- enables no rename/archive lifecycle API.

begin;

alter table public.categories
  add column if not exists system_code text,
  add column if not exists archived_at timestamptz,
  add column if not exists updated_at timestamptz not null default now();

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.categories'::regclass
      and conname = 'categories_system_code_check'
  ) then
    alter table public.categories
      add constraint categories_system_code_check
      check (system_code is null or system_code in ('transfer', 'savings_investment'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.categories'::regclass
      and conname = 'categories_system_category_active_check'
  ) then
    alter table public.categories
      add constraint categories_system_category_active_check
      check (system_code is null or archived_at is null);
  end if;
end;
$$;

create unique index if not exists categories_system_code_uidx
  on public.categories (system_code)
  where system_code is not null;

comment on column public.categories.system_code is
  'SHR-196 protected stable semantic code. Nullable until the separately reviewed SHR-197 reconciliation; only transfer and savings_investment are structurally allowed.';
comment on column public.categories.archived_at is
  'SHR-196 lifecycle substrate. Production archive/reactivation remains fail-closed until the budget predicate and SHR-160 rule lifecycle exist.';
comment on column public.categories.updated_at is
  'Database-authored category row update time. Existing names/IDs/classification remain unchanged.';

create table if not exists public.category_name_history (
  history_id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.categories(id) on delete restrict,
  old_name text not null,
  new_name text not null,
  changed_at timestamptz not null,
  recorded_at timestamptz not null default now(),
  evidence_version smallint not null default 1,

  constraint category_name_history_names_check
    check (old_name <> new_name),
  constraint category_name_history_time_check
    check (recorded_at >= changed_at),
  constraint category_name_history_version_check
    check (evidence_version = 1)
);

comment on table public.category_name_history is
  'Immutable category rename evidence. It is historical only and never becomes a resolver candidate without a separate explicit category_aliases row.';

create index if not exists category_name_history_category_idx
  on public.category_name_history (category_id, changed_at, history_id);

create table if not exists public.category_aliases (
  alias_id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.categories(id) on delete restrict,
  alias_name text not null,
  resolver_state text not null default 'compatibility_active',
  created_at timestamptz not null default now(),
  retired_at timestamptz,
  lifecycle_version smallint not null default 1,

  constraint category_aliases_name_check
    check (length(alias_name) > 0),
  constraint category_aliases_state_check
    check (resolver_state in ('compatibility_active', 'history_only')),
  constraint category_aliases_lifecycle_check
    check (
      (resolver_state = 'compatibility_active' and retired_at is null)
      or
      (resolver_state = 'history_only' and retired_at is not null and retired_at >= created_at)
    ),
  constraint category_aliases_version_check
    check (lifecycle_version = 1)
);

comment on table public.category_aliases is
  'Explicit compatibility alias storage. Only compatibility_active rows reserve an exact label; history_only rows remain evidence and do not reserve or resolve the label.';

create unique index if not exists category_aliases_active_name_uidx
  on public.category_aliases (alias_name)
  where resolver_state = 'compatibility_active';
create index if not exists category_aliases_category_idx
  on public.category_aliases (category_id, created_at, alias_id);

-- Category changes remain deliberately narrow. Ordinary category creation and
-- presentation edits continue to work, while name changes, archive changes,
-- and every hard-delete shape fail closed. The database owner is the explicit
-- migration/restore trust root and may assign a first valid system code; once
-- assigned, even owner ordinary DML cannot change or clear it.
create or replace function private.guard_category_lifecycle_v1()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_table_owner name;
begin
  if tg_op = 'TRUNCATE' then
    raise exception 'SHR196_CATEGORY_HARD_DELETE_DISABLED' using errcode = '55000';
  end if;

  if tg_op = 'DELETE' then
    if old.system_code is not null then
      raise exception 'SHR196_SYSTEM_CATEGORY_DELETE_PROTECTED' using errcode = '55000';
    end if;
    raise exception 'SHR196_CATEGORY_HARD_DELETE_DISABLED' using errcode = '55000';
  end if;

  select pg_catalog.pg_get_userbyid(c.relowner)
  into v_table_owner
  from pg_catalog.pg_class c
  where c.oid = tg_relid;

  if tg_op = 'INSERT' then
    if new.system_code is not null and current_user <> v_table_owner then
      raise exception 'SHR196_SYSTEM_CODE_ASSIGNMENT_FORBIDDEN' using errcode = '42501';
    end if;
    if new.archived_at is not null and current_user <> v_table_owner then
      raise exception 'SHR196_CATEGORY_ARCHIVE_DISABLED' using errcode = '55000';
    end if;
    if current_user <> v_table_owner then
      new.updated_at := statement_timestamp();
    end if;
  else
    if new.name is distinct from old.name then
      raise exception 'SHR196_CATEGORY_RENAME_DISABLED' using errcode = '55000';
    end if;

    if new.system_code is distinct from old.system_code then
      if old.system_code is not null then
        raise exception 'SHR196_SYSTEM_CODE_IMMUTABLE' using errcode = '55000';
      end if;
      if new.system_code is null or current_user <> v_table_owner then
        raise exception 'SHR196_SYSTEM_CODE_ASSIGNMENT_FORBIDDEN' using errcode = '42501';
      end if;
    end if;

    if new.archived_at is distinct from old.archived_at then
      if old.system_code is not null then
        raise exception 'SHR196_SYSTEM_CATEGORY_ARCHIVE_PROTECTED' using errcode = '55000';
      end if;
      raise exception 'SHR196_CATEGORY_ARCHIVE_DISABLED' using errcode = '55000';
    end if;

    new.updated_at := statement_timestamp();
  end if;

  -- Exact-text coordination only. SHR-196 intentionally defines no Unicode,
  -- case, or whitespace normalization algorithm. A retired/history-only alias
  -- therefore does not reserve an ordinary label.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(new.name, 196));
  if exists (
    select 1
    from public.category_aliases a
    where a.resolver_state = 'compatibility_active'
      and a.alias_name = new.name
  ) then
    raise exception 'SHR196_CATEGORY_NAME_ACTIVE_ALIAS_CONFLICT' using errcode = '23505';
  end if;

  return new;
end;
$$;

drop trigger if exists categories_lifecycle_guard on public.categories;
create trigger categories_lifecycle_guard
before insert or update or delete on public.categories
for each row execute function private.guard_category_lifecycle_v1();

drop trigger if exists categories_truncate_guard on public.categories;
create trigger categories_truncate_guard
before truncate on public.categories
for each statement execute function private.guard_category_lifecycle_v1();

create or replace function private.guard_category_name_history_v1()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_table_owner name;
begin
  if tg_op in ('UPDATE', 'DELETE', 'TRUNCATE') then
    raise exception 'SHR196_CATEGORY_NAME_HISTORY_IMMUTABLE' using errcode = '55000';
  end if;

  select pg_catalog.pg_get_userbyid(c.relowner)
  into v_table_owner
  from pg_catalog.pg_class c
  where c.oid = tg_relid;

  if current_user <> v_table_owner then
    raise exception 'SHR196_CATEGORY_NAME_HISTORY_WRITE_FORBIDDEN' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists category_name_history_guard on public.category_name_history;
create trigger category_name_history_guard
before insert or update or delete on public.category_name_history
for each row execute function private.guard_category_name_history_v1();

drop trigger if exists category_name_history_truncate_guard on public.category_name_history;
create trigger category_name_history_truncate_guard
before truncate on public.category_name_history
for each statement execute function private.guard_category_name_history_v1();

create or replace function private.guard_category_alias_v1()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_table_owner name;
begin
  if tg_op in ('DELETE', 'TRUNCATE') then
    raise exception 'SHR196_CATEGORY_ALIAS_DELETE_DISABLED' using errcode = '55000';
  end if;

  select pg_catalog.pg_get_userbyid(c.relowner)
  into v_table_owner
  from pg_catalog.pg_class c
  where c.oid = tg_relid;

  if current_user <> v_table_owner then
    raise exception 'SHR196_CATEGORY_ALIAS_WRITE_FORBIDDEN' using errcode = '42501';
  end if;

  if tg_op = 'UPDATE' then
    if new.category_id is distinct from old.category_id
      or new.alias_name is distinct from old.alias_name
      or new.created_at is distinct from old.created_at
      or new.lifecycle_version is distinct from old.lifecycle_version
    then
      raise exception 'SHR196_CATEGORY_ALIAS_IDENTITY_IMMUTABLE' using errcode = '55000';
    end if;

    if old.resolver_state <> 'compatibility_active'
      or new.resolver_state <> 'history_only'
      or new.retired_at is null
    then
      raise exception 'SHR196_CATEGORY_ALIAS_LIFECYCLE_INVALID' using errcode = '55000';
    end if;
  end if;

  if new.resolver_state = 'compatibility_active' then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(new.alias_name, 196));
    if exists (
      select 1 from public.categories c
      where c.id = new.category_id and c.archived_at is not null
    ) then
      raise exception 'SHR196_ACTIVE_ALIAS_ARCHIVED_CATEGORY' using errcode = '23514';
    end if;
    if exists (
      select 1 from public.categories c where c.name = new.alias_name
    ) then
      raise exception 'SHR196_ACTIVE_ALIAS_CATEGORY_NAME_CONFLICT' using errcode = '23505';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists category_aliases_guard on public.category_aliases;
create trigger category_aliases_guard
before insert or update or delete on public.category_aliases
for each row execute function private.guard_category_alias_v1();

drop trigger if exists category_aliases_truncate_guard on public.category_aliases;
create trigger category_aliases_truncate_guard
before truncate on public.category_aliases
for each statement execute function private.guard_category_alias_v1();

alter table public.category_name_history enable row level security;
alter table public.category_aliases enable row level security;

drop policy if exists "category name history household read" on public.category_name_history;
create policy "category name history household read" on public.category_name_history
  for select to authenticated
  using (private.is_household_member());

drop policy if exists "category aliases household read" on public.category_aliases;
create policy "category aliases household read" on public.category_aliases
  for select to authenticated
  using (private.is_household_member());

-- Do not inherit the project's historical public-table defaults. Household
-- members may read durable evidence, the backup service may read it raw, and
-- neither role may write it directly.
revoke all on table public.category_name_history, public.category_aliases
  from public, anon, authenticated, service_role;
grant select on table public.category_name_history, public.category_aliases
  to authenticated, service_role;

-- Existing category create/presentation-edit grants remain compatible, but
-- destructive table-wide and row-delete capabilities are no longer part of
-- the category API. Triggers provide the owner/operator defense in depth.
revoke delete, truncate on table public.categories
  from public, anon, authenticated, service_role;

revoke all on function private.guard_category_lifecycle_v1(),
  private.guard_category_name_history_v1(),
  private.guard_category_alias_v1()
  from public, anon, authenticated, service_role;

commit;

-- Rollback is compatibility routing only: keep the additive columns, durable
-- evidence tables, and guards. V1 name-based consumers remain unchanged.
