-- 047_economic_identity_foundation.sql — SHR-193
--
-- The N-party-capable economic identity substrate: a stable economic/reporting
-- household namespace, stable economic parties, and one explicit access-to-party
-- mapping decision per (household, auth identity).
--
-- The whole point of this package is a distinction that must never collapse:
--
--     AUTHORIZATION ACTOR  !=  ECONOMIC PARTY
--
--   * an authenticated access identity answers "who may access this household?"
--     and is answered, now and after this migration, by public.household_members
--     and private.is_household_member() — unchanged, untouched, still the only
--     authorization root in this database;
--   * an economic party answers "which economic person does this financial fact
--     belong to?" and is answered by the tables below, which appear in no
--     authorization predicate anywhere.
--
-- Accordingly this migration is deliberately inert from the product's point of
-- view. After it runs:
--
--   * all three tables are empty. No economic household, no party and no mapping
--     decision is created, seeded or inferred — not from a display name, not from
--     an authentication identity, not from a Telegram identity. SHR-194 owns the
--     evidence-reviewed production reconciliation and the audited mapping
--     lifecycle, and it is a separate release with its own gate;
--   * no financial table gains an ownership or attribution column, and no
--     household_id is fanned out across facts. SHR-154 owns account ownership
--     references, SHR-195 transaction/posted-income attribution, SHR-171
--     recurring planning scope and SHR-178 goal planning scope;
--   * no existing RLS policy, grant, function or role is altered, and no new
--     authorization mechanism is created. There is deliberately no
--     private.is_economic_party_member();
--   * no fractional ownership exists: no share, weight, percentage or ratio
--     column, and no 50/50 or historical 69/31 allocation, here or implied;
--   * no product mutation API is invented merely because the tables exist. No
--     API role may write these rows at all; the migration/operator authority is
--     the only writer, exactly as for 046.
--
-- Two boundaries are worth finding before reading the guards, because both were
-- tightened by independent Tier-3 review:
--
--   * a reviewed mapping decision cannot be hard-deleted by any role, the
--     database owner included. It is durable household evidence that outlives
--     access revocation and authentication-identity replacement, and rollback
--     here is additive rather than destructive;
--   * reproducing a *historical* mapping decision — its original decided_at, and
--     a party archived long afterwards — is an explicit, named, per-row
--     capability (private.restore_access_party_mapping_v1), never an inference
--     from a caller-supplied timestamp. Every ordinary INSERT, from every role,
--     has its decision time authored by the database and can never select an
--     archived party.
--
-- Cross-household containment is worth stating once, because a reviewer will
-- look for it in the wrong place. It is enforced *structurally* — by the
-- composite foreign key below, a mapping cannot reference a party in another
-- economic household — and deliberately NOT as an authorization boundary.
-- Scoping RLS by economic household would require per-economic-household
-- membership, which is precisely the second authorization universe the SHR-156
-- R2 refinement forbids. Reads stay governed by the one existing household
-- membership predicate.

begin;

-- ── 1. Economic/reporting household namespace ────────────────────────────
--
-- A stable UUID for the economic/reporting household. It is NOT a replacement
-- authorization household and creates no membership universe of its own: no
-- policy in this database consults it, and nothing here grants access. Existing
-- financial tables deliberately do not receive a household_id column — there is
-- no concrete multi-household requirement, and fan-out is explicitly out of
-- scope for SHR-193 (SHR-156 R2).

create table if not exists public.economic_households (
  household_id uuid primary key default gen_random_uuid(),
  display_name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  schema_version smallint not null default 1,

  constraint economic_households_display_name_check
    check (display_name <> '' and display_name = btrim(display_name)),
  constraint economic_households_metadata_check
    check (schema_version = 1)
);

comment on table public.economic_households is
  'SHR-193 stable economic/reporting household namespace. Reporting scope only: it is never an authorization root, holds no membership, and appears in no RLS predicate. Authorization remains public.household_members plus private.is_household_member(). Empty after this migration; SHR-194 owns any production row.';
comment on column public.economic_households.display_name is
  'Presentation only. Mutable, not unique, never an identifier. The household_id UUID is the identity.';

