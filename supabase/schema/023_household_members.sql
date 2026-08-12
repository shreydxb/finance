-- 023_household_members.sql — SEC-02
--
-- Every policy in this database currently reads `using (true) with check
-- (true)` for the role `authenticated`. That means RLS is *enabled* but
-- isolates nothing: any account that can authenticate to this Supabase project
-- can read, change or delete every financial record the household has.
--
-- This replaces that with membership. A row in `household_members` is what
-- grants access; an authenticated user who is not in it sees nothing.
--
-- ---------------------------------------------------------------------------
-- Why this cannot lock the household out
-- ---------------------------------------------------------------------------
--
--   1. Members are seeded from `auth.users` BEFORE any policy changes, in the
--      same transaction. There is no window where a real user is authenticated
--      but not yet a member.
--   2. The seed takes every existing account rather than hardcoded UUIDs.
--      Verified 12 Aug 2026: exactly two accounts exist, both belonging to the
--      household. If that is ever untrue, fix the roster before running this.
--   3. `service_role` bypasses RLS entirely, so the Edge Functions
--      (telegram-intake, refresh-prices, refresh-fx, backup) are unaffected.
--   4. The SQL editor and Management API also bypass RLS, so a mistake here
--      locks the *app* out, never the admin. Recovery is the rollback at the
--      bottom of this file — one statement per table.
--
-- Additive and reversible. No data is read, written or deleted.

begin;

-- ---------------------------------------------------------------------------
-- The roster
-- ---------------------------------------------------------------------------

create table if not exists household_members (
  user_id      uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  added_at     timestamptz not null default now()
);

comment on table household_members is
  'Allowlist of auth users permitted to see household finances. Managed out of band (SQL editor / service role) — deliberately not writable by the app.';

-- Seed from the accounts that already exist. Doing this before the policies
-- change is the whole safety argument: both real users are members from the
-- instant membership starts being enforced.
insert into household_members (user_id, display_name)
select u.id, coalesce(u.raw_user_meta_data ->> 'name', split_part(u.email, '@', 1))
from auth.users u
on conflict (user_id) do nothing;

-- ---------------------------------------------------------------------------
-- The predicate
-- ---------------------------------------------------------------------------

-- SECURITY DEFINER matters here, and not for convenience. The policy on
-- `household_members` itself calls this function; if the function were subject
-- to RLS it would consult the very policy that called it and recurse. Running
-- as the owner reads the table directly and terminates.
--
-- `search_path` is pinned because a SECURITY DEFINER function that resolves
-- names through the caller's search_path is a privilege-escalation primitive.
create or replace function is_household_member()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.household_members m where m.user_id = auth.uid()
  );
$$;

comment on function is_household_member() is
  'True when the current JWT belongs to a household member. SECURITY DEFINER to avoid RLS recursion via household_members own policy.';

revoke all on function is_household_member() from public;
grant execute on function is_household_member() to authenticated;

-- The roster is readable by members and writable by nobody through the API.
-- Postgres denies any command that has no policy, so omitting insert/update/
-- delete policies is the enforcement — `service_role` still bypasses RLS.
alter table household_members enable row level security;
drop policy if exists "household_members read" on household_members;
create policy "household_members read" on household_members
  for select to authenticated
  using (is_household_member());

-- ---------------------------------------------------------------------------
-- Replace every permissive policy
-- ---------------------------------------------------------------------------
--
-- Policy names are preserved exactly so this reads as a predicate change
-- rather than a re-architecture, and so the rollback is symmetrical. The
-- per-table names differ because they were created across several migrations
-- (002, 011, 014, 015, 016, 017, 019) — that inconsistency is inherited, not
-- introduced here.

drop policy if exists "household_all" on accounts;
create policy "household_all" on accounts for all to authenticated
  using (is_household_member()) with check (is_household_member());

drop policy if exists "household_all" on categories;
create policy "household_all" on categories for all to authenticated
  using (is_household_member()) with check (is_household_member());

