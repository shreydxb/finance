# Our Money v5 data model

Status: semantic map of the schema represented by `supabase/schema/001` through `039` on the SHR-109 branch. Migration `039` remains **NOT APPLIED** to production pending independent QA; verify live Supabase separately.

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
- `pending_actions`: propose-then-confirm actions with requester, expiry, and resolution metadata.
- `v_transactions_aed`: `SECURITY INVOKER`, soft-delete-filtered, FX-normalized transaction view; underlying household RLS applies to its caller, and NULL conversion means missing FX and must be detected by aggregates.

Atomic functions include media-group claiming, transfer creation, bulk transaction creation, pending-income application, category-split replacement, goal contribution, and Telegram settings updates.

## Deprecated or historical structures

- `transactions.split_group_id` is superseded by typed transaction grouping.
- `media_groups.file_ids` is superseded by `media_group_files`.
- Earlier permissive RLS policies in migration `002` are superseded by membership policies in `023`.
- V4 screen taxonomy and deferred lists are not schema commitments.

Deprecated fields stay until an explicitly approved compatibility and data-migration plan permits removal.
