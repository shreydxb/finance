-- 049_account_ownership_stable_refs.sql — SHR-154
--
-- The stable account-ownership foundation: an additive reference from an
-- account to the SHR-193 economic-party substrate, an evidence-gated way to
-- populate it, and a V2 read adapter — with the legacy `accounts.owner` text
-- retained and still authoritative for every existing consumer.
--
-- Three identities must stay apart, and this migration is written so that a
-- reviewer can check each one independently:
--
--     AUTHORIZATION ACTOR  !=  ECONOMIC PARTY  !=  ACCOUNT OWNERSHIP FACT
--
--   * an authenticated access identity answers "who may access this
--     household?" and is still answered only by public.household_members and
--     private.is_household_member(). This migration creates no policy on any
--     existing table, alters none, invents no role, and adds no predicate;
--   * an economic party answers "which economic person is this?" and is
--     answered by 047's public.economic_parties, unchanged here;
--   * account ownership answers "whose account is this?" and is what this
--     migration adds. It is a financial/domain fact. It grants nothing, it
--     revokes nothing, it appears in no RLS predicate, and no policy anywhere
--     consults accounts.ownership_kind or accounts.owner_party_id.
--
-- Applying this migration is deliberately inert from the product's point of
-- view. Afterwards:
--
--   * every existing account row carries ownership_kind = 'unreconciled' and
--     owner_party_id = NULL. Nothing is inferred. In particular the legacy
--     `owner` text — 'Shrey', 'Tarika', 'Joint', or anything else a household
--     has typed — is NEVER read to decide who an economic party is. SHR-194
--     established that identity cannot be derived from presentation evidence,
--     and a label on an account is presentation evidence;
--   * no economic party is created. This package creates none and can create
--     none: parties come from SHR-194's approved manifest, and account
--     ownership can only point at parties that already exist;
--   * no existing financial value changes. No transaction, income, budget,
--     recurring item, goal, snapshot or account *value* is read for inference
--     or written at all, and an ownership decision deliberately does not touch
--     accounts.updated_at, because v_canonical_accounts_aed derives valuation
--     freshness from it;
--   * no consumer is cut over. public.canonical_balance_sheet(),
--     canonical_investment_metrics(), canonical_period_metrics(), the
--     nw_snapshot/nw_daily owner buckets and every screen still read the legacy
--     owner text exactly as before. SHR-173/153/172/178/158 own those cutovers;
--   * there is no fractional ownership anywhere: no share, weight, percentage,
--     ratio or split column, no 50/50 and no historical 69/31, here or implied.
--     A shared account is one row with ownership_kind = 'household', counted
--     once, and is never duplicated into a per-party personal fact.
--
-- Release ordering is unchanged and this migration does not weaken it. 045 must
-- still be applied together with the reviewed backup source (SHR-191), and 049
-- depends on 045, 046, 047 and 048 having been applied first.
--
-- Rollback is route-level, exactly as for 045–048: stop any future consumer of
-- the V2 adapter and retain every object and every row. Never roll back by
-- deleting an ownership decision or its history — a decision is the reviewed
-- record of whose account it is, and the database refuses to destroy it rather
-- than relying on convention.

begin;

-- ── 1. The stable ownership reference on accounts ────────────────────────
--
-- Two additive columns, exactly as the SHR-154 contract names them, and nothing
-- else. `owner` is untouched and stays a freely mutable presentation/compat
-- value that the app still writes on every account form submission.
--
-- Three ownership kinds, and they are genuinely three different statements:
--
--   personal      — an explicit economic fact: this account belongs to exactly
--                   one economic party, named by a stable UUID.
--   household     — an explicit economic fact: this account is genuinely shared
--                   household truth. It is ONE row, counted ONCE, with no
--                   owning party and no allocation of any kind. This is the
--                   "Both" semantic, and representing it by writing the account
--                   once per party would be exactly the duplication the
--                   contract forbids.
--   unreconciled  — the absence of an economic fact, and the default. It is not
--                   a guess, not "probably household", and not "probably the
--                   person named in `owner`". It means nobody has reviewed it
--                   yet, and it stays explicit so that every consumer can tell
--                   the difference between shared and unknown.
--
-- The column is added with a constant default, so Postgres 11+ applies it as a
-- fast default: no table rewrite, and every existing account row keeps its
-- physical tuple identity. The upgrade-path runner asserts exactly that.

alter table public.accounts
  add column if not exists ownership_kind text not null default 'unreconciled';
alter table public.accounts
  add column if not exists owner_party_id uuid;

-- Conditional adds rather than drop-and-recreate: a re-run must be a forward
-- no-op that never opens a window in which the table is unconstrained.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.accounts'::regclass
      and conname = 'accounts_ownership_kind_check'
  ) then
    alter table public.accounts
      add constraint accounts_ownership_kind_check
      check (ownership_kind in ('personal', 'household', 'unreconciled'));
  end if;

  -- A personal account names exactly one party; a shared or unreconciled
  -- account names none. This is what makes "shared" structurally incapable of
  -- carrying a per-party allocation.
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.accounts'::regclass
      and conname = 'accounts_ownership_shape_check'
  ) then
    alter table public.accounts
      add constraint accounts_ownership_shape_check
      check (
        (ownership_kind = 'personal' and owner_party_id is not null)
        or (ownership_kind in ('household', 'unreconciled') and owner_party_id is null)
      );
  end if;

  -- ON DELETE RESTRICT, matching every reference into the economic substrate.
  -- 047 refuses party deletion outright anyway; this is the second lock.
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.accounts'::regclass
      and conname = 'accounts_owner_party_fk'
  ) then
    alter table public.accounts
      add constraint accounts_owner_party_fk
      foreign key (owner_party_id)
      references public.economic_parties (party_id) on delete restrict;
  end if;
end $$;

create index if not exists accounts_owner_party_idx
  on public.accounts (owner_party_id)
  where owner_party_id is not null;

create index if not exists accounts_ownership_kind_idx
  on public.accounts (ownership_kind);

comment on column public.accounts.ownership_kind is
  'SHR-154 stable ownership contract: personal (exactly one economic party, named by owner_party_id) | household (genuinely shared household truth, one row counted once, no party and no allocation) | unreconciled (no reviewed economic fact yet, the default). Never authorization, never derived from the legacy owner text, and never a fractional share.';