-- ── 2. Economic parties ──────────────────────────────────────────────────
--
-- N-party capable from day one. Nothing here encodes a couple: there is no
-- primary/partner column, no husband/wife role, no pair constraint and no upper
-- bound. A household may legitimately have zero, one, two or many active
-- parties, and every constraint below holds in all four cases.
--
-- "Me" and "Partner" are contextual presentation language computed by a future
-- read API — Partner only when exactly one other active party exists — and are
-- deliberately absent from the database. Neither is a stored role.

create table if not exists public.economic_parties (
  party_id uuid primary key default gen_random_uuid(),
  household_id uuid not null
    references public.economic_households(household_id) on delete restrict,
  kind text not null default 'person',
  display_name text not null,
  archived_at timestamptz,
  legacy_owner_label text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  schema_version smallint not null default 1,

  -- Extensible additively later (an entity or trust is imaginable); text check
  -- rather than an enum, per the SHR-156 contract's explicit instruction.
  constraint economic_parties_kind_check
    check (kind in ('person')),
  constraint economic_parties_display_name_check
    check (display_name <> '' and display_name = btrim(display_name)),
  constraint economic_parties_legacy_label_check
    check (legacy_owner_label is null
           or (legacy_owner_label <> '' and legacy_owner_label = btrim(legacy_owner_label))),
  constraint economic_parties_metadata_check
    check (schema_version = 1)
);

-- Deliberately NOT unique: display_name may repeat, and legacy_owner_label must
-- never become an alternate key (SHR-156 R6). Parties are distinguished by UUID.
-- The one unique constraint added is the composite the mapping FK targets below.
--
-- Added conditionally rather than with the drop-and-recreate pattern 046 uses
-- for its check constraints: the composite foreign key on access_party_mappings
-- depends on this constraint's index, so dropping it on a re-run fails outright.
-- Re-applying this migration forward must be a no-op, and this is the shape that
-- makes it one.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.economic_parties'::regclass
      and conname = 'economic_parties_household_scope_key'
  ) then
    alter table public.economic_parties
      add constraint economic_parties_household_scope_key unique (party_id, household_id);
  end if;
end $$;

comment on table public.economic_parties is
  'SHR-193 stable economic parties, N-party capable. The party_id UUID is the only identity; display names are mutable presentation and need not be unique. Economic-party membership never grants authorization and never appears in an RLS predicate. Empty after this migration.';
comment on column public.economic_parties.display_name is
  'Mutable presentation. Renaming a party changes no financial meaning and never changes party_id, which is what downstream facts will reference.';
comment on column public.economic_parties.archived_at is
  'NULL is active. Archive is a non-destructive lifecycle state that preserves historical identity: an archived party stays fully resolvable for historical reads and its existing mappings survive, but no new write may select it. Reactivation (clearing this column) is permitted and rewrites nothing. Party rows are never deleted.';
comment on column public.economic_parties.legacy_owner_label is
  'Compatibility only, and frozen once set (SHR-156 R6). It records the exact legacy owner text a party corresponds to during migration. It is never an identifier, never unique, never an authorization key, and no permission is derived from it. Values such as Shrey, Tarika, Joint, Me or Partner carry no canonical meaning here.';

create index if not exists economic_parties_household_idx
  on public.economic_parties (household_id, party_id);

-- ── 3. Access-to-party mapping decisions ─────────────────────────────────
--
-- Exactly one explicit decision per (household_id, auth_user_id), with three
-- statuses:
--
--   mapped       — evidence-reviewed as representing a specific economic party
--   access_only  — legitimate household authorization, intentionally NOT an
--                  economic party (this is the state the test access identity
--                  is expected to reach in SHR-194)
--   unreviewed   — no decision has been made yet; the default
--
-- Multiple access identities MAY map to one economic party — a person who
-- replaces their login, or two devices/logins for one human — so there is
-- deliberately no unique constraint on economic_party_id.
--
-- auth_user_id is a typed logical reference, not a foreign key, and that is a
-- decision rather than an oversight. A foreign key to public.household_members
-- would couple economic identity to authorization membership and let revoking
-- access silently delete a reviewed economic decision; a cascading key to
-- auth.users would do the same when an authentication identity is replaced.
-- Both would collapse the two universes this package exists to keep apart. The
-- same typed-reference boundary is what 045 uses for audit actors.
--
-- A mapping row grants nothing. It is not consulted by any policy, and a stale
-- mapping left behind by a revoked member restores no access whatsoever.

