# Schema

SQL migrations for `our-rokda` (`wrxqgfbolryveivgdjia`), applied in numeric
order. **Every file here is applied to production** as of 12 August 2026,
verified against the live database rather than assumed.

`001`–`007` were run by hand in the SQL Editor and so do not appear in
`supabase migration list`; `008` onward do.

| # | What it does |
|---|---|
| `001_init` | The original 11 tables |
| `002_rls` | RLS enabled, permissive household policy — **superseded by `023`** |
| `003_realtime` | Publishes `transactions`, `income`, `accounts`, `goal_contributions` |
| `004_seed` | Categories, Emergency Fund goal, recurring income, settings keys |
| `005_fx_settings` | Default FX rates to AED |
| `006_transaction_splits` | `split_group_id` — **deprecated by `025`** |
| `007_account_buckets` | Four-account bucket label |
| `008_recurring_end_date` | `end_date` on recurring entries |
| `009_recurring_seed_bills` | The real bills and EMIs |
| `010_goals_pay_down` | Pay-down goal support |
| `011_telegram_intake` | Confirm/fix threading columns, intake indexes, intake settings |
| `012_seed_paydown_goals` | The three pay-down goals, linked to real liabilities |
| `013_nw_daily` | Daily net-worth history |
| `014_category_rules` | Auto-categorisation rules |
| `015_bot_expansion` | `transactions.deleted_at`, `notifications` |
| `016_intake_logs` | Full intake observability |
| `017_media_groups` | Telegram album handling — **`file_ids` superseded by `027`** |
| `018_transaction_items` | Itemised receipt lines |
| `019_pending_income` | Cashback/income proposals |
| `020_transfers` | The `Transfer` category |
| `021_transaction_reviewed` | `reviewed_at`, independent of AI confidence |
| `022_fd_goals` | Fixed deposits as goal-fundable accounts |

## Stabilization round — 12 August 2026

Added by the QA/QC remediation. See `QA_QC_AUDIT_AND_REMEDIATION.md` for the
findings each one closes, and the verification evidence.

| # | What it does | Closes |
|---|---|---|
| `023_household_members` | Membership roster + `is_household_member()`; every permissive policy rewritten | SEC-02 |
| `024_revoke_anon_household_fn` | Removes `anon`'s EXECUTE on the membership predicate | SEC-02 |
| `025_transaction_groups` | `transaction_group_id` / `group_kind` / `transfer_direction` | DATA-01 |
| `026_atomic_writes` | `replace_category_split`, `create_goal_contribution` | DATA-02 |
| `027_intake_atomicity` | Idempotency key, `media_group_files`, four intake functions | BOT-01 |
| `028_price_provenance` | `price_updated_at`, `price_source` | UI-01 |
| `029_pin_function_search_path` | Pins `search_path` on all six new functions | advisor 0011 |
| `030_telegram_settings_rpc` | `save_telegram_settings` — one transaction, validated | UI-03 |
| `031_transaction_integrity` | Zero amount allowed only while `needs_review`; blocked once reviewed | DATA-05 |
| `032_soft_delete_in_split_replace` | `replace_category_split` soft-deletes instead of hard-deleting | DATA-04 |
| `033_plain_idempotency_unique_index` | Idempotency index made non-partial — PostgREST's `on_conflict=` can't express a predicate | BOT-01 follow-up |
| `034_transfer_direction_null_safe` | Closes a NULL-passes-CHECK gap in the 025 transfer-direction constraint | found by `test:db` (Taskiv #101) |
| `035_statement_cycle` | `accounts.statement_day` / `due_day` / `credit_limit`, all nullable | Taskiv #75 — Accounts card section |
| `036_money_view` | `v_transactions_aed` FX view (applied via `claude/money-v4-open-items-mdw27c`) | Bot expansion Sprint 2 |
| `037_pending_actions` | Propose-then-tap plumbing table (applied via `claude/money-v4-open-items-mdw27c`) | Taskiv #60 |
| `038_partner_review_and_goal_link` | `transactions.assigned_to` / `goal_id`, both display-only tags | Taskiv #24 |

## Rules

- **Additive only.** Never drop or rewrite. This database holds real money data, and there is no paid backup on the free plan — see `supabase/functions/backup/README.md` for the encrypted nightly backup that fills that gap.
- New changes go in a new `NNN_description.sql`, never as edits to an applied file.
- Every file is written to be safe to re-run: `create table if not exists`, `add column if not exists`, `drop policy if exists` before `create policy`, guarded or `on conflict` seeds.
- **Run the security advisor after any schema change.** It caught three real problems in this round that reading the SQL did not: an `anon` grant that a `revoke ... from public` did not remove, and mutable `search_path` on six new functions.
- **Run `npm run test:db` before applying.** It builds a scratch database from empty, applies every file in this directory in order, and exercises every RPC, RLS policy and constraint — see `supabase/db-test/README.md`. It found `034`'s bug on the first run.
- **Probe new functions against the real schema before trusting them.** `save_telegram_settings` looked correct and failed on every one-person setup, because an unconfigured slot arrives as SQL `NULL` and `settings.value` is `NOT NULL`.

## Two policies that look wrong and are not

- **`is_household_member()` is `SECURITY DEFINER`.** It has to be: the policy on `household_members` calls it, so a function subject to RLS would consult the policy that called it and recurse. `search_path` is pinned for the same reason any definer function should pin it.
- **`authenticated` keeps EXECUTE on it**, which the advisor flags. Revoking it would make every policy on every table fail to evaluate — locking both members out entirely. The function takes no arguments and discloses only whether the caller is themselves a member.

## Not applied, despite appearing in design docs

`pg_cron` and `pg_net` are available and **not installed** — both are needed
for the nightly backup schedule and future Telegram pushes.

`accounts.statement_day` / `due_day` / `credit_limit` **were** in this list and
are now applied as `035_statement_cycle`. The columns exist and are null on all
46 rows: no card has had its limit or cycle entered yet, and those values must
come from the bank app rather than being inferred from an EMI date.

`pending_actions` and `v_transactions_aed` **were** also in this list — both
are now applied (`036_money_view`, `037_pending_actions`, built on the
`claude/money-v4-open-items-mdw27c` branch's Telegram bot expansion work, not
reflected in this branch's git history but live in the shared `our-rokda`
database — verified via `list_migrations` before adding `038` on top).

`038_partner_review_and_goal_link` (this branch) adds `transactions.assigned_to`
(flag a spend for the other partner to review) and `transactions.goal_id`
(display-only link to a goal — never a contribution; see the migration's own
comment). `forecast_events` was already applied (in `001_init`/`002_rls`) but
unused until this branch's forecasting feature (Taskiv #24) started reading
and writing it.