comment on column public.accounts.owner_party_id is
  'SHR-154 stable reference to public.economic_parties.party_id. UUID identity only: a display name is never a key here, and renaming or archiving a party changes no ownership fact. Populated only through the reviewed reconciliation path, never by an API role and never by inference.';
comment on column public.accounts.owner is
  'Legacy owner text. Compatibility and presentation only, and still authoritative for every consumer that has not been cut over (canonical_balance_sheet, canonical_investment_metrics, nw_snapshot_items.owner, nw_daily.by_owner and the app screens). It is NOT an identity, is not unique, is freely mutable, and SHR-154 deliberately never reads it to decide an economic party.';

-- ── 2. Durable ownership evidence ────────────────────────────────────────
--
-- accounts holds the current ownership fact, which is correct — an account has
-- one owner now — but it cannot answer "what did this used to be, and on what
-- evidence?". These two tables are that answer, and they are append-only.
--
-- They are deliberately separate objects from audit_events, for the reason
-- SHR-191 states about itself: audit_events is minimized action evidence, not
-- domain state. Ownership history is the household's own durable record. 046
-- drew the same line for category renames and 048 for mapping decisions.
--
-- No audit_events policy, constraint, function or allowlist is touched by this
-- migration. See the note in section 5 for why, and the PR/handoff for the
-- explicit reviewer question about it.

create table if not exists public.account_ownership_reconciliation_runs (
  run_id uuid primary key default gen_random_uuid(),
  manifest_ref text not null,
  manifest_digest text not null,
  account_state_digest text not null,
  account_count integer not null,
  economic_household_id uuid not null
    references public.economic_households(household_id) on delete restrict,
  assignment_count integer not null,
  applied_at timestamptz not null default now(),
  applied_by_access_user_id uuid,
  schema_version smallint not null default 1,

  constraint account_ownership_runs_manifest_key unique (manifest_ref),
  constraint account_ownership_runs_manifest_ref_check
    check (manifest_ref <> '' and manifest_ref = btrim(manifest_ref)),
  constraint account_ownership_runs_manifest_digest_check
    check (manifest_digest ~ '^sha256:[0-9a-f]{64}$'),
  constraint account_ownership_runs_state_digest_check
    check (account_state_digest ~ '^sha256:[0-9a-f]{64}$'),
  constraint account_ownership_runs_counts_check
    check (account_count >= 0 and assignment_count >= 0),
  constraint account_ownership_runs_metadata_check
    check (schema_version = 1)
);

comment on table public.account_ownership_reconciliation_runs is
  'SHR-154 immutable record of an applied, evidence-reviewed account-ownership manifest. The unique manifest reference is the idempotency key: re-applying the same approved manifest is a no-DML replay, and the same reference carrying different content is refused as a conflict rather than silently reapplied.';
comment on column public.account_ownership_reconciliation_runs.account_state_digest is
  'The account-ownership digest actually proven by the preflight at apply time. A digest, never the roster: no account name and no legacy owner label is stored here.';

create table if not exists public.account_ownership_history (
  ownership_history_id uuid primary key default gen_random_uuid(),
  -- A typed logical reference, not a foreign key, and that is a decision rather
  -- than an oversight — the same boundary 045 uses for audit actors and 047 for
  -- mapping auth identities. A foreign key here would do two unacceptable
  -- things: it would let deleting an account erase the evidence that its
  -- ownership was ever decided, and (ON DELETE RESTRICT) it would make a
  -- reconciled account undeletable, silently breaking the account deletion the
  -- app performs today. Evidence outlives the fact it describes.
  account_id uuid not null,
  decision_version integer not null,
  action_code text not null,
  previous_ownership_kind text not null,
  new_ownership_kind text not null,
  previous_owner_party_id uuid,
  new_owner_party_id uuid,
  economic_household_id uuid not null
    references public.economic_households(household_id) on delete restrict,
  decided_at timestamptz not null default now(),
  decided_by_access_user_id uuid,
  decision_evidence_ref text,
  recorded_at timestamptz not null default now(),
  schema_version smallint not null default 1,

  constraint account_ownership_history_version_key unique (account_id, decision_version),
  constraint account_ownership_history_version_check check (decision_version >= 1),
  constraint account_ownership_history_action_check
    check (action_code in ('account.ownership.assigned', 'account.ownership.changed')),
  constraint account_ownership_history_kind_check
    check (previous_ownership_kind in ('personal', 'household', 'unreconciled')
           and new_ownership_kind in ('personal', 'household', 'unreconciled')),
  -- Both sides of the record obey the same shape rule accounts does, so history
  -- can never describe a state the table itself would refuse.
  constraint account_ownership_history_shape_check
    check (
      ((new_ownership_kind = 'personal' and new_owner_party_id is not null)
        or (new_ownership_kind in ('household', 'unreconciled') and new_owner_party_id is null))
      and
      ((previous_ownership_kind = 'personal' and previous_owner_party_id is not null)
        or (previous_ownership_kind in ('household', 'unreconciled') and previous_owner_party_id is null))
    ),
  -- A reviewed decision is never a regression to "unknown", and an "assigned"
  -- action is specifically the first move away from unreconciled.
  constraint account_ownership_history_progress_check
    check (
      new_ownership_kind <> 'unreconciled'
      and (action_code <> 'account.ownership.assigned'
           or (previous_ownership_kind = 'unreconciled' and decision_version = 1))
      and (action_code <> 'account.ownership.changed'
           or previous_ownership_kind <> 'unreconciled')
    ),
  constraint account_ownership_history_evidence_ref_check
    check (decision_evidence_ref is null
           or (decision_evidence_ref <> '' and decision_evidence_ref = btrim(decision_evidence_ref))),
  constraint account_ownership_history_metadata_check
    check (schema_version = 1)
);

comment on table public.account_ownership_history is
  'SHR-154 immutable per-account ownership decision history. Append-only for every role, the database owner included: it is the only record that an account''s economic ownership was ever different, and a restore that lost it would assert the current owner as though it had always been true.';

create index if not exists account_ownership_history_account_idx
  on public.account_ownership_history (account_id, decision_version);
