# Our Money v5 architecture

Status: canonical v5 direction, updated for SHR-113 Phase C planning. Statements labeled **current** describe repository implementation. Production is verified through migration `043` and the reviewed Phase-B Edge/frontend deployments. The Phase-C scheduler configuration is repository-only pending independent review and is not active.

## Product boundary

Our Money is a private, two-person household financial operating system for budgeting, cash flow, accounts, investments, liabilities, goals, forecasting, and net worth. It preserves and evolves the existing production system; v5 is not a rewrite.

## Current system

The repository currently implements:

- React + Vite browser application with Supabase authentication.
- Ten top-level screens: Home, Accounts, Investments, Transactions, Reports, Budget, Recurring, Goals, Debts, and Settings.
- Direct browser access to household-scoped Supabase tables through RLS, plus RPCs for writes that require atomic multi-row behavior.
- Supabase Postgres as the durable financial store, Realtime subscriptions for selected tables, and Edge Functions for Telegram intake, FX/price refresh, and backup work.
- Netlify build/deployment configuration and GitHub Actions for lint, unit tests, build, dependency audit, and database integration tests.
- AED as the base reporting currency, with USD/INR display conversion and explicit missing-rate behavior.

Repository implementation and production deployment can differ. GitHub describes implemented behavior; the deployed Netlify commit and live Supabase describe production state and must be checked independently during QA.

## Current data flow

```text
manual UI / Telegram intake / refresh functions
                    |
                    v
        Supabase tables and validated RPCs
                    |
          RLS + household membership
                    |
                    v
   src/lib domain/data helpers + React hooks
                    |
                    v
        screens and reusable components
```

Authoritative persisted facts live in Postgres. Client helpers currently calculate several presentation and planning metrics. That is implemented behavior, not permission for each screen to create its own definition.

## v5 information architecture

The intended v5 navigation is:

- **Overview:** decision-oriented household command center.
- **Money:** transactions, review, accounts used for spending, budgets, recurring obligations, and money flow.
- **Wealth:** assets, investments, liabilities, net worth, allocation, performance, and attribution.
- **Planning:** goals, debt payoff, forecasts, FIRE, scenarios, and future obligations.
- **Settings:** household, categories, currency/FX, integrations, and controlled configuration.

This consolidation is **planned**. The current ten-screen structure remains implemented until a separately scoped issue changes it.

## Domain boundaries

- **Ledger:** transactions, splits, transfers, review state, soft deletion, idempotency, and receipt items.
- **Income and cash flow:** income records, spend classification, recurring commitments, budgets, and reporting periods.
- **Accounts and valuation:** assets, liabilities, holdings, price provenance, currency conversion, and net-worth snapshots.
- **Wealth:** investment positions, allocation, gains/losses, liabilities, and net-worth history.
- **Goals and planning:** save-up/pay-down goals, contributions, forecast assumptions/events, FIRE, and future scenarios.
- **Household and access:** authentication, membership, ownership labels, preferences, RLS, and privileged operations.
- **Intake and automation:** Telegram extraction/routing, guarded writes, proposals, notifications, refresh jobs, and backup.

Dependencies should point toward shared domain primitives. Presentation code may format and compose results; it must not redefine financial semantics.

## Canonical metric direction

V5 requires one named implementation for each core metric: income, spend, cash flow, savings, savings rate, assets, liabilities, net worth, investment value, goal progress, debt progress, and budget actual.

Migration `041` implements the additive Phase A database foundation: security-invoker canonical ledger, posted-income, account/holding, and goal-progress views plus period, balance-sheet, investment, and budget-actual functions. Every result keeps `consumption_spend`, `savings_movement`, `cash_retained`, `savings`, and `cash_flow` distinct and carries completeness/provisional/missing-input metadata.

Home and Reports consume the canonical Phase A contracts in production after SHR-122: period headlines come directly from `canonical_period_metrics`, category actuals from `canonical_budget_actuals`, and presentation groupings from canonical AED ledger/income facts. Realtime payloads only invalidate and refetch those contracts. Planning helpers, Telegram queries, forecasting, and other consumers remain on their existing APIs until separately reviewed migrations.

Accounts consumes `canonical_balance_sheet`, `canonical_investment_metrics`, and `v_canonical_accounts_aed` for current wealth values. It reads `nw_daily` history and never creates a historical point on mount/open. Production SHR-113 Phase B adds one trusted orchestration Edge Function: it refreshes FX and investment prices through shared provider modules, records provider evidence, and asks service-only Postgres contracts to claim/evaluate/capture. The Edge Function never calculates authoritative money. Production still has no scheduler installed or active.

Postgres/database logic remains authoritative for durable money calculations and integrity constraints. AI may route, extract, explain, or propose; it must use closed, reviewed operations and canonical computed results.

## Security and operational architecture

- RLS is enabled on application tables and household membership is the access boundary.
- `private.is_household_member()` is a non-exposed security-definer primitive with an empty pinned search path because membership-policy recursion otherwise occurs. Authenticated receives only schema usage and function execution needed by RLS; the schema must not be exposed through the Data API.
- Public reporting views over household data, including `v_transactions_aed`, use caller privileges with `security_invoker` so their underlying table RLS remains authoritative.
- The service role belongs only in trusted server/Edge Function code.
- `pending_actions` is trusted Telegram coordination and audit state, not household browser data. It is policy-free with RLS enabled, grants no table or RPC access to anonymous/authenticated callers, and grants the service role direct `SELECT` only. Proposal creation, one-time prompt binding, claim, apply, cancel, and expiry are six service-role-only `SECURITY DEFINER` RPCs with an empty pinned `search_path` and fully qualified references. Their atomic predicates preserve requester + chat + prompt binding, database-time expiry, immutable proposal identity, and non-reopenable terminal state without granting the Edge Function direct state-column updates.
- Multi-row financial writes use atomic database functions where implemented.
- Production migrations and deployments are explicit gated actions, not automatic consequences of implementation.
- Schema evolution remains additive by default because production contains real financial history.
- The planned Phase-C net-worth scheduler is an explicit hosted operational gate, separate from the portable schema migration chain. One postgres-owned pg_cron job at 22:00 UTC calls a private SECURITY INVOKER dispatcher; URL, least-privilege platform JWT, and operator secret come only from Vault. No browser/API role can execute the dispatcher.

## Known current limitations and planned work

- The current UI has ten top-level screens; v5 consolidation is not implemented.
- FX settings are current-rate values, not a historical FX ledger. Historical reporting therefore uses the current repository convention unless a future issue introduces dated valuation.
- Existing `nw_daily` rows are preserved legacy facts with null provenance. Production migration `043` can publish qualified Complete/Provisional daily valuation closes through service-only contracts, but no scheduler is active and no authoritative production run exists at the Phase-C planning baseline.
- `nw_snapshots` remains deprecated and is not populated. Gaps and skipped-incomplete days remain visible gaps; historical FX/quotes/account values are not invented.
- Investment positions and transaction cash flows are separate concepts. Typed chat investment purchases currently record cash outflow, not authoritative holding quantity/cost.
- The codebase supports two known people plus Joint labels, while access is enforced by authenticated household membership rather than row-level owner isolation.
- Repository comments and historical docs may state a migration was live on a past date. Treat that as evidence from that date, not a substitute for checking current live state.
