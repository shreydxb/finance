# Our Money v5 architecture

Status: canonical implemented direction, updated through the SHR-197 repository package. Statements labeled **current** describe repository implementation. Production is verified through migration `044`; migrations `045`–`050` and their backup-manifest changes are repository-only pending independent review and are not applied or deployed.

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
- Migration `045` adds `audit_events` as immutable, post-cutover-only action evidence. It is not ownership, provenance, quality, attention, integration logging, or telemetry. Browser roles have no raw table privileges; service role has raw SELECT only for encrypted backup. An owner-only private append primitive is reached in this package only through a service-only, typed QA fixture RPC, and future production actions require their own reviewed wrappers. Authenticated household reads use the redacted `audit_history_v1` RPC, which derives `auth.uid()`, authorizes through `private.is_household_member()`, and never returns the private Telegram sender reference.
- Audit UPDATE/DELETE is rejected by a database trigger even after an accidental application-role grant. The actual trust boundary is explicit: the database owner can intentionally change DDL, disable a trigger, or bypass the contract and therefore remains an administrative trust root.
- Migration `046` adds the category lifecycle and system-code protection substrate. Category UUID is the authoritative identity; `categories.name` stays presentation text and is never made a durable financial key. `categories.system_code` accepts only `transfer` or `savings_investment`, is unique, remains NULL on every row in this package, may be assigned only through the database-owner/migration path, and is immutable to every path once set. A registered system category cannot be archived or deleted by any path, enforced by both a guard trigger and a check constraint. Category hard delete and truncate are refused for every role — v6 removal semantics are archive. Rename, archive and reactivation are likewise refused for every role, the database owner's ordinary `UPDATE` included: category text still carries financial meaning, SHR-157 R12 requires a measurable zero-text-semantic-consumer inventory before a label may change, and no archive eligibility predicate is consulted at all because SHR-167 owns the current-plan predicate and SHR-160 owns atomic rule lifecycle. The distinction the guards draw is between an operational lifecycle transition, which is unavailable, and restoring historical state, which stays possible: only an `INSERT` on the operator path may carry an archive timestamp, and that cannot become an archive capability because archiving a live category that way would require deleting it first.
- `category_name_history` is immutable rename evidence written by the database on any name change; it never makes a former label resolvable. No production rename reaches it while the guard refuses every name change — it is wired now so the package that eventually meets the gate cannot enable rename without evidence, and QA exercises it through an owner-DDL fixture rather than any callable path. `category_aliases` is the separate, explicitly registered compatibility surface with a `compatibility_active` → terminal `history_only` lifecycle. Only active aliases participate in ambiguity blocking, so retirement releases an ordinary former label rather than reserving it forever. Both tables are member-readable through `private.is_household_member()` and writable by no API role; category lifecycle and `system_code` are never authorization predicates and no taxonomy administrator role exists.
- Migration `050` adds dormant stable category identity beside legacy text. An owner-only, evidence-gated reconciliation accepts only an explicit, exhaustively checked manifest: the exact two system-code UUIDs and a decision for every distinct non-NULL transaction/rule label. Its deterministic preflight covers category lifecycle/system-code state, active and soft-deleted counts, NULLs, unknowns and ambiguity. Stale evidence, ambiguity, missing decisions, conflicting replays and invalid UUIDs abort atomically. The migration embeds no production mapping, performs no name-join backfill, changes no legacy classification text or V1 consumer, and does not claim provenance. Immutable category-domain evidence is its audit contract; `audit_events` is intentionally unchanged.
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
- The codebase supports two known people plus Joint labels, while access is enforced by authenticated household membership rather than row-level owner isolation. Repository migration `049` adds an additive stable account-ownership reference (`accounts.ownership_kind`/`owner_party_id`) beside that text, but no consumer reads it: every account is `unreconciled`, no manifest is approved, and the label remains the operative semantics until SHR-173, SHR-153, SHR-172 and SHR-158 cut their own surfaces over.
- The SHR-191 audit registry initially admits only two QA fixture actions. No production financial/category/party/Telegram writer is audited until a later domain package extends the allowlist and adopts atomic audit inside that writer. SHR-196 deliberately does not extend it: it enables no live rename or archive action, so there is nothing new to audit yet.
- SHR-197 adds evidence-reviewed system-code and stable-reference reconciliation capability, but no production manifest is approved or embedded. Category classification still runs on category text exactly as before; stable references remain NULL until a separately approved reconciliation, and no resolver or consumer cutover exists. The legacy `Transfer` and `Savings & Investments` rows keep their current classification without being credited with verified provenance. SHR-198 owns the V2 resolver, classification and writer compatibility.
- SHR-194 registers the first non-QA typed policy on the SHR-191 audit substrate: mapping decisions. The registry now admits the two QA fixture actions plus three `economic.access_party_mapping.*` actions, whose evidence is derived from the immutable decision-history row rather than asserted alongside it. No financial, category or Telegram writer is audited yet.
- SHR-194 adds reconciliation capability, not reconciled data. Applying migration `048` creates no economic household, party, mapping decision or audit event; a separately approved manifest does, through `private.reconcile_access_parties_v1()`, and no manifest is approved. See `docs/data-ops/shr-194-access-party-manifest.md`.
- Economic identity remains reporting scope only. `public.access_scope_context_v1()` is the one product surface it exposes — the caller's own access state, their economic party if any, and the household's valid scope choices. It returns no amount, no allocation and no fractional share, and it authorizes only through `private.is_household_member()`. No financial consumer reads it yet: SHR-154, SHR-171, SHR-178 and SHR-195 own account, recurring, goal and transaction attribution respectively.
- Repository comments and historical docs may state a migration was live on a past date. Treat that as evidence from that date, not a substitute for checking current live state.