create index if not exists account_ownership_history_party_idx
  on public.account_ownership_history (new_owner_party_id)
  where new_owner_party_id is not null;

-- ── 3. Guards ────────────────────────────────────────────────────────────
--
-- Every guard is SECURITY INVOKER so current_user is the role that actually
-- issued the statement, matching 045–048. "Operator authority" is not a new
-- role and not a second authorization universe: it is exactly the existing
-- database-owner/migration authority 047 already defines, reused rather than
-- reinvented so there is only ever one such predicate in this schema.

create or replace function private.reject_account_ownership_evidence_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    raise exception 'SHR154_OWNERSHIP_EVIDENCE_IMMUTABLE' using errcode = '55000';
  end if;
  raise exception 'SHR154_OWNERSHIP_EVIDENCE_DELETE_FORBIDDEN' using errcode = '55000';
end;
$$;

comment on function private.reject_account_ownership_evidence_mutation() is
  'SHR-154 append-only boundary for account ownership history and reconciliation run records. Never rewrite an old decision to make a new state look historical, and never delete decision history.';

create or replace function private.reject_account_ownership_evidence_truncate()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception 'SHR154_OWNERSHIP_EVIDENCE_TRUNCATE_FORBIDDEN' using errcode = '55000';
end;
$$;

drop trigger if exists account_ownership_history_immutable
  on public.account_ownership_history;
create trigger account_ownership_history_immutable
before update or delete on public.account_ownership_history
for each row execute function private.reject_account_ownership_evidence_mutation();

drop trigger if exists account_ownership_history_no_truncate
  on public.account_ownership_history;
create trigger account_ownership_history_no_truncate
before truncate on public.account_ownership_history
for each statement execute function private.reject_account_ownership_evidence_truncate();

drop trigger if exists account_ownership_runs_immutable
  on public.account_ownership_reconciliation_runs;
create trigger account_ownership_runs_immutable
before update or delete on public.account_ownership_reconciliation_runs
for each row execute function private.reject_account_ownership_evidence_mutation();

drop trigger if exists account_ownership_runs_no_truncate
  on public.account_ownership_reconciliation_runs;
create trigger account_ownership_runs_no_truncate
before truncate on public.account_ownership_reconciliation_runs
for each statement execute function private.reject_account_ownership_evidence_truncate();

-- The ownership reference guard on accounts.
--
-- This is the compatibility boundary, and its most important property is what
-- it does NOT do. An ordinary account write that leaves both ownership columns
-- alone — every insert and update the app performs today, including every edit
-- of the legacy `owner` text — takes the fast path and is returned untouched.
-- The guard never sets updated_at, never rewrites a value, and never rejects
-- anything an existing consumer does.
--
-- What it does gate is ownership itself:
--
--   * setting or changing ownership_kind/owner_party_id requires the operator
--     authority, so no API role can assign ownership even though authenticated
--     holds table-level UPDATE on accounts through Supabase's platform grants.
--     SHR-154 introduces no ownership mutation API at all — reconciliation is a
--     reviewed release action, not a product feature;
--   * a reviewed decision cannot regress to 'unreconciled'. A decision is not
--     silently un-made; correcting one is a forward change to the right fact;
--   * a new decision fails closed on an archived party, exactly as 047's
--     mapping rule does. An account whose party is archived afterwards is
--     untouched and stays fully resolvable — that is the historical-stability
--     half of the same rule;
--   * account ownership stays inside one economic household. accounts carries
--     no household_id (047 deliberately fans none out), so containment is
--     enforced relationally: a party may only be selected if every other
--     account already carrying ownership belongs to the same economic
--     household. A cross-household reference is refused rather than silently
--     splitting the household's accounts across two economic namespaces.

create or replace function private.guard_account_ownership_reference()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_touches_ownership boolean;
  v_restore_for text;
  v_is_restore boolean := false;
  v_party_household uuid;
  v_party_archived timestamptz;
  v_other_household uuid;
