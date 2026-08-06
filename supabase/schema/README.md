# Schema

Run in order, in the Supabase SQL Editor (or `psql`), against your project:

1. `001_init.sql` — all 11 tables
2. `002_rls.sql` — RLS enabled, household policy (any authenticated user, full access)
3. `003_realtime.sql` — realtime on `transactions`, `income`, `accounts`, `goal_contributions`
4. `004_seed.sql` — categories, Emergency Fund goal, recurring income, settings keys
5. `005_fx_settings.sql` — default FX rates to AED
6. `006_transaction_splits.sql` — `split_group_id` for multi-category transactions
7. `007_account_buckets.sql` — four-account bucket label on `accounts`
8. `008_recurring_end_date.sql` — end date on recurring entries
9. `009_recurring_seed_bills.sql` — the real bills/EMIs
10. `010_goals_pay_down.sql` — pay-down goal support
11. `011_telegram_intake.sql` — confirm/fix threading columns, intake indexes, intake settings keys

All eleven are applied to the `our-rokda` project (`wrxqgfbolryveivgdjia`).
`001`–`007` were run by hand in the SQL Editor, so they don't appear in
`supabase migration list`; `008`–`011` do.

Every file is additive-only and safe to re-run: `create table if not exists`,
`add column if not exists`, idempotent policy re-declaration, and
guarded/`on conflict` seed inserts. Nothing here drops or rewrites data.

New schema changes go in a new `NNN_description.sql` file, never edits to these.