create table if not exists public.access_party_mappings (
  mapping_id uuid primary key default gen_random_uuid(),
  household_id uuid not null
    references public.economic_households(household_id) on delete restrict,
  auth_user_id uuid not null,
  economic_party_id uuid,
  status text not null default 'unreviewed',
  decided_at timestamptz,
  decided_by_access_user_id uuid,
  decision_evidence_ref text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  schema_version smallint not null default 1,

  -- One decision per household/auth identity.
  constraint access_party_mappings_decision_key unique (household_id, auth_user_id),

  -- The composite reference is what makes a cross-household mapping
  -- structurally impossible: the party must live in this mapping's household.
  constraint access_party_mappings_party_fk
    foreign key (economic_party_id, household_id)
    references public.economic_parties (party_id, household_id) on delete restrict,

  constraint access_party_mappings_status_check
    check (status in ('mapped', 'access_only', 'unreviewed')),

  -- mapped requires a party; access_only and unreviewed forbid one. A single
  -- mapping decision therefore selects at most one economic party, and never
  -- selects one implicitly.
  constraint access_party_mappings_shape_check
    check (
      (status = 'mapped' and economic_party_id is not null)
      or (status in ('access_only', 'unreviewed') and economic_party_id is null)
    ),

  -- A decision has a decision time; "unreviewed" genuinely means undecided.
  constraint access_party_mappings_decision_evidence_check
    check (
      (status in ('mapped', 'access_only') and decided_at is not null)
      or (status = 'unreviewed' and decided_at is null
          and decided_by_access_user_id is null and decision_evidence_ref is null)
    ),

  constraint access_party_mappings_metadata_check
    check (schema_version = 1)
);

comment on table public.access_party_mappings is
  'SHR-193 explicit access-to-economic-party mapping decisions: one per (household_id, auth_user_id), status mapped | access_only | unreviewed. A mapping is a reporting/attribution statement and never an authorization grant — no policy reads this table, and a stale row cannot restore revoked household access. Empty after this migration; SHR-194 owns evidence-reviewed production rows and the audited lifecycle.';
comment on column public.access_party_mappings.auth_user_id is
  'Authorization actor identity (auth.users.id). Intentionally not a foreign key: economic decisions must outlive authentication-identity replacement and household-membership revocation, and must never be deleted as a side effect of either.';
comment on column public.access_party_mappings.economic_party_id is
  'At most one economic party per mapping decision, and only when status = mapped. Deliberately not unique: several access identities may legitimately map to the same economic party.';
comment on column public.access_party_mappings.status is
  'mapped = evidence-reviewed as representing that economic party. access_only = legitimately authorized for the household but intentionally not an economic party. unreviewed = no decision yet, and never an implicit economic party.';
comment on column public.access_party_mappings.decision_evidence_ref is
  'Opaque reference to the reviewed evidence behind a decision. Free text here; SHR-194 owns the manifest format and the audited lifecycle that populates it.';

create index if not exists access_party_mappings_party_idx
  on public.access_party_mappings (economic_party_id)
  where economic_party_id is not null;

create index if not exists access_party_mappings_household_idx
  on public.access_party_mappings (household_id, status);

-- ── 4. Lifecycle and immutability guards ─────────────────────────────────
--
-- Every guard is SECURITY INVOKER so current_user is the role that actually
-- issued the statement. "Operator authority" is not a new role: it is exactly
-- the existing database-owner/migration authority that owns these tables. anon,
-- authenticated and service_role are not members of it in this project, and
-- none of them holds any write privilege on these tables in any case — the ACL
-- section below is the primary gate and these guards are the semantics.

create or replace function private.economic_identity_operator_authority()
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
      where n.nspname = 'public' and c.relname = 'economic_parties'),
    'USAGE'
  )
$$;