begin
  if tg_op = 'INSERT' then
    -- An ordinary insert leaves ownership at its default and is not an
    -- ownership decision at all.
    v_touches_ownership :=
      new.ownership_kind is distinct from 'unreconciled'
      or new.owner_party_id is not null;
  else
    v_touches_ownership :=
      new.ownership_kind is distinct from old.ownership_kind
      or new.owner_party_id is distinct from old.owner_party_id;
  end if;

  if not v_touches_ownership then
    -- The fast path: every existing consumer write, returned exactly as given.
    return new;
  end if;

  -- The restore boundary, mirroring 047's: an explicit, named, per-row
  -- capability rather than an inference. A backup re-import has to be able to
  -- reproduce an account that was already owned by a party archived before the
  -- backup was taken. An ordinary write must never be able to claim that, so
  -- the token is bound to one exact account_id, is consumed here, and is
  -- honoured on INSERT only — it can never unlock a bulk write or an update.
  if tg_op = 'INSERT' then
    v_restore_for := nullif(pg_catalog.current_setting('shr154.restore_account_id', true), '');
    if v_restore_for is not null and v_restore_for = new.id::text then
      v_is_restore := true;
      perform pg_catalog.set_config('shr154.restore_account_id', '', true);
    end if;
  end if;

  -- The operator predicate, inlined rather than called.
  --
  -- It is exactly private.economic_identity_operator_authority()'s expression
  -- and must stay exactly that (a test asserts the two agree). It is inlined
  -- because this trigger, unlike every other guard in 045-048, is genuinely
  -- reached by unprivileged roles: authenticated holds table-level UPDATE on
  -- accounts through Supabase's platform grants. Calling a private function
  -- whose EXECUTE is revoked from every API role would make the refusal a
  -- bare "permission denied for function" instead of this contract's own
  -- error, and would couple a household member's ordinary account write to a
  -- grant on an unrelated identity function.
  if not pg_catalog.pg_has_role(
       current_user,
       (select c.relowner
          from pg_catalog.pg_class c
          join pg_catalog.pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public' and c.relname = 'economic_parties'),
       'USAGE') then
    raise exception 'SHR154_OWNERSHIP_WRITE_FORBIDDEN' using errcode = '42501';
  end if;

  if tg_op = 'UPDATE'
     and old.ownership_kind <> 'unreconciled'
     and new.ownership_kind = 'unreconciled' then
    raise exception 'SHR154_OWNERSHIP_CANNOT_BE_UNRECONCILED' using errcode = '55000';
  end if;

  if new.owner_party_id is not null then
    select p.household_id, p.archived_at
      into v_party_household, v_party_archived
      from public.economic_parties p
     where p.party_id = new.owner_party_id;

    if not found then
      raise exception 'SHR154_OWNERSHIP_PARTY_UNKNOWN' using errcode = '23503';
    end if;

    if v_party_archived is not null and not v_is_restore then
      raise exception 'SHR154_OWNERSHIP_TO_ARCHIVED_PARTY_FORBIDDEN' using errcode = '55000';
    end if;

    select p2.household_id into v_other_household
      from public.accounts a2
      join public.economic_parties p2 on p2.party_id = a2.owner_party_id
     where a2.owner_party_id is not null
       and a2.id <> new.id
     limit 1;

    if v_other_household is not null and v_other_household <> v_party_household then
      raise exception 'SHR154_OWNERSHIP_CROSS_HOUSEHOLD_FORBIDDEN' using errcode = '55000';
    end if;
  end if;

  return new;
end;
$$;

comment on function private.guard_account_ownership_reference() is
  'SHR-154 account ownership boundary. Ordinary account writes that do not touch ownership take a fast path and are untouched, including edits to the legacy owner text. Ownership assignment requires the operator authority, cannot regress to unreconciled, fails closed on an archived party except through the explicit per-row restore token, and cannot reference a party in another economic household.';

drop trigger if exists accounts_ownership_reference_guard on public.accounts;
create trigger accounts_ownership_reference_guard
before insert or update on public.accounts
for each row execute function private.guard_account_ownership_reference();

-- The one sanctioned way to reproduce an account owned by an already-archived
-- party. SECURITY INVOKER so the operator check is real; executable by no API
-- role; single-use and bound to one account id; honoured on INSERT only. It is
-- not, and must not become, the ownership writer: new decisions go through
-- private.set_account_ownership_v1(), which refuses to run when this token is
-- set at all.
create or replace function private.begin_account_ownership_restore_v1(p_account_id uuid)
returns void
language plpgsql
volatile
security invoker
set search_path = ''
as $$
begin
  if not private.economic_identity_operator_authority() then
    raise exception 'SHR154_RESTORE_FORBIDDEN' using errcode = '42501';
  end if;
  if p_account_id is null then
    raise exception 'SHR154_RESTORE_REQUIRES_ACCOUNT_ID' using errcode = '22023';
  end if;
  perform pg_catalog.set_config('shr154.restore_account_id', p_account_id::text, true);
end;
$$;

comment on function private.begin_account_ownership_restore_v1(uuid) is
  'SHR-154 restore-only boundary. Operator authority, invoker-mode, uncallable by any API role. Issues a single-use token bound to one account id that lets exactly one INSERT re-import an account already owned by an archived party. Every other structural rule still applies, and no ordinary ownership decision may run while it is set.';

-- ── 4. Read-only preflight ───────────────────────────────────────────────
--
-- Everything here is STABLE and reads only. Nothing writes a row and nothing
-- decides anything: the preflight exists so a human can approve a manifest
-- against proven facts, and so the release path can refuse to run against
-- different ones.
--
-- The digest covers the exact ownership evidence a manifest is approved
-- against — every account, its current stable ownership and the legacy owner
-- label a human would have read while deciding. An account added, removed,
-- relabelled or already reconciled all move the digest and fail the release
-- closed. The label is hashed evidence only: it is never stored in a run
-- record, never an ownership key, and never returned to any API role.

create or replace function private.account_ownership_digest_v1()
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
                    a.id::text || '|' || a.ownership_kind || '|'
                      || coalesce(a.owner_party_id::text, '') || '|' || coalesce(a.owner, ''),
                    pg_catalog.chr(10) order by a.id)
             from public.accounts a),
          ''),
        'UTF8'),
      'sha256'),
    'hex')
$$;

comment on function private.account_ownership_digest_v1() is
  'SHR-154 read-only digest over the exact current account ownership evidence (account id, stable ownership, and the legacy owner label a reviewer read). Operator-only. Any change moves the digest, which is what makes a stale manifest fail closed.';

