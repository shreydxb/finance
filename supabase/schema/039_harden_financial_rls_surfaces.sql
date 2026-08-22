-- 039_harden_financial_rls_surfaces.sql — SHR-109
--
-- Closes two Supabase Security Advisor findings without changing financial
-- data or reporting arithmetic:
--
--   1. v_transactions_aed was created with Postgres's default view security,
--      so it ran with its postgres owner's privileges and could bypass the RLS
--      policies on transactions, accounts and settings.
--   2. is_household_member() must remain SECURITY DEFINER to avoid recursion
--      through household_members' own policy, but keeping it in public made
--      the authenticated EXECUTE grant required by RLS an exposed RPC.
--
-- Moving the existing function preserves its OID. Postgres therefore updates
-- every policy dependency to the new schema automatically; no policy is
-- dropped or made temporarily permissive.

begin;

-- This schema is deliberately not part of the Supabase Data API. Authenticated
-- needs USAGE only so its RLS policies can execute the helper by OID.
create schema if not exists private;

comment on schema private is
  'Non-exposed database primitives used internally by RLS. Never add this schema to the Supabase Data API exposed schemas.';

revoke all on schema private from public, anon, authenticated, service_role;
grant usage on schema private to authenticated;

-- Safe on both first apply and rerun. Fail closed if neither the old nor the
-- moved helper exists, rather than silently leaving every policy unusable.
do $$
begin
  if to_regprocedure('private.is_household_member()') is null then
    if to_regprocedure('public.is_household_member()') is null then
      raise exception 'is_household_member() is missing from both public and private';
    end if;

    alter function public.is_household_member() set schema private;
  end if;

  if to_regprocedure('public.is_household_member()') is not null then
    raise exception 'public.is_household_member() still exists after hardening';
  end if;
end;
$$;

-- The function body already schema-qualifies both public.household_members
-- and auth.uid(), so it needs no caller-controlled search path at all.
alter function private.is_household_member() set search_path = '';

comment on function private.is_household_member() is
  'RLS-only membership predicate. SECURITY DEFINER avoids household_members policy recursion; kept outside exposed API schemas so it is not an RPC.';

-- RLS expressions run with the querying role's privileges. Authenticated
-- therefore keeps exactly EXECUTE; anon and service_role do not need it.
revoke all on function private.is_household_member()
  from public, anon, authenticated, service_role;
grant execute on function private.is_household_member() to authenticated;

-- Preserve the exact view definition and column layout while making the
-- caller's grants and underlying household RLS policies authoritative.
alter view public.v_transactions_aed set (security_invoker = true);

-- This is a read-only household reporting surface. Anonymous callers receive
-- no access; authenticated household users and trusted server code need SELECT
-- only. The postgres owner retains its inherent owner privileges.
revoke all on table public.v_transactions_aed
  from public, anon, authenticated, service_role;
grant select on table public.v_transactions_aed to authenticated, service_role;

comment on view public.v_transactions_aed is
  'SECURITY INVOKER household reporting view. Preserves the 036 FX-normalized, soft-delete-filtered definition while enforcing caller grants and underlying RLS. amount_aed remains NULL when FX is missing.';

commit;

-- Verify after applying:
--
--   -- Expect security_invoker=true.
--   select reloptions from pg_class
--   where oid = 'public.v_transactions_aed'::regclass;
--
--   -- Expect one private, STABLE SECURITY DEFINER function and no public one.
--   select n.nspname, p.proname, p.prosecdef, p.provolatile, p.proconfig, p.proacl
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--   where p.proname = 'is_household_member';
--
--   -- Expect every membership policy to deparse through private.
--   select tablename, policyname, qual, with_check from pg_policies
--   where coalesce(qual, '') like '%is_household_member%'
--      or coalesce(with_check, '') like '%is_household_member%';
--
-- Rollback (emergency only; this restores both advisor findings):
--
--   begin;
--   alter view public.v_transactions_aed reset (security_invoker);
--   revoke all on table public.v_transactions_aed
--     from public, anon, authenticated, service_role;
--   grant all on table public.v_transactions_aed
--     to anon, authenticated, service_role;
--   alter function private.is_household_member() set search_path = public, pg_temp;
--   alter function private.is_household_member() set schema public;
--   revoke all on function public.is_household_member()
--     from public, anon, authenticated, service_role;
--   grant execute on function public.is_household_member()
--     to authenticated, service_role;
--   revoke all on schema private from public, anon, authenticated, service_role;
--   commit;