comment on function private.economic_identity_operator_authority() is
  'True only for the database-owner/migration authority that owns the SHR-193 tables. Not a product role, not an RLS predicate, never granted to an API role, and never an economic-party concept.';

create or replace function private.guard_economic_household_lifecycle()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    -- Deleting a reporting namespace would orphan the stable identity every
    -- downstream package is going to reference. Rollback for this package is
    -- route-level: stop consumers, retain the objects.
    raise exception 'SHR193_ECONOMIC_HOUSEHOLD_DELETE_FORBIDDEN' using errcode = '55000';
  end if;

  if new.household_id is distinct from old.household_id then
    raise exception 'SHR193_ECONOMIC_HOUSEHOLD_IDENTITY_IMMUTABLE' using errcode = '55000';
  end if;
  if new.created_at is distinct from old.created_at then
    raise exception 'SHR193_ECONOMIC_HOUSEHOLD_CREATED_AT_IMMUTABLE' using errcode = '55000';
  end if;

  new.updated_at := now();
  return new;
end;
$$;

create or replace function private.guard_economic_party_lifecycle()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    -- Historical identity stability: a party UUID is what downstream financial
    -- attribution will point at, so it is never destroyed. Archive is the
    -- non-destructive lifecycle state, and it is reversible.
    raise exception 'SHR193_ECONOMIC_PARTY_DELETE_FORBIDDEN' using errcode = '55000';
  end if;

  if tg_op = 'UPDATE' then
    if new.party_id is distinct from old.party_id then
      raise exception 'SHR193_ECONOMIC_PARTY_IDENTITY_IMMUTABLE' using errcode = '55000';
    end if;
    -- Moving a party between economic households would silently reinterpret
    -- every fact that will later reference it.
    if new.household_id is distinct from old.household_id then
      raise exception 'SHR193_ECONOMIC_PARTY_HOUSEHOLD_IMMUTABLE' using errcode = '55000';
    end if;
    if new.created_at is distinct from old.created_at then
      raise exception 'SHR193_ECONOMIC_PARTY_CREATED_AT_IMMUTABLE' using errcode = '55000';
    end if;
    if new.kind is distinct from old.kind then
      raise exception 'SHR193_ECONOMIC_PARTY_KIND_IMMUTABLE' using errcode = '55000';
    end if;

    -- The legacy label is a frozen compatibility value (SHR-156 R6). Once it
    -- records which legacy owner text a party corresponds to, that statement
    -- about history cannot be edited or withdrawn. Setting it on a party that
    -- has none is a migration/compat decision, so it is operator-only.
    if old.legacy_owner_label is not null
       and new.legacy_owner_label is distinct from old.legacy_owner_label then
      raise exception 'SHR193_LEGACY_OWNER_LABEL_IMMUTABLE' using errcode = '55000';
    end if;
    if old.legacy_owner_label is null and new.legacy_owner_label is not null
       and not private.economic_identity_operator_authority() then
      raise exception 'SHR193_LEGACY_OWNER_LABEL_ASSIGNMENT_FORBIDDEN' using errcode = '42501';
    end if;

    -- display_name and archived_at are deliberately unguarded: renaming a party
    -- and archiving or reactivating one are both approved, non-destructive, and
    -- must not change party_id or any historical meaning.

    new.updated_at := now();
    return new;
  end if;

  return new;
end;
$$;

create or replace function private.guard_access_party_mapping_lifecycle()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_archived timestamptz;
  v_restore_for text;
  v_is_restore boolean := false;