create or replace function private.account_ownership_preflight_v1()
returns table (
  observed_at timestamptz,
  account_count integer,
  unreconciled_account_count integer,
  personal_account_count integer,
  household_account_count integer,
  account_state_digest text,
  economic_household_count integer,
  economic_party_count integer,
  active_economic_party_count integer,
  ownership_decision_count integer,
  reconciliation_run_count integer
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    pg_catalog.now(),
    (select pg_catalog.count(*)::integer from public.accounts),
    (select pg_catalog.count(*)::integer from public.accounts where ownership_kind = 'unreconciled'),
    (select pg_catalog.count(*)::integer from public.accounts where ownership_kind = 'personal'),
    (select pg_catalog.count(*)::integer from public.accounts where ownership_kind = 'household'),
    private.account_ownership_digest_v1(),
    (select pg_catalog.count(*)::integer from public.economic_households),
    (select pg_catalog.count(*)::integer from public.economic_parties),
    (select pg_catalog.count(*)::integer from public.economic_parties where archived_at is null),
    (select pg_catalog.count(*)::integer from public.account_ownership_history),
    (select pg_catalog.count(*)::integer from public.account_ownership_reconciliation_runs)
$$;

comment on function private.account_ownership_preflight_v1() is
  'SHR-154 release-time read-only preflight. Returns the exact current account-ownership and economic-identity state a manifest must be approved against. It writes nothing and decides nothing.';

create or replace function private.account_ownership_roster_v1()
returns table (
  account_id uuid,
  account_name text,
  legacy_owner_label text,
  account_type text,
  is_liability boolean,
  currency text,
  ownership_kind text,
  owner_party_id uuid,
  owner_party_display_name text,
  owner_party_archived_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    a.id, a.name, a.owner, a.type, a.is_liability, a.currency,
    a.ownership_kind, a.owner_party_id, p.display_name, p.archived_at
  from public.accounts a
  left join public.economic_parties p on p.party_id = a.owner_party_id
  order by a.id
$$;

comment on function private.account_ownership_roster_v1() is
  'SHR-154 read-only per-account evidence for building an approvable manifest. Operator-only, because it returns account names and legacy owner labels. It proposes nothing: no ownership is inferred from any value it returns, and the legacy label in particular is evidence for a human to read, never an input to a decision.';

-- ── 5. The ownership writer ──────────────────────────────────────────────
--
-- One function makes every ownership decision, and it is reachable only by the
-- operator authority. There is no product API here on purpose: SHR-154's scope
-- is the reference foundation and the reviewed reconciliation, not an ongoing
-- "change this account's owner" feature. SHR-158 owns the Settings household
-- surface, and the mutation contract it needs is its own to define and review.
--
-- On audit: this migration deliberately writes no audit_events row and changes
-- no SHR-191/194 audit constraint, function or allowlist. SHR-194's issue
-- explicitly required its mapping changes to be audited; SHR-154's does not,
-- and audit_events is minimized action evidence rather than domain state. The
-- durable evidence for an ownership decision is the append-only history row and
-- run record above. Widening 045/048's typed policy for a release-time operator
-- action that no API role can reach would be widening a reviewed constraint
-- without a contract requiring it. This is flagged explicitly for the
-- independent reviewer rather than decided silently.

create or replace function private.set_account_ownership_v1(
  p_account_id uuid,
  p_ownership_kind text,
  p_owner_party_id uuid default null,
  p_economic_household_id uuid default null,
  p_decision_evidence_ref text default null,
  p_acting_access_user_id uuid default null
)
returns table (
  account_id uuid,
  decision_version integer,
  action_code text,
  changed boolean
)
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_existing public.accounts%rowtype;
  v_party_household uuid;
  v_action text;
  v_version integer;
begin
  if not private.economic_identity_operator_authority() then
    raise exception 'SHR154_OWNERSHIP_DECISION_FORBIDDEN' using errcode = '42501';
  end if;

  -- A decision being made now has no business riding the restore boundary,
  -- which exists to re-import a decision that already happened.
  if nullif(pg_catalog.current_setting('shr154.restore_account_id', true), '') is not null then
    raise exception 'SHR154_RESTORE_TOKEN_SET_ON_ORDINARY_DECISION' using errcode = '55000';
  end if;

  if p_account_id is null then
    raise exception 'SHR154_OWNERSHIP_SUBJECT_REQUIRED' using errcode = '22023';
  end if;
  -- 'unreconciled' is the absence of a decision, so it is not something this
  -- function can be asked to decide.
  if p_ownership_kind is null or p_ownership_kind not in ('personal', 'household') then
    raise exception 'SHR154_OWNERSHIP_KIND_NOT_ALLOWED: %', coalesce(p_ownership_kind, '<null>')
      using errcode = '22023';
  end if;
  if p_ownership_kind = 'personal' and p_owner_party_id is null then
    raise exception 'SHR154_PERSONAL_OWNERSHIP_REQUIRES_PARTY' using errcode = '22023';
  end if;
  -- Shared ownership is one fact about the household, never a party fact and
  -- never a set of party facts.
  if p_ownership_kind = 'household' and p_owner_party_id is not null then
    raise exception 'SHR154_HOUSEHOLD_OWNERSHIP_FORBIDS_PARTY' using errcode = '22023';
  end if;
  if p_economic_household_id is null then
    raise exception 'SHR154_OWNERSHIP_REQUIRES_ECONOMIC_HOUSEHOLD' using errcode = '22023';
  end if;
  if not exists (select 1 from public.economic_households h
                  where h.household_id = p_economic_household_id) then
    raise exception 'SHR154_ECONOMIC_HOUSEHOLD_UNKNOWN' using errcode = '23503';
  end if;
  if p_decision_evidence_ref is not null and btrim(p_decision_evidence_ref) = '' then
    raise exception 'SHR154_OWNERSHIP_EVIDENCE_REF_INVALID' using errcode = '22023';
  end if;

  if p_owner_party_id is not null then
    select p.household_id into v_party_household
      from public.economic_parties p
     where p.party_id = p_owner_party_id;
    if not found then
      raise exception 'SHR154_OWNERSHIP_PARTY_UNKNOWN' using errcode = '23503';
    end if;
    -- The manifest names its economic household explicitly, so a party from a
    -- different one is a manifest error, caught before any write.
    if v_party_household <> p_economic_household_id then
      raise exception 'SHR154_OWNERSHIP_CROSS_HOUSEHOLD_FORBIDDEN' using errcode = '55000';
    end if;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_account_id::text, 154));

  select a.* into v_existing
    from public.accounts a
   where a.id = p_account_id
   for update;
  if not found then
    raise exception 'SHR154_ACCOUNT_UNKNOWN: %', p_account_id using errcode = '23503';
  end if;

  -- Applying a decision already exactly in force is an explicit no-op: no
  -- history row, no run-visible change, nothing to replay.
  if v_existing.ownership_kind = p_ownership_kind
     and v_existing.owner_party_id is not distinct from p_owner_party_id then
    return query
      select v_existing.id,
             coalesce((select pg_catalog.max(h.decision_version)
                         from public.account_ownership_history h
                        where h.account_id = v_existing.id), 0),
             'account.ownership.unchanged'::text,
             false;
    return;
  end if;

  v_action := case
    when v_existing.ownership_kind = 'unreconciled' then 'account.ownership.assigned'
    else 'account.ownership.changed'
  end;

  -- Only the two ownership columns are written. updated_at is deliberately left
  -- alone: v_canonical_accounts_aed derives valuation freshness from it, and an
  -- ownership decision is not a revaluation.
  update public.accounts a
     set ownership_kind = p_ownership_kind,
         owner_party_id = p_owner_party_id
   where a.id = v_existing.id;

  select coalesce(pg_catalog.max(h.decision_version), 0) + 1 into v_version
    from public.account_ownership_history h
   where h.account_id = v_existing.id;

  insert into public.account_ownership_history (
    account_id, decision_version, action_code,
    previous_ownership_kind, new_ownership_kind,
    previous_owner_party_id, new_owner_party_id,
    economic_household_id, decided_by_access_user_id, decision_evidence_ref
  ) values (
    v_existing.id, v_version, v_action,
    v_existing.ownership_kind, p_ownership_kind,
    v_existing.owner_party_id, p_owner_party_id,
    p_economic_household_id, p_acting_access_user_id,
    nullif(btrim(coalesce(p_decision_evidence_ref, '')), '')
  );

  return query select v_existing.id, v_version, v_action, true;
