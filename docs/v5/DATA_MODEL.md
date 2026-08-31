# Our Money v5 data model

Status: semantic map of the schema represented by `supabase/schema/001` through `046`. Production is verified through migration `044`; `045` and `046` are repository-only pending independent Tier-3 review and production apply remains unauthorized.

## Reading this document

**Current** means represented by repository migrations/application code. **Planned** means intended v5 design that does not yet exist as an authoritative schema primitive. Applied migrations remain documented in `supabase/schema/README.md`; never infer live deployment from this file alone.

## Core financial entities

### Account — current

`accounts` represents an asset, investment holding, or liability with owner/type, currency, value, optional holding fields, optional bucket, price provenance, fixed-deposit rate, and credit-card cycle fields.

- `value` is the stored valuation in `currency`.
- `is_liability` determines whether value reduces net worth.
- `ticker`, `quantity`, `avg_cost`, `last_price`, `price_updated_at`, and `price_source` support investment valuation.
- `statement_day`, `due_day`, and `credit_limit` support card-cycle presentation.

Account ownership labels are not authorization. Household membership/RLS controls access.

### Transaction — current

`transactions` represents ledger activity with date, amount, currency, account, category/subcategory, owner, source, review state, Telegram provenance, soft deletion, items, idempotency, grouping, assignment, and optional goal association.

- `deleted_at` is the deletion mechanism.
- `needs_review` describes confidence/data quality; `reviewed_at` records human review. They are related but distinct.
- Migration `044` adds no transaction columns. It uses the existing `idempotency_key` for browser-manual request replay and adds the `SECURITY INVOKER` `save_manual_transaction` RPC. A successful ordinary manual create or correction is explicit human-confirmed truth: `source = 'manual'` on creates, `needs_review = false`, and `reviewed_at` set by database time. Corrections preserve existing source/provenance and change only the allowlisted transaction fact. Existing rows are not backfilled or reclassified.
- `goal_id` is a display association only.
- `assigned_to` is a review request only.
- Zero amount is permitted only as an unresolved flagged placeholder.

### Transaction group — current, embedded in transactions

`transaction_group_id` plus `group_kind` models:

- `category_split`: lines of one purchase;
- `transfer`: paired account movement with `transfer_direction`;
- `bulk_batch`: independent spends received together.

`split_group_id` is deprecated historical structure retained for additive compatibility.

Migration `041` adds nullable `split_original_amount` and `split_original_currency`. The existing split RPC records them on every new/replaced category-split line and rejects cross-currency/sub-cent splits. Legacy split rows remain valid but are explicitly incomplete in canonical reporting when original identity is absent; no guessed backfill is performed.

### Category and budget — current

`categories` defines reporting labels and Needs/Wants/Savings grouping. `budgets` assigns monthly limits and planning groups. `category_rules` stores merchant/note matching rules. Categories classify facts; changing a category may change reporting but not the stored amount.

### Income — current

`income` stores dated household income facts separately from transactions. This separation is current implemented behavior and must be accounted for when defining cash flow.

### Recurring — current

`recurring` stores expected income, expense, or EMI schedules, including cadence, account linkage, autopay, and optional end date. It is a planning/obligation entity, not automatically a posted ledger transaction.

## Goals and planning

### Goal and contribution — current

`goals` supports `save_up` and `pay_down` goals, targets, plans, dates, linked accounts, and optional starting balance. `goal_contributions` records dated progress events. Atomic contribution/account updates use `create_goal_contribution` where applicable.

### Forecast event — current

`forecast_events` stores scenario events and parameters for forecast calculations. It does not alter actual financial history.

### Canonical scenario model — planned

V5 intends coherent goals, payoff, FIRE, and life-event scenarios. No new v5 scenario tables or authoritative persisted forecast result are defined by SHR-108.

## Canonical financial read contracts — current in repository and production through `041`

Migration `041` adds security-invoker/read-only views `v_canonical_ledger_aed`, `v_canonical_income_aed`, `v_canonical_accounts_aed`, and `v_canonical_goal_progress`. Read-only security-invoker functions expose canonical period metrics, budget actuals, balance sheet, and investment value/unrealized P&L. They execute with caller privileges and inherit household RLS from their source tables.

The contracts retain amounts and quality as separate facts. Missing required FX/input or unresolved zero placeholders null dependent aggregates and return `incomplete`; nonzero review rows and manual/stale valuations remain available with `provisional` metadata. Current-rate AED and two-decimal Postgres numeric outputs are the Phase A reporting basis. SHR-122 migrates Home and Reports to these period, ledger, income, and budget-actual contracts; other consumers remain separately gated.

Migration `042`, now production-applied, additively corrects only goal-quality classification: positive `target_amount` is required for `save_up`, while `pay_down` completeness depends on a positive AED `starting_balance` and a valid non-incomplete linked canonical liability. It does not alter goal rows, progress arithmetic, contribution activity, or access control.

