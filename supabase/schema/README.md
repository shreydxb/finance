# Schema

SQL migrations for `our-rokda` (`wrxqgfbolryveivgdjia`), applied in numeric
order. Production is verified through `044` as of 1 September 2026. Migrations
`045` through `050` are repository-only pending their independent reviews and
production release gates; none is applied. `045` additionally carries its
own release condition — it must not be applied before the reviewed
backup-source deployment is coordinated, so audit evidence cannot begin
accumulating without backup coverage — and later migrations do not alter that gate. The
separately gated SHR-113 Phase-C operational configuration lives under
`supabase/scheduler/`.

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
| `039_harden_financial_rls_surfaces` | SECURITY INVOKER money view + non-exposed RLS membership helper | SHR-109 / SHR-119 |
| `040_harden_pending_actions_authorization` | Reproduces the deployed `037` table on clean databases; service-only guarded pending-action state machine | SHR-110 / SHR-120 |
| `041_canonical_financial_metrics_phase_a` | Additive canonical ledger/income/account/goal views, period/balance/investment/budget functions, split identity, quality metadata — applied; production QA found the debt-quality predicate fixed by `042` | SHR-111 Phase A |
| `042_fix_canonical_debt_quality` | Recreates only the security-invoker goal-progress view so positive target is save-up-only and pay-down quality uses starting balance + linked liability — applied | SHR-111 / SHR-121 |
| `043_authoritative_net_worth_snapshots` | Additive logical runs, append-only attempt evidence, immutable valuation manifests, service-only capture, read-only history, and nullable `nw_daily` provenance; no history rewrite and no scheduler installation — applied and independently production-QA-passed | SHR-113 Phase A/B |
| `044_manual_transaction_safety` | Validated SECURITY INVOKER manual create/correction with durable request replay, explicit reviewed truth, Transfer containment, and minimal validated split confirmation; no data rewrite or financial-engine change — applied and production-QA-passed | SHR-126 |
| `045_immutable_audit_substrate` | Immutable typed action evidence, owner-only private append primitive, service-only QA reference writer, redacted member read RPC, explicit ACL/RLS, replay semantics, and backup coverage; no backfill or production-writer integration — repository only, not applied | SHR-191 |
| `046_category_lifecycle_protection` | `categories.system_code` / `archived_at` / `updated_at`, a closed `transfer \| savings_investment` vocabulary, database-level system-code immutability and system-category archive/delete protection, a no-hard-delete guard, **fully fail-closed rename, archive and reactivation for every role including the database owner's ordinary DML**, immutable `category_name_history`, explicitly separate `category_aliases` with a compatibility-active → history-only lifecycle, least-privilege ACL/RLS, and backup coverage; **no system code is seeded, no reference is backfilled, and no rename/archive path exists at all** — repository only, not applied | SHR-196 |
| `047_economic_identity_foundation` | Empty N-party economic household/party/access-mapping substrate, lifecycle and immutability guards, an explicit per-row restore boundary, least-privilege ACL/RLS; **no party, mapping or production row is created** — repository only, not applied | SHR-193 |
| `048_access_party_reconciliation` | Read-only access-roster preflight with a roster-evidence digest, a transactional evidence-gated manifest reconciliation path, the ordinary mapping create/change/deactivate lifecycle with database-authored decision times, immutable `access_party_mapping_history`, immutable `access_party_reconciliation_runs`, the SHR-194 typed audit policy registered on the SHR-191 substrate, the `access_scope_context_v1` context API, least-privilege ACL/RLS and backup coverage; **the migration creates no household, party, decision or audit row — a separately approved manifest does** — repository only, not applied | SHR-194 |
| `049_account_ownership_reconciliation` | Additive account ownership kind/party references, read-only roster preflight and deterministic evidence digest, explicit evidence-reviewed manifest reconciliation, immutable run/row evidence, exact replay/conflict behavior, and backup coverage; **no account is inferred or reconciled by the migration** — repository only, not applied | SHR-154 |
| `050_category_stable_reference_reconciliation` | Nullable stable category references on transactions and rules, deterministic category/label/count preflight, an exhaustive evidence-reviewed manifest path, exact two-code system seeding, active and soft-deleted reconciliation, immutable run/manifest/row evidence, replay/conflict behavior, parity reporting, least-privilege ACL/RLS, and backup coverage; **no production UUID mapping is embedded and no consumer reads the references** — repository only, not applied | SHR-197 |

## Rules

- **Additive only.** Never drop or rewrite. This database holds real money data, and there is no paid backup on the free plan — see `supabase/functions/backup/README.md` for the encrypted nightly backup that fills that gap.
- New changes go in a new `NNN_description.sql`, never as edits to an applied file.
- Every file is written to be safe to re-run: `create table if not exists`, `add column if not exists`, `drop policy if exists` before `create policy`, guarded or `on conflict` seeds.
- **Run the security advisor after any schema change.** It caught three real problems in this round that reading the SQL did not: an `anon` grant that a `revoke ... from public` did not remove, and mutable `search_path` on six new functions.
- **Run `npm run test:db` before applying.** It builds a scratch database from empty, applies every file in this directory in order, and exercises every RPC, RLS policy and constraint — see `supabase/db-test/README.md`. It found `034`'s bug on the first run.
- **Probe new functions against the real schema before trusting them.** `save_telegram_settings` looked correct and failed on every one-person setup, because an unconfigured slot arrives as SQL `NULL` and `settings.value` is `NOT NULL`.