end;
$$;

comment on function private.set_account_ownership_v1(uuid, text, uuid, uuid, text, uuid) is
  'SHR-154 account ownership writer. Operator authority, invoker-mode, executable by no API role. Writes only the two ownership columns — never updated_at, never a value, never the legacy owner text — records an immutable history row, refuses an archived party and a cross-household party, and treats a decision already exactly in force as an explicit no-op.';

-- ── 6. The evidence-gated reconciliation path ────────────────────────────
--
-- One transactional entry point for applying an approved manifest. Every fact
-- it acts on is supplied explicitly, and it infers nothing whatsoever. In
-- particular it never reads accounts.owner, an account name, a transaction, a
-- category, a goal, a Telegram identity or any historical percentage to decide
-- who owns anything.
--
-- Order is the safety property. The manifest replay check and the whole
-- preflight comparison happen before the first write, so a stale count, changed
-- ownership evidence or an unexpected reconciliation state aborts with nothing
-- applied. Everything after that is one transaction: either every assignment,
-- every history row and the run record commit, or none do.
--
--   p_assignments  jsonb array of
--                  {account_id, ownership_kind, owner_party_id?, evidence_ref?}
--
-- Coverage is exhaustive by contract: every current account needs exactly one
-- explicit decision, and no decision may name an account that does not exist.
-- That is what stops an account being silently left unreconciled by an
-- incomplete manifest, and what makes a duplicate decision a hard failure
-- rather than a last-write-wins race.

create or replace function private.reconcile_account_ownership_v1(
  p_manifest_ref text,
  p_expected_account_count integer,
  p_expected_account_state_digest text,
  p_expected_unreconciled_account_count integer,
  p_expected_reconciliation_run_count integer,
  p_economic_household_id uuid,
  p_assignments jsonb,
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
  v_existing_run public.account_ownership_reconciliation_runs%rowtype;
  v_manifest_digest text;
  v_assignment jsonb;
  v_account_ids uuid[] := '{}'::uuid[];
  v_all_ids uuid[];
  v_result jsonb := '[]'::jsonb;
  v_written record;
  v_kind text;
  v_party uuid;
begin
  if not private.economic_identity_operator_authority() then
    raise exception 'SHR154_RECONCILE_FORBIDDEN' using errcode = '42501';
  end if;
  if p_manifest_ref is null or btrim(p_manifest_ref) = '' then
    raise exception 'SHR154_MANIFEST_REF_REQUIRED' using errcode = '22023';
  end if;
  if p_assignments is null or jsonb_typeof(p_assignments) <> 'array' then
    raise exception 'SHR154_MANIFEST_SHAPE_INVALID' using errcode = '22023';
  end if;
  if p_economic_household_id is null then
    raise exception 'SHR154_MANIFEST_HOUSEHOLD_REQUIRED' using errcode = '22023';
  end if;
  if p_expected_account_count is null
     or p_expected_account_state_digest is null
     or p_expected_unreconciled_account_count is null
     or p_expected_reconciliation_run_count is null then
    raise exception 'SHR154_PREFLIGHT_EXPECTATIONS_REQUIRED' using errcode = '22023';
  end if;

  v_manifest_digest := 'sha256:' || pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        btrim(p_manifest_ref) || pg_catalog.chr(10)
        || p_economic_household_id::text || pg_catalog.chr(10)
        || p_assignments::text,
        'UTF8'),
      'sha256'),
    'hex');

  -- Replay before anything else: an already-applied manifest performs no DML at
  -- all, and the same reference carrying different content is a hard conflict
  -- rather than a second, silently different application.
  select r.* into v_existing_run
    from public.account_ownership_reconciliation_runs r
   where r.manifest_ref = btrim(p_manifest_ref);
  if found then
    if v_existing_run.manifest_digest <> v_manifest_digest then
      raise exception 'SHR154_MANIFEST_CONFLICT' using errcode = '23505';
    end if;
    return jsonb_build_object(
      'replayed', true,
      'run_id', v_existing_run.run_id,
      'manifest_ref', v_existing_run.manifest_ref,
      'economic_household_id', v_existing_run.economic_household_id,
      'assignment_count', v_existing_run.assignment_count,
      'assignments', '[]'::jsonb
    );
  end if;

  -- ── Preflight. Nothing below this block has written anything yet. ──
  select * into v_pre from private.account_ownership_preflight_v1();

  if v_pre.account_count <> p_expected_account_count then
    raise exception
      'SHR154_PREFLIGHT_ACCOUNT_COUNT_STALE: manifest approved against % accounts, database has %',
      p_expected_account_count, v_pre.account_count
      using errcode = '55000';
  end if;
  if v_pre.account_state_digest <> p_expected_account_state_digest then
    raise exception
      'SHR154_PREFLIGHT_OWNERSHIP_STALE: account ownership evidence has changed since the manifest was approved'
      using errcode = '55000';
  end if;
  if v_pre.unreconciled_account_count <> p_expected_unreconciled_account_count
     or v_pre.reconciliation_run_count <> p_expected_reconciliation_run_count then
    raise exception
      'SHR154_PREFLIGHT_RECONCILIATION_STATE_STALE: expected %/% unreconciled accounts/runs, database has %/%',
      p_expected_unreconciled_account_count, p_expected_reconciliation_run_count,
      v_pre.unreconciled_account_count, v_pre.reconciliation_run_count
      using errcode = '55000';
  end if;

  if not exists (select 1 from public.economic_households h
                  where h.household_id = p_economic_household_id) then
    raise exception 'SHR154_MANIFEST_HOUSEHOLD_UNKNOWN' using errcode = '23503';
  end if;

  -- Exhaustive, duplicate-free coverage of the exact current account set.
  for v_assignment in select * from jsonb_array_elements(p_assignments) loop
    if v_assignment ->> 'account_id' is null then
      raise exception 'SHR154_MANIFEST_ASSIGNMENT_REQUIRES_ACCOUNT' using errcode = '22023';
    end if;
    if (v_assignment ->> 'account_id')::uuid = any (v_account_ids) then
      raise exception 'SHR154_MANIFEST_DUPLICATE_ACCOUNT: %', v_assignment ->> 'account_id'
        using errcode = '22023';
    end if;
    v_account_ids := v_account_ids || (v_assignment ->> 'account_id')::uuid;
  end loop;

  select pg_catalog.array_agg(x order by x) into v_account_ids from unnest(v_account_ids) x;
  v_account_ids := coalesce(v_account_ids, '{}'::uuid[]);

  select coalesce(pg_catalog.array_agg(a.id order by a.id), '{}'::uuid[])
    into v_all_ids from public.accounts a;

  if v_account_ids <> v_all_ids then
    raise exception
      'SHR154_MANIFEST_ASSIGNMENTS_DO_NOT_COVER_ACCOUNTS: every current account needs exactly one explicit decision'
      using errcode = '22023';
  end if;

  -- ── Applying. From here on it is one transaction or nothing. ──
  for v_assignment in select * from jsonb_array_elements(p_assignments) loop
    v_kind := v_assignment ->> 'ownership_kind';
    v_party := nullif(v_assignment ->> 'owner_party_id', '')::uuid;

    select * into v_written from private.set_account_ownership_v1(
      (v_assignment ->> 'account_id')::uuid,
      v_kind,
      v_party,
      p_economic_household_id,
      coalesce(v_assignment ->> 'evidence_ref', btrim(p_manifest_ref)),
      p_acting_access_user_id
    );

    v_result := v_result || jsonb_build_object(
      'account_id', v_written.account_id,
      'ownership_kind', v_kind,
      'owner_party_id', v_party,
      'decision_version', v_written.decision_version,
      'action_code', v_written.action_code,
      'changed', v_written.changed
    );
  end loop;

  insert into public.account_ownership_reconciliation_runs (
    manifest_ref, manifest_digest, account_state_digest, account_count,
    economic_household_id, assignment_count, applied_by_access_user_id
  ) values (
    btrim(p_manifest_ref), v_manifest_digest, v_pre.account_state_digest,
    v_pre.account_count, p_economic_household_id,
    jsonb_array_length(p_assignments), p_acting_access_user_id
  );

  return jsonb_build_object(
    'replayed', false,
    'manifest_ref', btrim(p_manifest_ref),
    'economic_household_id', p_economic_household_id,
    'assignment_count', jsonb_array_length(p_assignments),
    'assignments', v_result
  );
