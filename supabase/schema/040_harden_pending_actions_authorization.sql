-- 040_harden_pending_actions_authorization.sql — SHR-110
--
-- pending_actions is a server-side Telegram coordination and audit table.
-- Browser identities have no direct table or RPC access. The Edge Function
-- may read rows with service_role, but every create/bind/claim/terminal write
-- goes through a narrowly scoped SECURITY DEFINER function so there is no
-- parallel REST PATCH path around the identity, expiry, and state predicates.

begin;

-- Migration 037 was applied directly to production from the historical v41
-- branch and is absent from current main. Re-declaring its exact base shape
-- with IF NOT EXISTS repairs clean-environment reproducibility without
-- rewriting that applied migration or touching an existing row.
create table if not exists public.pending_actions (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  payload jsonb not null,
  chat_id bigint not null,
  prompt_msg_id bigint,
  requested_by bigint not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '1 hour',
  resolved_at timestamptz,
  resolution text constraint pending_actions_resolution_check
    check (resolution in ('applied', 'cancelled', 'expired'))
);

alter table public.pending_actions
  add column if not exists request_key text,
  add column if not exists claimed_at timestamptz,
  add column if not exists claimed_by bigint;

-- Existing data is never rewritten to manufacture authorization/audit facts.
-- Production was empty during investigation. If an old writer creates rows
-- before deployment, stop visibly and reconcile them under separate review.
do $$
begin
  if exists (
    select 1
    from public.pending_actions as pa
    where pa.request_key is null
       or btrim(pa.request_key) = ''
       or pa.expires_at <= pa.created_at
       or (pa.resolved_at is null) <> (pa.resolution is null)
       or (pa.claimed_at is null) <> (pa.claimed_by is null)
       or (pa.resolution = 'applied' and pa.claimed_at is null)
       or (pa.resolution in ('cancelled', 'expired') and pa.claimed_at is not null)
       or (pa.claimed_by is not null and pa.claimed_by <> pa.requested_by)
       or (pa.prompt_msg_id is not null and pa.prompt_msg_id <= 0)
  ) then
    raise exception 'pending_actions contains rows incompatible with SHR-110; no rows were changed';
  end if;
end;
$$;

alter table public.pending_actions
  alter column request_key set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.pending_actions'::regclass
      and conname = 'pending_actions_resolution_check'
  ) then
    alter table public.pending_actions
      add constraint pending_actions_resolution_check
      check (resolution in ('applied', 'cancelled', 'expired'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.pending_actions'::regclass
      and conname = 'pending_actions_request_key_check'
  ) then
    alter table public.pending_actions
      add constraint pending_actions_request_key_check
      check (btrim(request_key) <> '');
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.pending_actions'::regclass
      and conname = 'pending_actions_identity_check'
  ) then
    alter table public.pending_actions
      add constraint pending_actions_identity_check
      check (chat_id <> 0 and requested_by > 0 and (prompt_msg_id is null or prompt_msg_id > 0));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.pending_actions'::regclass
      and conname = 'pending_actions_expiry_check'
  ) then
    alter table public.pending_actions
      add constraint pending_actions_expiry_check
      check (expires_at > created_at);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.pending_actions'::regclass
      and conname = 'pending_actions_state_check'
  ) then
    alter table public.pending_actions
      add constraint pending_actions_state_check
      check (
        ((resolved_at is null) = (resolution is null))
        and ((claimed_at is null) = (claimed_by is null))
        and (claimed_by is null or claimed_by = requested_by)
        and (resolution is distinct from 'applied' or claimed_at is not null)
        and (resolution is null or resolution = 'applied' or claimed_at is null)
      );
  end if;
end;
$$;

create index if not exists pending_actions_open_idx
  on public.pending_actions (chat_id, created_at desc)
  where resolved_at is null;

create unique index if not exists pending_actions_request_key_uidx
  on public.pending_actions (request_key);

alter table public.pending_actions enable row level security;

