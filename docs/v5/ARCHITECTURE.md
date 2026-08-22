# Our Money v5 architecture

Status: canonical v5 direction, updated for the SHR-109 repository implementation. Statements labeled **current** describe repository implementation. Migration `039` remains **NOT APPLIED** to production pending SHR-119 independent QA and separate approval.

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

Today those definitions are partly distributed across Postgres, `src/lib/money.js`, `reports.js`, `fire.js`, `forecast.js`, `snapshots.js`, and screen composition. Consolidation into authoritative primitives is **planned** and must be incremental. Until then, reuse existing helpers and document discrepancies rather than introducing another calculation.

Postgres/database logic remains authoritative for durable money calculations and integrity constraints. AI may route, extract, explain, or propose; it must use closed, reviewed operations and canonical computed results.

## Security and operational architecture

- RLS is enabled on application tables and household membership is the access boundary.
- `private.is_household_member()` is a non-exposed security-definer primitive with an empty pinned search path because membership-policy recursion otherwise occurs. Authenticated receives only schema usage and function execution needed by RLS; the schema must not be exposed through the Data API.
- Public reporting views over household data, including `v_transactions_aed`, use caller privileges with `security_invoker` so their underlying table RLS remains authoritative.
- The service role belongs only in trusted server/Edge Function code.
- Multi-row financial writes use atomic database functions where implemented.
- Production migrations and deployments are explicit gated actions, not automatic consequences of implementation.
- Schema evolution remains additive by default because production contains real financial history.

## Known current limitations and planned work

- The current UI has ten top-level screens; v5 consolidation is not implemented.
- FX settings are current-rate values, not a historical FX ledger. Historical reporting therefore uses the current repository convention unless a future issue introduces dated valuation.
- `nw_daily` is a stored daily snapshot created by application behavior; authoritative scheduled snapshots and attribution are planned.
- Investment positions and transaction cash flows are separate concepts. Typed chat investment purchases currently record cash outflow, not authoritative holding quantity/cost.
- The codebase supports two known people plus Joint labels, while access is enforced by authenticated household membership rather than row-level owner isolation.
- Repository comments and historical docs may state a migration was live on a past date. Treat that as evidence from that date, not a substitute for checking current live state.