end;
$$;

comment on function private.reconcile_account_ownership_v1(
  text, integer, text, integer, integer, uuid, jsonb, uuid) is
  'SHR-154 transactional, evidence-gated reconciliation of an approved account-ownership manifest. Operator authority, executable by no API role. Preflight and replay checks complete before the first write, so stale counts or stale ownership evidence abort with zero DML; application is one transaction, so partial application is not representable. Nothing is inferred: every assignment is explicit, and no legacy owner label, account name, transaction or historical percentage is consulted.';

-- ── 7. The V2 read adapter ───────────────────────────────────────────────
--
-- Additive read surfaces that expose the stable reference beside the legacy
-- label. Nothing consumes them yet, and that is the point: SHR-154 installs the
-- substrate and the adapter, and the consumer cutovers belong to SHR-173
-- (wealth scope), SHR-153 (Overview), SHR-172 (valuation) and SHR-158
-- (Settings). public.canonical_balance_sheet() and every other v1 contract is
-- byte-for-byte unchanged.

create or replace view public.v_account_ownership_v2
with (security_invoker = true)
as
select
  a.id as account_id,
  a.name as account_name,
  a.owner as legacy_owner_label,
  a.ownership_kind,
  a.owner_party_id,
  p.household_id as economic_household_id,
  p.display_name as owner_party_display_name,
  p.archived_at as owner_party_archived_at,
  (a.ownership_kind <> 'unreconciled') as is_reconciled
from public.accounts a
left join public.economic_parties p on p.party_id = a.owner_party_id;

comment on view public.v_account_ownership_v2 is
  'SHR-154 account ownership read adapter. Exposes the stable reference (ownership_kind, owner_party_id) beside the legacy owner label, and resolves the party display name for presentation only — including for an archived party, which stays fully readable. Authorization is the accounts table''s own household policy; this view adds none and is security_invoker.';

-- The wealth adapter. It performs no valuation arithmetic of its own: every
-- amount comes from v_canonical_accounts_aed exactly as canonical_balance_sheet
-- already computes it, and the household scope is asserted in tests to be
-- identical to v1's.
--
-- The scope semantics are the whole reason this exists:
--
--   household — every account, each counted exactly once. A shared account is
--               one row and contributes once; a personal account contributes
--               once. This is the "Both" total and it is not a sum of party
--               scopes.
--   party     — ONLY accounts explicitly owned by that economic party.
--               A shared/household account is NOT allocated into it — not
--               50/50, not 69/31, not at all — and an unreconciled account is
--               not guessed into it either. Both are reported as counts so the
--               number is honest about what it excludes rather than silently
--               understating a person's position.