-- This is intentionally a policy-free, default-deny table for browser roles.
-- Remove the historical blanket policy and any unexpected policy created
-- under another name so a service-only table cannot regain browser access.
do $$
declare
  policy_name text;
begin
  for policy_name in
    select pol.polname
    from pg_policy as pol
    where pol.polrelid = 'public.pending_actions'::regclass
  loop
    execute format('drop policy %I on public.pending_actions', policy_name);
  end loop;
end;
$$;

revoke all on table public.pending_actions
  from public, anon, authenticated, service_role;
grant select on table public.pending_actions to service_role;

-- Idempotent proposal creation. A repeated Telegram message returns the one
-- existing row only when every immutable proposal field is identical.
create or replace function public.create_pending_action(
  p_kind text,
  p_payload jsonb,
  p_chat_id bigint,
  p_requested_by bigint,
  p_request_key text
)
returns setof public.pending_actions
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  action_row public.pending_actions%rowtype;
begin
  if p_kind is null or btrim(p_kind) = ''
     or p_payload is null
     or p_chat_id is null or p_chat_id = 0
     or p_requested_by is null or p_requested_by <= 0
     or p_request_key is null or btrim(p_request_key) = '' then
    raise exception using
      errcode = '22023',
      message = 'invalid pending action proposal';
  end if;

  insert into public.pending_actions (
    kind, payload, chat_id, requested_by, request_key
  ) values (
    p_kind, p_payload, p_chat_id, p_requested_by, p_request_key
  )
  on conflict (request_key) do nothing
  returning * into action_row;

  if action_row.id is null then
    select pa.*
    into action_row
    from public.pending_actions as pa
    where pa.request_key = p_request_key;

    if action_row.id is null then
      raise exception 'pending action request-key conflict could not be read';
    end if;

    if action_row.kind is distinct from p_kind
       or action_row.payload is distinct from p_payload
       or action_row.chat_id is distinct from p_chat_id
       or action_row.requested_by is distinct from p_requested_by then
      raise exception using
        errcode = '23505',
        message = 'pending action request key already belongs to a different proposal';
    end if;
  end if;

  return next action_row;
  return;
end;
$$;

-- The Telegram prompt is identity-bearing state: bind it exactly once while
-- the proposal is still open and unexpired. It cannot be overwritten by a
-- direct service-role PATCH because service_role has no UPDATE grant.
create or replace function public.bind_pending_action_prompt(
  p_id uuid,
  p_requested_by bigint,
  p_chat_id bigint,
  p_prompt_msg_id bigint
)
returns setof public.pending_actions
language sql
volatile
security definer
set search_path = ''
as $$
  update public.pending_actions as pa
  set prompt_msg_id = p_prompt_msg_id
  where pa.id = p_id
    and p_prompt_msg_id > 0
    and pa.requested_by = p_requested_by
    and pa.chat_id = p_chat_id
    and pa.prompt_msg_id is null
    and pa.claimed_at is null
    and pa.resolved_at is null
    and now() < pa.expires_at
  returning pa.*
$$;

-- Claim is the only gate into a financial handler. Requester, chat, prompt,
-- state, and [created_at, expires_at) validity are checked in one UPDATE.
create or replace function public.claim_pending_action(
  p_id uuid,
  p_requested_by bigint,
  p_chat_id bigint,
  p_prompt_msg_id bigint
)
returns setof public.pending_actions
language sql
volatile
security definer
set search_path = ''
as $$
  update public.pending_actions as pa
  set claimed_at = now(),
      claimed_by = p_requested_by
  where pa.id = p_id
    and pa.requested_by = p_requested_by
    and pa.chat_id = p_chat_id
    and pa.prompt_msg_id = p_prompt_msg_id
    and pa.claimed_at is null
    and pa.resolved_at is null
    and now() < pa.expires_at
  returning pa.*
$$;

