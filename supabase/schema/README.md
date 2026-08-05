# Schema

Run in order, in the Supabase SQL Editor (or `psql`), against your project:

1. `001_init.sql` — all 11 tables
2. `002_rls.sql` — RLS enabled, household policy (any authenticated user, full access)
3. `003_realtime.sql` — realtime on `transactions`, `income`, `accounts`, `goal_contributions`
4. `004_seed.sql` — categories, Emergency Fund goal, recurring income, settings keys

All four are additive-only and safe to re-run: `create table if not exists`,
idempotent policy re-declaration, and guarded/`on conflict` seed inserts. Verified
locally against a scratch Postgres instance (schema + idempotency + RLS + realtime
membership all checked) before being committed — not yet run against the live
Supabase project.

New schema changes go in a new `NNN_description.sql` file, never edits to these.
