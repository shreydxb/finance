# Our Money v5 data model

Status: semantic map of the schema represented by `supabase/schema/001` through `042`. Production is verified through migrations `041` and `042`.

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

### Net-worth snapshots — current

- `nw_daily`: one daily AED snapshot with assets, liabilities, and owner/type breakdowns.
- `nw_snapshots`: monthly/historical aggregate structure retained from the initial model.

Snapshots are records, not source transactions. Current code calculates from account values and upserts `nw_daily` when the relevant application path runs.

### Authoritative valuation history and attribution — planned

V5 plans a trustworthy history with freshness and attribution. The repository does not yet contain a canonical event-sourced valuation ledger, dated FX history, or a complete contributions-versus-market-movement attribution model.

## Household, settings, and access

### Household member — current

`household_members` is the allow-list used by `private.is_household_member()` and RLS. The helper remains `SECURITY DEFINER` to avoid policy recursion but is outside the exposed API schema; authenticated has only the privileges required for policy evaluation. The current product is one shared household: authorized members can access shared rows; textual `owner` fields do not partition access.

### Setting — current

`settings` stores JSON configuration such as FX, preferences, FIRE assumptions, household shares, and Telegram configuration. Settings that affect money require validation and should use atomic RPCs where provided (`save_telegram_settings`).

### First-class household/party model — planned

The repository currently embeds known person names and Joint labels in several places. Replacing those strings with a generalized household/party model would be a separate migration and compatibility project, not an assumption for current code.

## Intake, automation, and operations

- `notifications`: deduplicated outbound notification records.
- `intake_logs`: Telegram intake observability.
- `media_groups` and `media_group_files`: album/file aggregation; the old array representation is superseded.
- `pending_income`: proposed income/cashback awaiting controlled application.
- `pending_actions`: service-only propose-then-confirm coordination and audit state. `request_key` is the immutable idempotency identity for one proposal; `requested_by`, `chat_id`, and one-time-bound `prompt_msg_id` are Telegram identities supplied only by the trusted intake service and checked together on every transition. `claimed_at`/`claimed_by` form the atomic replay barrier before a handler runs. `resolved_at`/`resolution` record exactly one terminal outcome (`applied`, `cancelled`, or `expired`); terminal rows cannot reopen. Expiry uses database time and the half-open interval `[created_at, expires_at)`. Browser/API identities have no direct table or transition-RPC access; service role reads directly and writes only through the six guarded RPCs.
- `v_transactions_aed`: `SECURITY INVOKER`, soft-delete-filtered, FX-normalized transaction view; underlying household RLS applies to its caller, and NULL conversion means missing FX and must be detected by aggregates.

Atomic functions include media-group claiming, transfer creation, bulk transaction creation, pending-income application, pending-action creation/binding/transitions, category-split replacement, goal contribution, and Telegram settings updates.

## Deprecated or historical structures

- `transactions.split_group_id` is superseded by typed transaction grouping.
- `media_groups.file_ids` is superseded by `media_group_files`.
- Earlier permissive RLS policies in migration `002` are superseded by membership policies in `023`.
- V4 screen taxonomy and deferred lists are not schema commitments.

Deprecated fields stay until an explicitly approved compatibility and data-migration plan permits removal.