## Valuation and history

### Net-worth snapshots — SHR-113 production contract

- `nw_daily` remains the daily AED history authority. Migration `043` adds only nullable provenance (`run_id`, actual `snapshot_at`/`published_at`, quality, investment value, source version, evidence, digest). Existing rows remain byte/content-identical and classify as legacy because provenance is null.
- `nw_snapshot_runs` has one logical run/idempotency identity per Dubai target day. It records trigger, policy, lifecycle, final quality/evidence, digest, and publication identity.
- `nw_snapshot_attempt_events` is append-only phase/failure evidence. Retries create new attempt numbers; prior failures are never overwritten.
- `nw_snapshot_items` is the immutable per-published-run account valuation manifest: native/canonical values, FX and price bases, source as-of/fetch timestamps, method, quality, and reason evidence.
- `accounts.price_quote_at` stores provider quote/session as-of separately from existing `price_updated_at` fetch/write time.
- `nw_snapshots` remains the deprecated monthly structure and is untouched/unpopulated.

Published runs/items/authoritative daily points are immutable. Authenticated household members have RLS-governed read-only access; anonymous and outsiders cannot read, and browser identities cannot mutate or invoke capture contracts. Service-only SECURITY INVOKER contracts claim, append attempt evidence, apply SHR-113 policy v1, and atomically publish or record a skipped-incomplete run. The Edge orchestrator refreshes and records evidence only; Postgres canonical account contracts remain the money engine.

This is snapshot provenance, not an event-sourced valuation ledger or contributions-versus-market attribution model. No dated historical FX/quote/account ledger is introduced and no history is reconstructed.

Phase C proposes no new financial entity. Its operational configuration creates one private scheduler dispatcher and one named pg_cron job outside the portable schema migration chain. The job has no retry table of its own: durable outcomes and retries remain represented only by the existing logical run and append-only attempt/item evidence. Transport evidence lives in pg_cron/pg_net and Edge logs, not in authoritative financial tables.

## Household, settings, and access

### Household member — current

`household_members` is the allow-list used by `private.is_household_member()` and RLS. The helper remains `SECURITY DEFINER` to avoid policy recursion but is outside the exposed API schema; authenticated has only the privileges required for policy evaluation. The current product is one shared household: authorized members can access shared rows; textual `owner` fields do not partition access.

### Setting — current

`settings` stores JSON configuration such as FX, preferences, FIRE assumptions, household shares, and Telegram configuration. Settings that affect money require validation and should use atomic RPCs where provided (`save_telegram_settings`).

### First-class household/party model — planned

The repository currently embeds known person names and Joint labels in several places. Replacing those strings with a generalized household/party model would be a separate migration and compatibility project, not an assumption for current code.

## Immutable audit evidence — current in repository, not production

Migration `045` adds one public durable table, `audit_events`, as append-only evidence of who/what performed an allowlisted action. It is deliberately not economic ownership, provenance, financial/data quality, attention state, integration observation, notification delivery, or generic telemetry.

- Actor shape is exclusive and typed: authenticated access user, private irreversible Telegram sender reference, stable service code, or stable system code. No actor field is an economic party/owner/category field, and none participates in RLS authorization.
- Action, target, evidence, surface, outcome, logical versions, change evidence, producer/version, sensitivity, redaction/version, and history scope are constrained at the database boundary. The initial allowlist contains only `audit.qa_fixture.recorded` and `audit.qa_fixture.verified`; their target/evidence kind and exact change projection are derived rather than caller-supplied.
- Request, correlation, causation, and hashed idempotency references are explicit. Same action + same safe idempotency reference + identical canonical payload returns the original successful event; changed payload fails. A distinct action or distinct request reference remains a distinct event.
- `history_scope = post_cutover_only`; no historical events are inferred or backfilled.
- Raw INSERT/UPDATE/DELETE is unavailable to all API roles. Service role receives raw SELECT only for the encrypted export and can execute only the QA reference writer. The private generic append function is executable by no API role.
- `audit_history_v1` is the only authenticated read contract. It authorizes through `private.is_household_member()` and redacts the private Telegram reference. Anonymous and authenticated outsiders are denied.
- UPDATE/DELETE triggers protect rows through ordinary and accidentally over-granted application paths. A database owner can deliberately alter/disable those controls and is the documented administrative trust boundary.

Economic-party context is intentionally absent until the separately reviewed party foundation exists. It must be added as an independent nullable typed reference later; actor identity must never populate it implicitly.

## Category lifecycle and system-code protection — current in repository, not production

Migration `046` adds identity and lifecycle substrate to `categories` and two durable evidence tables. It is deliberately dormant: it seeds no system code, backfills no reference, enables no rename or archive path, and changes no classification, budget actual, canonical view, Telegram behavior or consumer read.

