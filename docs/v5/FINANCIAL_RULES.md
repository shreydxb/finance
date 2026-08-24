# Our Money v5 financial rules

Status: canonical invariants and current known semantics for SHR-108. An item marked **unresolved** must not be guessed; define it in a reviewed decision before changing calculations.

## General invariants

- Stored money facts come from a user, an authoritative source, or a validated deterministic process. Never invent them.
- A plausible wrong number is worse than an explicit unavailable/unknown result.
- All totals must state or inherit a reporting currency and period.
- Missing FX or valuation inputs must surface as unavailable/incomplete, not silently use parity, zero, or omit the row.
- Soft-deleted transactions do not contribute to current reports.
- Unknown zero-amount Telegram rows are placeholders only while `needs_review` is true; they cannot be treated as reviewed financial facts.
- Ownership is descriptive unless a metric explicitly defines an owner filter. It is not the authorization boundary.

## Currency and valuation

- AED is the base reporting currency.
- Repository FX settings express conversion to AED. `toAED` returns an unavailable numeric result when a rate is missing.
- `v_transactions_aed.amount_aed` is NULL when a rate is missing. PostgreSQL `sum()` skips NULL, so every database aggregate over this view must also detect missing converted rows.
- Display-currency switching is presentation-only and must not mutate stored amounts.
- Current-rate conversion of historical transactions is the current approximation. Historical/daily FX valuation is **planned/unresolved**, not currently implemented.
- Holding prices require provenance and freshness metadata. A stale or missing price must be visible; it must not be represented as a current valuation without qualification.

## Transactions, splits, and transfers

- A transaction records economic activity in its stored currency and account context.
- Category splits are multiple lines of one purchase. The sum of the split lines must equal the original economic amount.
- Transfers are paired movements between accounts and are not spending or income.
- Transfer rows must carry `group_kind = transfer` and an explicit `transfer_direction` of `out` or `in`; non-transfer groups must not carry a transfer direction.
- A credit-card payment is a transfer/debt settlement, not new spending. The underlying purchase is the spend.
- An investment purchase recorded as a cash-flow transaction is categorized as savings/investment movement under current behavior; it must not also create or modify an authoritative holding unless supported by broker-sourced facts.
- Duplicate intake events must create one financial effect. Preserve idempotency keys and atomic intake functions.
- Deletion uses `deleted_at` for transaction history. Group operations must preserve the same soft-delete semantics.

## Income, spend, cash flow, and savings

- **Legacy non-migrated-consumer spend:** non-deleted transactions whose category is not `Transfer`, converted to AED using the shared FX helper. Uncategorised transactions are still spend. Home and Reports no longer use this approximation on SHR-122; non-migrated consumers may still do so until separately reviewed.
- **Current income:** rows in the `income` table for the selected period, converted using the same FX rules.
- **Legacy non-migrated-consumer cash flow:** income minus legacy spend for the same period and reporting basis.
- Internal transfers are excluded from both spend and income.
- Recurring rows describe obligations/expectations and must not be added to ledger actuals without an explicit metric definition; doing so can double count.
- Non-migrated screens may still derive legacy savings approximations. Home and Reports use the canonical Phase A definitions below on SHR-122; remaining consumer migration is separately reviewed work.

## Accounts, liabilities, and net worth

- Account value is stored in the account currency and converted through the canonical FX layer.
- Assets and liabilities are distinguished by `is_liability`/account type. Liability magnitudes reduce net worth once; do not double-apply a negative sign.
- **Net worth = total converted assets - total converted liabilities.**
- Internal transfers and credit-card payments do not change household net worth by themselves.
- `nw_daily` is the daily history authority. Existing rows with null run provenance are immutable legacy facts; do not backfill, reconstruct, or rewrite them to make a chart continuous.
- `nw_snapshots` is deprecated and remains unpopulated by SHR-113. Monthly views must derive from qualified `nw_daily` points without inventing missing days.
- A Phase-A authoritative point is a Dubai reporting-date valuation close with its actual `snapshot_at`; it does not claim every source fact existed by Dubai 23:59:59.
- Missing/invalid canonical monetary input publishes no `nw_daily` row. The logical run records `skipped_incomplete`; a plausible partial balance sheet is forbidden.
- SHR-113 publication policy v1 alone requires FX fetched within six hours; quoted investments are Complete at a trustworthy provider quote/session age up to 36 hours, Provisional over 36 and through 96 hours after an evidenced failed refresh, and Incomplete beyond 96 hours or without a trustworthy provider timestamp. These thresholds do not alter SHR-111 canonical views.
- Manual investments and valid older manual bank/liability balances are Provisional with age/reason evidence. Daily user reconfirmation is not required. Provider fetch time and provider quote/session time remain distinct facts.
- One point may be published per Dubai day. Duplicate/concurrent execution is idempotent; an existing daily point is never automatically replaced. Phase A manual recovery may fill only a missing past day and does not promote/revise a published day.