begin
  if tg_op = 'DELETE' then
    -- A reviewed mapping decision is durable household evidence. It survives
    -- access revocation and authentication-identity replacement by contract, so
    -- there is no ordinary DML path that erases it — for any role, the database
    -- owner included. Rollback for this package is additive: stop consumers and
    -- retain the rows. Nothing references this table, and both foreign keys it
    -- holds are ON DELETE RESTRICT against tables whose own DELETE is refused,
    -- so no cascade can reach these rows either.
    raise exception 'SHR193_MAPPING_DELETE_FORBIDDEN' using errcode = '55000';
  end if;

  if tg_op = 'INSERT' then
    -- The restore boundary.
    --
    -- A backup re-import has to reproduce a decision made in the past, including
    -- its original decided_at and a party archived long afterwards. An ordinary
    -- write must never be able to claim that status. The earlier version of this
    -- guard inferred "restore" from a caller-supplied old timestamp, which the
    -- Tier-3 review correctly rejected: SHR-194's ordinary mapping writer runs
    -- with the same operator authority, so it could have made a brand-new
    -- archived-party mapping simply by passing an old date.
    --
    -- So restore is now an explicit, named, per-row capability instead of an
    -- inference. private.restore_access_party_mapping_v1() issues a token bound
    -- to one exact mapping_id; this guard consumes it, so a single issuance
    -- admits exactly one row and cannot unlock a bulk insert. Everything else —
    -- every ordinary INSERT, from every role — has its timestamps authored by
    -- the database below and can never select an archived party.
    v_restore_for := nullif(pg_catalog.current_setting('shr193.restore_mapping_id', true), '');
    if v_restore_for is not null and v_restore_for = new.mapping_id::text then
      v_is_restore := true;
      perform pg_catalog.set_config('shr193.restore_mapping_id', '', true);
    end if;
  end if;

  if tg_op = 'UPDATE' then
    if new.mapping_id is distinct from old.mapping_id then
      raise exception 'SHR193_MAPPING_IDENTITY_IMMUTABLE' using errcode = '55000';
    end if;
    -- The mapping key is the decision's subject. Re-pointing a decision at a
    -- different household or a different access identity would rewrite whose
    -- decision it was, rather than changing the decision.
    if new.household_id is distinct from old.household_id then
      raise exception 'SHR193_MAPPING_HOUSEHOLD_IMMUTABLE' using errcode = '55000';
    end if;
    if new.auth_user_id is distinct from old.auth_user_id then
      raise exception 'SHR193_MAPPING_AUTH_IDENTITY_IMMUTABLE' using errcode = '55000';
    end if;
    if new.created_at is distinct from old.created_at then
      raise exception 'SHR193_MAPPING_CREATED_AT_IMMUTABLE' using errcode = '55000';
    end if;
  end if;

  -- Decision time is authored by the database on every path except an explicit
  -- restore, so no caller — operator included — can choose it.
  if v_is_restore then
    -- Preserved exactly as the backup recorded it: decided_at,
    -- decided_by_access_user_id, decision_evidence_ref, created_at, updated_at.
    null;
  elsif tg_op = 'INSERT' then
    new.created_at := now();
    new.updated_at := now();
    if new.status in ('mapped', 'access_only') then
      new.decided_at := now();
    end if;
  else
    -- On UPDATE a changed decision — a different status, or a different party —
    -- is stamped as the new decision it actually is; an unchanged one keeps its
    -- original date rather than accepting a caller's edit. A regression to
    -- unreviewed therefore keeps its decided_at and is refused by
    -- access_party_mappings_decision_evidence_check: a decision cannot be
    -- silently un-made.
    if (new.status is distinct from old.status
        or new.economic_party_id is distinct from old.economic_party_id)
       and new.status in ('mapped', 'access_only')
    then
      new.decided_at := now();
    else
      new.decided_at := old.decided_at;
    end if;
    new.updated_at := now();
  end if;

  -- New writes fail closed on an archived party; an existing mapping whose
  -- party is archived afterwards is untouched, which is the historical-stability
  -- half of the same rule.
  --
  -- On every ordinary path this is absolute: decided_at was just authored above,
  -- so there is nothing a caller can supply to make the write look historical.
  -- Only an explicit restore may reproduce such a mapping, and even then only
  -- when the decision genuinely predates the archival — a restore cannot invent
  -- a historical decision that never happened.
  if new.economic_party_id is not null
     and (tg_op = 'INSERT' or new.economic_party_id is distinct from old.economic_party_id)
  then
    select p.archived_at into v_archived
      from public.economic_parties p
     where p.party_id = new.economic_party_id;

    if v_archived is not null then
      if not v_is_restore then
        raise exception 'SHR193_MAPPING_TO_ARCHIVED_PARTY_FORBIDDEN' using errcode = '55000';
      end if;
      if new.decided_at is null or new.decided_at >= v_archived then
        raise exception 'SHR193_RESTORE_DECISION_NOT_HISTORICAL' using errcode = '55000';
      end if;
    end if;
  end if;

  return new;