-- Applied is written only after the handler reports success. Expiry is not
-- re-checked here: the successful claim established eligibility, and a slow
-- handler must still be auditable as applied after it completes.
create or replace function public.apply_pending_action(
  p_id uuid,
  p_requested_by bigint,
  p_chat_id bigint,
  p_prompt_msg_id bigint
)
returns setof public.pending_actions
language sql
volatile
security definer
set search_path = ''
as $$
  update public.pending_actions as pa
  set resolved_at = now(),
      resolution = 'applied'
  where pa.id = p_id
    and pa.requested_by = p_requested_by
    and pa.chat_id = p_chat_id
    and pa.prompt_msg_id = p_prompt_msg_id
    and pa.claimed_at is not null
    and pa.claimed_by = p_requested_by
    and pa.resolved_at is null
  returning pa.*
$$;

create or replace function public.cancel_pending_action(
  p_id uuid,
  p_requested_by bigint,
  p_chat_id bigint,
  p_prompt_msg_id bigint
)
returns setof public.pending_actions
language sql
volatile
security definer
set search_path = ''
as $$
  update public.pending_actions as pa
  set resolved_at = now(),
      resolution = 'cancelled'
  where pa.id = p_id
    and pa.requested_by = p_requested_by
    and pa.chat_id = p_chat_id
    and pa.prompt_msg_id = p_prompt_msg_id
    and pa.claimed_at is null
    and pa.resolved_at is null
    and now() < pa.expires_at
  returning pa.*
$$;

create or replace function public.expire_pending_action(
  p_id uuid,
  p_requested_by bigint,
  p_chat_id bigint,
  p_prompt_msg_id bigint
)
returns setof public.pending_actions
language sql
volatile
security definer
set search_path = ''
as $$
  update public.pending_actions as pa
  set resolved_at = now(),
      resolution = 'expired'
  where pa.id = p_id
    and pa.requested_by = p_requested_by
    and pa.chat_id = p_chat_id
    and pa.prompt_msg_id = p_prompt_msg_id
    and pa.claimed_at is null
    and pa.resolved_at is null
    and now() >= pa.expires_at
  returning pa.*
$$;

-- New public functions inherit EXECUTE for PUBLIC unless explicitly revoked.
-- Keep this PostgREST surface reachable only with the server-side service key.
revoke all on function public.create_pending_action(text, jsonb, bigint, bigint, text)
  from public, anon, authenticated, service_role;
revoke all on function public.bind_pending_action_prompt(uuid, bigint, bigint, bigint)
  from public, anon, authenticated, service_role;
revoke all on function public.claim_pending_action(uuid, bigint, bigint, bigint)
  from public, anon, authenticated, service_role;
revoke all on function public.apply_pending_action(uuid, bigint, bigint, bigint)
  from public, anon, authenticated, service_role;
revoke all on function public.cancel_pending_action(uuid, bigint, bigint, bigint)
  from public, anon, authenticated, service_role;
revoke all on function public.expire_pending_action(uuid, bigint, bigint, bigint)
  from public, anon, authenticated, service_role;

grant execute on function public.create_pending_action(text, jsonb, bigint, bigint, text) to service_role;
grant execute on function public.bind_pending_action_prompt(uuid, bigint, bigint, bigint) to service_role;
grant execute on function public.claim_pending_action(uuid, bigint, bigint, bigint) to service_role;
grant execute on function public.apply_pending_action(uuid, bigint, bigint, bigint) to service_role;
grant execute on function public.cancel_pending_action(uuid, bigint, bigint, bigint) to service_role;
grant execute on function public.expire_pending_action(uuid, bigint, bigint, bigint) to service_role;

comment on table public.pending_actions is
  'SHR-110 service-only Telegram proposal/audit state. API roles cannot write or delete rows; service_role reads directly and mutates only through guarded SECURITY DEFINER RPCs.';

comment on function public.claim_pending_action(uuid, bigint, bigint, bigint) is
  'Service-role-only atomic confirmation claim bound to requester, chat, prompt, open state, and database-time expiry.';

commit;

-- Verification is automated in supabase/db-test/pending_actions.test.mjs.
-- Emergency rollback must be a reviewed forward migration. Never restore the
-- historical authenticated USING(true)/WITH CHECK(true) policy or API-role
-- DELETE/TRUNCATE privileges.