## Budgets and recurring commitments

- Budget actual uses the same spend definition as reporting, including uncategorised spend and excluding transfers.
- A missing budget line is a data-quality signal, not permission to omit actual spend.
- Recurring monthly equivalents must respect start/end dates, cadence, currency conversion, and the current Dubai-local date boundary.
- Credit-card cycle spend is a floor based on logged transactions, never a forecast of the bill. Missing purchases make it incomplete.

## Goals, debts, and forecasting

- Save-up and pay-down goals share the `goals` entity but remain distinct financial meanings.
- Goal progress comes from the goal's defined starting/current basis plus recorded `goal_contributions`; a transaction `goal_id` is display-only and is not a contribution.
- Contribution-with-transfer operations must be atomic where they affect both a goal and an account.
- Forecasts and FIRE outputs are scenarios based on explicit assumptions, not promises or current balances.
- Forecast events alter scenario projections only; they must not mutate ledger history.
- Legacy screens retain their implemented goal/debt formulas until migrated. SHR-111 resolves the Phase A canonical goal/debt and savings-rate contracts below.

## Required invariant tests for changes

Relevant work should prove, as applicable:

- assets minus liabilities equals net worth;
- transfers have zero household spend and one balanced economic movement;
- split lines reconcile to their parent amount;
- duplicate external events have one effect;
- missing FX/price inputs cannot produce a deceptively complete total;
- soft-deleted rows are excluded without destroying history;
- one household member cannot bypass the household authorization boundary;
- goal/debt progress changes only through its defined primitives.

## SHR-111 Phase A canonical contracts

Status: accepted and applied to production through migration `042`. Home and Reports canonical consumer migration is implemented on SHR-122 pending independent code and preview QA; other consumers remain separately gated.

- `posted_income` is posted `income` rows. Recurring income remains expected/planned.
- `consumption_spend` excludes typed transfers, legacy exact `Transfer`, and exact `Savings & Investments`. Uncategorised consumption counts; a negative category refund reduces it.
- `savings_movement` is exact `Savings & Investments` transaction movement and is never silently collapsed into consumption.
- `cash_retained = posted_income - consumption_spend - savings_movement`.
- `cash_flow = cash_retained` for this contract.
- `savings = cash_retained + savings_movement = posted_income - consumption_spend`.
- savings rate is `100 × savings / posted_income` only when required income/consumption inputs are complete and posted income is positive. Zero/negative income returns NULL plus `nonpositive_income`.
- Nonzero `needs_review` rows contribute provisionally. An unresolved zero placeholder makes its affected aggregate incomplete. Missing required FX/input makes dependent monetary outputs NULL.
- Monetary aggregation is Postgres `numeric`; canonical AED outputs round to two decimals. Current-rate AED is the Phase A compatibility basis and reports its FX timestamp/missing currencies.
- Current assets and liabilities use canonical account values with positive liability magnitudes. Net worth equals rounded assets minus rounded liabilities exactly.
- Quoted investment value is quantity × authoritative last price. Canonical P&L is unrealized all-time value minus quantity × average cost. Manual valuations are provisional; missing cost/value/FX is incomplete. Freshness timestamps are exposed without inventing a universal stale threshold.
- Linked save-up progress uses the linked canonical account value and does not add contributions. Unlinked save-up uses implicit-AED contributions. Linked debt progress uses AED starting balance minus canonical liability balance; contribution/payment activity is reconciliation evidence and raw negative progress is valid.
- Goal quality is kind-specific: a save-up goal requires positive `target_amount`; a pay-down goal instead requires positive AED `starting_balance`, a valid linked liability, and a linked canonical valuation that is not incomplete. Pay-down completeness never fabricates or depends on `target_amount`.
- New/replaced category splits store one original amount/currency and reconcile at two-decimal precision. Cross-currency splits are forbidden. Legacy splits without identity remain visible but incomplete; no history is backfilled.