end;
$$;

-- The one sanctioned way to reproduce a historical mapping decision.
--
-- SECURITY INVOKER on purpose: current_user must be the role that actually
-- called it, so the operator check below is real rather than a self-assertion by
-- a definer-owned function. EXECUTE is revoked from every API role, and no API
-- role holds INSERT on the table either, so this is doubly out of reach from a
-- browser or an Edge Function.
--
-- It is deliberately not, and must not become, SHR-194's ordinary mapping
-- writer: it exists to re-import rows that already existed, it takes a caller-
-- supplied mapping_id and decision time that an ordinary write has no business
-- choosing, and it refuses any archived-party row whose decision does not
-- genuinely predate the archival. SHR-194's writer creates *new* decisions and
-- must use ordinary INSERT, where the database authors the decision time and an
-- archived party is refused outright.
create or replace function private.restore_access_party_mapping_v1(
  p_mapping_id uuid,
  p_household_id uuid,
  p_auth_user_id uuid,
  p_economic_party_id uuid,
  p_status text,
  p_decided_at timestamptz,
  p_decided_by_access_user_id uuid,
  p_decision_evidence_ref text,
  p_created_at timestamptz,
  p_updated_at timestamptz
)
returns public.access_party_mappings
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_row public.access_party_mappings%rowtype;
begin
  if not private.economic_identity_operator_authority() then
    raise exception 'SHR193_RESTORE_FORBIDDEN' using errcode = '42501';
  end if;
  if p_mapping_id is null then
    raise exception 'SHR193_RESTORE_REQUIRES_MAPPING_ID' using errcode = '22023';
  end if;

  -- Bound to this one row and consumed by the guard, so it can never admit a
  -- second row or a bulk insert.
  perform pg_catalog.set_config('shr193.restore_mapping_id', p_mapping_id::text, true);

  insert into public.access_party_mappings (
    mapping_id, household_id, auth_user_id, economic_party_id, status,
    decided_at, decided_by_access_user_id, decision_evidence_ref,
    created_at, updated_at
  ) values (
    p_mapping_id, p_household_id, p_auth_user_id, p_economic_party_id, p_status,
    p_decided_at, p_decided_by_access_user_id, p_decision_evidence_ref,
    coalesce(p_created_at, now()), coalesce(p_updated_at, now())
  ) returning * into v_row;

  -- Belt and braces: if the row never reached the guard, the token must not
  -- survive to meet the next statement.
  perform pg_catalog.set_config('shr193.restore_mapping_id', '', true);
  return v_row;
end;
$$;

comment on function private.restore_access_party_mapping_v1(
  uuid, uuid, uuid, uuid, text, timestamptz, uuid, text, timestamptz, timestamptz) is
  'SHR-193 restore-only boundary. Operator authority, invoker-mode, uncallable by any API role, and the only path that may reproduce a historical decided_at or a mapping to an already-archived party. Every structural constraint still applies, and the decision must genuinely predate the archival. It is not SHR-194''s mapping writer: new decisions use ordinary INSERT, where the database authors the decision time and an archived party is refused.';

create or replace function private.reject_economic_identity_truncate()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception 'SHR193_ECONOMIC_IDENTITY_TRUNCATE_FORBIDDEN' using errcode = '55000';
end;
$$;

comment on function private.guard_economic_party_lifecycle() is
  'SHR-193 party identity boundary: UUID, household, kind and created_at immutable; legacy label frozen; display name and archive state freely mutable; deletion refused.';
comment on function private.guard_access_party_mapping_lifecycle() is
  'SHR-193 mapping decision boundary: decision subject immutable, hard delete refused for every role, decision time authored by the database on every ordinary path, and archived-party selection fail-closed except through the explicit per-row restore boundary.';

drop trigger if exists economic_households_lifecycle_guard on public.economic_households;
create trigger economic_households_lifecycle_guard
before update or delete on public.economic_households
for each row execute function private.guard_economic_household_lifecycle();