create or replace function public.canonical_balance_sheet_v2(
  p_scope text default 'household',
  p_owner_party_id uuid default null
)
returns table (
  scope text,
  owner_party_id uuid,
  assets_aed numeric,
  liabilities_aed numeric,
  net_worth_aed numeric,
  quality_status text,
  incomplete_account_count bigint,
  provisional_account_count bigint,
  missing_fx_count bigint,
  scoped_account_count bigint,
  shared_account_count bigint,
  unreconciled_account_count bigint,
  ownership_coverage_status text,
  quality_metadata jsonb
)
language sql
stable
security invoker
set search_path = ''
as $$
with owned as (
  select v.*, a.ownership_kind, a.owner_party_id as stable_owner_party_id
  from public.v_canonical_accounts_aed v
  join public.accounts a on a.id = v.id
), coverage as (
  select
    pg_catalog.count(*) filter (where ownership_kind = 'household') as shared_count,
    pg_catalog.count(*) filter (where ownership_kind = 'unreconciled') as unreconciled_count
  from owned
), scoped as (
  select o.*
  from owned o
  where p_scope = 'household'
     or (p_scope = 'party'
         and o.ownership_kind = 'personal'
         and o.stable_owner_party_id = p_owner_party_id)
), agg as (
  select
    coalesce(sum(canonical_value_aed) filter (where not is_liability), 0) as assets_raw,
    coalesce(sum(canonical_value_aed) filter (where is_liability), 0) as liabilities_raw,
    count(*) as scoped_count,
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
  p_owner_party_id,
  case when a.incomplete_count = 0 then round(a.assets_raw, 2) end,
  case when a.incomplete_count = 0 then round(a.liabilities_raw, 2) end,
  case when a.incomplete_count = 0 then round(a.assets_raw, 2) - round(a.liabilities_raw, 2) end,
  case when a.incomplete_count > 0 then 'incomplete' when a.provisional_count > 0 then 'provisional' else 'complete' end,
  a.incomplete_count,
  a.provisional_count,
  a.missing_fx_count,
  a.scoped_count,
  c.shared_count,
  c.unreconciled_count,
  case when c.unreconciled_count > 0 then 'unreconciled_accounts_present' else 'complete' end,
  jsonb_build_object(
    'fx_basis', 'current_rate_aed',
    'fx_updated_at', a.fx_updated_at,
    'missing_fx_currencies', a.missing_fx_currencies,
    'negative_value_count', a.negative_value_count,
    'liability_type_mismatch_count', a.type_mismatch_count,
    'manual_valuation_count', a.manual_valuation_count,
    'classification_version', 'shr-111-phase-a-v1',
    'ownership_contract_version', 'shr-154-ownership-v2',
    'shared_accounts_counted_once', true,
    'fractional_allocation', 'none'
  )
from agg a cross join coverage c
where p_scope in ('household', 'party')
  and (p_scope = 'household') = (p_owner_party_id is null)
  and exists (select 1 from public.household_members);
$$;

comment on function public.canonical_balance_sheet_v2(text, uuid) is
  'SHR-154 stable-ownership wealth adapter. Reuses v_canonical_accounts_aed for every amount and adds no valuation math. Household scope counts each account exactly once and equals canonical_balance_sheet(''household''). Party scope contains only explicitly personal accounts: a shared account is never allocated into it and an unreconciled account is never guessed into it — both are reported as counts instead.';

-- ── 8. RLS and least-privilege ACLs ──────────────────────────────────────
--
-- Authorization is unchanged, and that is the load-bearing claim of this
-- package. private.is_household_member() remains the only predicate; no policy
-- on any existing table — accounts included — is created, dropped or altered
-- here; no role is created; and account ownership appears in no authorization
-- predicate anywhere. Owning an account grants nothing, and not owning one
-- takes nothing away: every household member still reads and writes every
-- account exactly as before.
--
-- Write capability on the new evidence tables is granted to no API role. Every
-- writer lives in private, is invoker-mode, checks the operator authority
-- itself, and is executable by nobody but the migration/operator authority — so
-- a browser session or an Edge Function cannot reach an ownership decision even
-- if a policy were misconfigured, because Postgres refuses the command before
-- RLS is consulted.

alter table public.account_ownership_history enable row level security;
alter table public.account_ownership_reconciliation_runs enable row level security;

-- Ownership history is household-readable on exactly the same terms as the
-- accounts it describes: it holds the same class of information, and members
-- already read every account row.
drop policy if exists "household read account ownership history"
  on public.account_ownership_history;
create policy "household read account ownership history"
  on public.account_ownership_history
  for select to authenticated
  using ((select private.is_household_member()));

-- Run records are operator/release evidence rather than household record: they
-- carry manifest references and state digests and answer no product question.
-- They follow the audit_events and SHR-194 pattern — no API read at all, and
-- only the raw read the encrypted backup exporter needs.
drop policy if exists "account ownership runs deny raw api access"
  on public.account_ownership_reconciliation_runs;
create policy "account ownership runs deny raw api access"
  on public.account_ownership_reconciliation_runs
  for all to anon, authenticated
  using (false)
  with check (false);

revoke all on table public.account_ownership_history
  from public, anon, authenticated, service_role;
revoke all on table public.account_ownership_reconciliation_runs
  from public, anon, authenticated, service_role;

grant select on table public.account_ownership_history to authenticated, service_role;
grant select on table public.account_ownership_reconciliation_runs to service_role;

revoke all on table public.v_account_ownership_v2
  from public, anon, authenticated, service_role;
grant select on table public.v_account_ownership_v2 to authenticated, service_role;

-- Trigger functions are fired by the trigger machinery, which does not consult
-- EXECUTE, so revoking it everywhere leaves the guards working while making
-- them uncallable. Every SHR-154 writer, preflight and roster function is
-- revoked for the same least-privilege reason: the operator reaches them
-- through the database owner, and no API role has any business calling them.
-- The roster function in particular returns account names and legacy owner
-- labels and must never be reachable from a browser.
revoke all on function
  private.reject_account_ownership_evidence_mutation(),
  private.reject_account_ownership_evidence_truncate(),
  private.guard_account_ownership_reference(),
  private.begin_account_ownership_restore_v1(uuid),
  private.account_ownership_digest_v1(),
  private.account_ownership_preflight_v1(),
  private.account_ownership_roster_v1(),
  private.set_account_ownership_v1(uuid, text, uuid, uuid, text, uuid),
  private.reconcile_account_ownership_v1(text, integer, text, integer, integer, uuid, jsonb, uuid)
  from public, anon, authenticated, service_role;

-- The wealth adapter is the one product-facing surface this package adds, and
-- it is a read. It is granted exactly what canonical_balance_sheet() already
-- has, and nothing more.
revoke all on function public.canonical_balance_sheet_v2(text, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.canonical_balance_sheet_v2(text, uuid)
  to authenticated, service_role;

commit;

-- Production is deliberately NOT APPLIED by this implementation task, and no
-- manifest exists. Applying 049 creates no ownership fact whatsoever: every
-- account arrives unreconciled and stays that way until a human approves an
-- account-ownership manifest through the procedure in
-- docs/data-ops/shr-154-account-ownership-manifest.md. That manifest depends in
-- turn on SHR-194's access-to-party manifest, which is also still unapproved —
-- there are no economic parties in production for an account to reference.
