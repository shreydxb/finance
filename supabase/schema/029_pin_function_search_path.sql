-- 029_pin_function_search_path.sql
--
-- The security advisor flagged all six functions added in 026 and 027 for a
-- role-mutable search_path (lint 0011).
--
-- The risk is lower here than for a SECURITY DEFINER function: these all run
-- SECURITY INVOKER, with the caller's own privileges and under the membership
-- policies from 023, so an attacker who redirected name resolution would gain
-- nothing they did not already have. But a function whose table references can
-- be re-pointed by the caller's session settings is fragile regardless, and
-- pinning costs nothing.
--
-- Behaviour is unchanged: every object these touch already lives in public.

alter function replace_category_split(uuid, uuid, jsonb, jsonb)     set search_path = public, pg_temp;
alter function create_goal_contribution(uuid, numeric, date, text, uuid, text) set search_path = public, pg_temp;
alter function claim_media_group(text)                              set search_path = public, pg_temp;
alter function create_transfer(date, numeric, text, uuid, uuid, text, text, text, boolean, bigint, bigint, text)
  set search_path = public, pg_temp;
alter function create_bulk_transactions(jsonb, bigint, text)        set search_path = public, pg_temp;
alter function apply_pending_income(uuid)                           set search_path = public, pg_temp;

-- Verify: expect six rows, each with a search_path in proconfig.
--   select proname, proconfig from pg_proc p
--   join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname = 'public'
--     and proname in ('replace_category_split','create_goal_contribution',
--                     'claim_media_group','create_transfer',
--                     'create_bulk_transactions','apply_pending_income');