drop trigger if exists economic_households_no_truncate on public.economic_households;
create trigger economic_households_no_truncate
before truncate on public.economic_households
for each statement execute function private.reject_economic_identity_truncate();

drop trigger if exists economic_parties_lifecycle_guard on public.economic_parties;
create trigger economic_parties_lifecycle_guard
before insert or update or delete on public.economic_parties
for each row execute function private.guard_economic_party_lifecycle();

drop trigger if exists economic_parties_no_truncate on public.economic_parties;
create trigger economic_parties_no_truncate
before truncate on public.economic_parties
for each statement execute function private.reject_economic_identity_truncate();

drop trigger if exists access_party_mappings_lifecycle_guard on public.access_party_mappings;
create trigger access_party_mappings_lifecycle_guard
before insert or update or delete on public.access_party_mappings
for each row execute function private.guard_access_party_mapping_lifecycle();

drop trigger if exists access_party_mappings_no_truncate on public.access_party_mappings;
create trigger access_party_mappings_no_truncate
before truncate on public.access_party_mappings
for each statement execute function private.reject_economic_identity_truncate();

-- ── 5. RLS and least-privilege ACLs ──────────────────────────────────────
--
-- Authorization stays exactly where it already is. The only predicate used is
-- private.is_household_member() — the same one every financial table uses — and
-- no policy anywhere is modified by this migration. There is deliberately no
-- economic-party predicate and no private.is_economic_party_member(): economic
-- identity must never be able to grant, widen or restore access.
--
-- Read is the only capability granted. SHR-193 invents no product mutation API
-- merely because the tables exist; SHR-194 owns the reviewed, audited write path
-- and will make its own explicit grant decision.

alter table public.economic_households enable row level security;
alter table public.economic_parties enable row level security;
alter table public.access_party_mappings enable row level security;

drop policy if exists "household read economic households" on public.economic_households;
create policy "household read economic households" on public.economic_households
  for select to authenticated
  using ((select private.is_household_member()));

drop policy if exists "household read economic parties" on public.economic_parties;
create policy "household read economic parties" on public.economic_parties
  for select to authenticated
  using ((select private.is_household_member()));

drop policy if exists "household read access party mappings" on public.access_party_mappings;
create policy "household read access party mappings" on public.access_party_mappings
  for select to authenticated
  using ((select private.is_household_member()));

-- Supabase's platform grants on public tables are broad and must not be
-- inherited. Revoke everything first, then grant only the household read and
-- the raw read the encrypted backup exporter needs. No INSERT, UPDATE or DELETE
-- is granted to any API role, so Postgres refuses those commands before RLS is
-- even consulted.
revoke all on table public.economic_households
  from public, anon, authenticated, service_role;
revoke all on table public.economic_parties
  from public, anon, authenticated, service_role;
revoke all on table public.access_party_mappings
  from public, anon, authenticated, service_role;

grant select on table public.economic_households to authenticated, service_role;
grant select on table public.economic_parties to authenticated, service_role;
grant select on table public.access_party_mappings to authenticated, service_role;

-- Trigger functions are fired by the trigger machinery, which does not check
-- EXECUTE, so revoking it everywhere leaves the guards working while making them
-- uncallable. The operator predicate is revoked for the same reason: the
-- database owner reaches it, no API role needs it.
revoke all on function
  private.guard_economic_household_lifecycle(),
  private.guard_economic_party_lifecycle(),
  private.guard_access_party_mapping_lifecycle(),
  private.reject_economic_identity_truncate(),
  private.economic_identity_operator_authority(),
  private.restore_access_party_mapping_v1(
    uuid, uuid, uuid, uuid, text, timestamptz, uuid, text, timestamptz, timestamptz)
  from public, anon, authenticated, service_role;

commit;

-- Rollback is route-level, exactly as for 045 and 046: stop any future consumer
-- while retaining these objects, which are harmless while empty. Never roll back
-- by deleting economic identity — a party UUID is the stable reference every
-- later attribution package depends on, and a mapping decision is the reviewed
-- evidence of who that party is. Destructive cleanup is not a rollback path
-- here, and the database refuses it outright rather than relying on convention.