- `categories.id` remains the authoritative category identity. `categories.name` remains mutable presentation text and is deliberately not turned into a durable financial key; no name-based semantic classification is introduced beyond the legacy text compatibility that already exists.
- `categories.system_code` is nullable, uniquely indexed where present, and constrained to exactly `transfer` and `savings_investment`. It is NULL on every row after this migration. Assignment is possible only from the database-owner/migration authority — in practice `private.assign_category_system_code_v1(...)`, which no API role may execute — and is one-way: once set, no path visible to the guard can change or clear it. It is not an authorization concept and never appears in an RLS predicate.
- `categories.archived_at` is the canonical lifecycle field; NULL is active. There is no user, API or product archive path. `anon`, `authenticated` and `service_role` are refused; the operator path additionally fails closed while any `budgets` row references the category or any `category_rules` row targets its current name. That block is a conservative placeholder until SHR-167 defines a real current-plan predicate and SHR-160 supplies deterministic, atomic rule enable/disable — it is not the final eligibility rule, and historical references must not block lifecycle forever.
- A registered system category can never be archived or deleted, enforced by both the guard trigger and `categories_system_not_archivable_check`, and cannot be renamed by an application role while text consumers remain.
- Category hard delete is refused for every role and TRUNCATE is refused on all three tables. v6 removal semantics are archive, not destruction; historical identity must survive lifecycle changes.
- `categories.updated_at` is database-authored: the guard overwrites any caller-supplied value on UPDATE. Rows that predate the migration are seeded from their own `created_at`, so a row that has never changed does not look changed.
- `category_name_history` is immutable rename evidence: category reference, previous and new name, timestamp, the access identity from `auth.uid()` where one exists, and a closed reason vocabulary. It is written by a trigger, not by a caller, so a rename cannot omit its own evidence. UPDATE and DELETE are rejected. A historical label is never globally reserved and never becomes an active resolver candidate on its own.
- `category_aliases` is the separate compatibility surface. An alias is registered explicitly, starts `compatibility_active`, and may be retired exactly once to terminal `history_only`. Only `compatibility_active` aliases participate in the unique-name constraint and in current-name collision blocking, so retirement releases the label. Whether an ordinary retired label should ever be permanently reserved remains a later explicit product decision.
- Uncategorized is unchanged: it stays the absence of a classification, not a category row and not a system code. `Other` remains an ordinary category and is not redefined.
- Both new tables enable RLS with a single member `SELECT` policy rooted in `private.is_household_member()`. No API role holds INSERT/UPDATE/DELETE; `service_role` holds raw `SELECT` for the encrypted export only. Every new function lives in `private`, pins an empty `search_path`, and is executable by no API role. No taxonomy administrator role is invented, and category identity stays independent of economic-party identity.
- As with `045`, trigger-based protection binds ordinary and accidentally over-granted application paths. The database owner can deliberately alter or disable it and remains the documented administrative trust root.

`transactions.category` and `category_rules.category` remain text and gain no UUID reference here; that is SHR-197's manifest-reviewed work.

## Intake, automation, and operations

- `notifications`: deduplicated outbound notification records.
- `intake_logs`: Telegram intake observability.
- `media_groups` and `media_group_files`: album/file aggregation; the old array representation is superseded.
- `pending_income`: proposed income/cashback awaiting controlled application.
- `pending_actions`: service-only propose-then-confirm coordination and audit state. `request_key` is the immutable idempotency identity for one proposal; `requested_by`, `chat_id`, and one-time-bound `prompt_msg_id` are Telegram identities supplied only by the trusted intake service and checked together on every transition. `claimed_at`/`claimed_by` form the atomic replay barrier before a handler runs. `resolved_at`/`resolution` record exactly one terminal outcome (`applied`, `cancelled`, or `expired`); terminal rows cannot reopen. Expiry uses database time and the half-open interval `[created_at, expires_at)`. Browser/API identities have no direct table or transition-RPC access; service role reads directly and writes only through the six guarded RPCs.
- `v_transactions_aed`: `SECURITY INVOKER`, soft-delete-filtered, FX-normalized transaction view; underlying household RLS applies to its caller, and NULL conversion means missing FX and must be detected by aggregates.

Atomic functions include validated/idempotent ordinary manual transaction saving, media-group claiming, transfer creation, bulk transaction creation, pending-income application, pending-action creation/binding/transitions, category-split replacement, goal contribution, and Telegram settings updates.

## Deprecated or historical structures

- `transactions.split_group_id` is superseded by typed transaction grouping.
- `media_groups.file_ids` is superseded by `media_group_files`.
- Earlier permissive RLS policies in migration `002` are superseded by membership policies in `023`.
- V4 screen taxonomy and deferred lists are not schema commitments.

Deprecated fields stay until an explicitly approved compatibility and data-migration plan permits removal.