## RLS primitives that look unusual and are deliberate

- **`private.is_household_member()` remains `SECURITY DEFINER`.** It has to be: the policy on `household_members` calls it, so a function subject to RLS would consult the policy that called it and recurse. Migration `039` moves the existing function object out of `public`, pins an empty `search_path`, and leaves only the authenticated `USAGE`/`EXECUTE` privileges required to evaluate RLS. The `private` schema must never be exposed through the Data API.
- **`v_transactions_aed` remains in `public` but is `SECURITY INVOKER`.** Authenticated callers need the reporting view, while its underlying `transactions`, `accounts`, and `settings` reads must obey the caller's household policies. Anonymous access is revoked.
- **`pending_actions` deliberately has RLS enabled with no policies.** It is not browser data. `anon` and `authenticated` have no table or transition-RPC privileges; `service_role` has direct `SELECT` only. Six `SECURITY DEFINER` RPCs, executable only by `service_role`, own creation, one-time prompt binding, claim, application, cancellation, and expiry. Each pins an empty `search_path` and fully qualifies its references. The advisor's `rls_enabled_no_policy` information finding is therefore expected default-deny evidence, not a missing policy.

## Not applied, despite appearing in design docs

`pg_cron` and `pg_net` are available and **not installed**. SHR-113 Phase C
proposes their separately reviewed hosted activation for one net-worth job;
merging repository configuration alone does not install either extension.

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

`039_harden_financial_rls_surfaces` passed SHR-119 and is now applied and
verified in production.

`040_harden_pending_actions_authorization` passed SHR-120 and is applied and
verified in production together with Telegram Edge v42.

`041_canonical_financial_metrics_phase_a` is applied in production. It preserves
existing views/APIs/consumers and historical `nw_daily` and added no guessed
backfill. Independent production QA found one goal-quality predicate bug.

`042_fix_canonical_debt_quality` is applied and verified in production. It does
not alter goal data or arithmetic; it only makes the existing goal-quality
predicate follow the approved save-up/pay-down bases.

`043_authoritative_net_worth_snapshots` is applied and independently verified
in production. It did not backfill, reconstruct, or update any existing
`nw_daily` row; `nw_snapshots` remains untouched/deprecated. No pg_cron/pg_net
job is installed by the migration. Phase-C activation remains a separate,
explicitly reviewed operational step documented in `supabase/scheduler/`.

`044_manual_transaction_safety` is applied and independently verified in
production. `045_immutable_audit_substrate` is repository-only: no audit table,
writer, read contract, or audit row exists in production until a separate
reviewed release authorizes the unchanged migration and backup-function source.

`046_category_lifecycle_protection` is repository-only for the same reason, and
its ordering behind `045` is deliberate — it is P02 in the V6.0 convergence
sequence. Read-only production inspection on 31 August 2026 confirmed the shape
it must be safe against: `public.categories` still has exactly
`id, name, "group", icon, created_at`, holds 20 rows, and owns no lifecycle,
system-code or history object. After `046` every one of those rows still has
`system_code IS NULL` and `archived_at IS NULL`; assigning either of the two
approved codes to a real category is SHR-197's evidence-reviewed work, and it
is deliberately **not** inferred from the current `Transfer` or
`Savings & Investments` labels.

Four things about `046` are easy to misread and worth stating plainly:

- **Operator authority is not a new role.** The guards distinguish the
  database-owner/migration path (the role that owns `public.categories`) from
  `anon` / `authenticated` / `service_role`, none of which is a member of it.
  That is the existing administrative trust root, not an invented taxonomy
  administrator, and the owner can still disable a trigger by DDL — the same
  honest boundary `045` documents.
- **Rename does not exist here, for anyone.** Any change to `categories.name`
  is refused for every role, the database owner's ordinary `UPDATE` included.
  Category text still carries financial meaning — `transactions.category`,
  `category_rules.category` and `041`'s classification all read it — and
  SHR-157 R12 requires a measurable zero-text-semantic-consumer inventory
  before a label may change. `updateCategory` in the app therefore has no
  working rename path after this migration; group and icon edits are
  unaffected.
- **Archive does not exist here either.** Archive and reactivation are refused
  for every role, again including ordinary owner DML, and **no eligibility
  predicate is consulted**: a placeholder that let some archives through would
  be an operational archive algorithm, and SHR-167 owns the current-plan
  predicate while SHR-160 owns atomic rule lifecycle. The one place an archive
  timestamp may appear is an `INSERT` on the operator path, which is what a
  backup re-import does; that cannot become an archive capability, because
  archiving a live category that way would mean deleting it first and `DELETE`
  is refused for every role.
- **History is not an alias.** The rename-history writer stays wired even
  though no rename can reach it, so whichever package meets the gate inherits
  working evidence rather than an untested trigger; QA exercises it through an
  owner-DDL fixture, never a callable path. A former label becomes resolvable
  only when someone explicitly registers a `category_aliases` row, and retiring
  that alias to `history_only` releases the label again — ordinary former names
  are never permanently reserved.