drop policy if exists "household_all" on transactions;
create policy "household_all" on transactions for all to authenticated
  using (is_household_member()) with check (is_household_member());

drop policy if exists "household_all" on budgets;
create policy "household_all" on budgets for all to authenticated
  using (is_household_member()) with check (is_household_member());

drop policy if exists "household_all" on recurring;
create policy "household_all" on recurring for all to authenticated
  using (is_household_member()) with check (is_household_member());

drop policy if exists "household_all" on goals;
create policy "household_all" on goals for all to authenticated
  using (is_household_member()) with check (is_household_member());

drop policy if exists "household_all" on goal_contributions;
create policy "household_all" on goal_contributions for all to authenticated
  using (is_household_member()) with check (is_household_member());

drop policy if exists "household_all" on income;
create policy "household_all" on income for all to authenticated
  using (is_household_member()) with check (is_household_member());

drop policy if exists "household_all" on settings;
create policy "household_all" on settings for all to authenticated
  using (is_household_member()) with check (is_household_member());

drop policy if exists "household_all" on nw_snapshots;
create policy "household_all" on nw_snapshots for all to authenticated
  using (is_household_member()) with check (is_household_member());

drop policy if exists "household_all" on forecast_events;
create policy "household_all" on forecast_events for all to authenticated
  using (is_household_member()) with check (is_household_member());

drop policy if exists "category_rules household all" on category_rules;
create policy "category_rules household all" on category_rules for all to authenticated
  using (is_household_member()) with check (is_household_member());

drop policy if exists "notifications household all" on notifications;
create policy "notifications household all" on notifications for all to authenticated
  using (is_household_member()) with check (is_household_member());

drop policy if exists "intake_logs household all" on intake_logs;
create policy "intake_logs household all" on intake_logs for all to authenticated
  using (is_household_member()) with check (is_household_member());

drop policy if exists "media_groups household all" on media_groups;
create policy "media_groups household all" on media_groups for all to authenticated
  using (is_household_member()) with check (is_household_member());

drop policy if exists "pending_income household all" on pending_income;
create policy "pending_income household all" on pending_income for all to authenticated
  using (is_household_member()) with check (is_household_member());

-- nw_daily is split into three command-specific policies with no DELETE
-- policy, so net-worth history cannot be deleted through the API. That shape
-- is deliberate (013) and is preserved — only the predicate changes.
drop policy if exists "nw_daily household read" on nw_daily;
create policy "nw_daily household read" on nw_daily for select to authenticated
  using (is_household_member());

drop policy if exists "nw_daily household write" on nw_daily;
create policy "nw_daily household write" on nw_daily for insert to authenticated
  with check (is_household_member());

drop policy if exists "nw_daily household update" on nw_daily;
create policy "nw_daily household update" on nw_daily for update to authenticated
  using (is_household_member()) with check (is_household_member());

commit;

-- ---------------------------------------------------------------------------
-- Verify (run after applying)
-- ---------------------------------------------------------------------------
--
--   -- Expect 2 rows, one per household member.
--   select user_id, display_name from household_members;
--
--   -- Expect zero rows: nothing should still be permissive.
--   select tablename, policyname from pg_policies
--   where schemaname = 'public' and (qual = 'true' or with_check = 'true');
--
--   -- Expect 20 policies across 18 tables.
--   select count(*) from pg_policies where schemaname = 'public';
--
-- Then sign in as each user in the app and confirm the screens still load.
--
-- ---------------------------------------------------------------------------
-- Rollback
-- ---------------------------------------------------------------------------
--
-- Restores the previous permissive behaviour. Only needed if a member cannot
-- reach their data; the admin path is never affected.
--
--   begin;
--   create policy "household_all" on accounts for all to authenticated
--     using (true) with check (true);   -- ...and so on per table, after
--                                       -- dropping the membership version
--   commit;
--
-- To add a member later (never through the app):
--
--   insert into household_members (user_id, display_name)
--   values ('<auth.users.id>', 'Name');
--
-- To revoke access immediately:
--
--   delete from household_members where user_id = '<auth.users.id>';
