# Our Money v5 decisions

This is the canonical lightweight decision log. A decision records accepted direction; it does not prove implementation or production deployment. Superseded decisions remain visible.

## ADR-001 — Source truth is question-specific

Status: accepted — 2026-08-22 — SHR-108

- Live Supabase and the deployed Netlify build answer what production is doing now.
- Current GitHub code/migrations/tests answer what is implemented in the repository.
- `docs/v5/*` answers the intended v5 design.
- The current Linear v5 issue defines task scope and acceptance.
- Linear v4, Taskiv, `PLAN.md`, and `CLAUDE.md` are history.

Conflicts must be reported and reconciled explicitly. No historical source automatically overrides current implementation.

## ADR-002 — Evolve the production system; do not rewrite it

Status: accepted — 2026-08-22 — SHR-108

V5 is an incremental evolution. Database changes are additive and backwards-compatible by default, with new numbered migrations and explicit production gates.

## ADR-003 — Postgres and deterministic domain primitives own money correctness

Status: accepted — 2026-08-22 — SHR-108

Durable financial calculations, constraints, and multi-row writes belong in reviewed deterministic code, increasingly in Postgres where consistency is required. Screens consume shared primitives and may not redefine core metrics independently.

AI may extract, classify, route, explain, and propose through closed operations. It may not invent balances, perform authoritative ad hoc arithmetic, generate arbitrary production SQL, or bypass confirmation for high-consequence writes.

## ADR-004 — Missing financial inputs fail visibly

Status: accepted — carried forward and reaffirmed for v5

Missing FX rates, prices, or required valuation inputs produce unavailable/incomplete results. They must not default to 1:1, zero, or silent row omission. Database aggregates must explicitly detect NULL conversions.

## ADR-005 — Transfers, splits, deletion, and idempotency are ledger invariants

Status: accepted — implemented foundation, reaffirmed for v5

- Transfers are paired, directed movements and not spending.
- Category splits reconcile to one purchase.
- Transaction deletion is soft deletion.
- External retries have one financial effect.
- Atomic RPCs protect implemented multi-row writes.

Older untyped `split_group_id` behavior is superseded by `transaction_group_id` plus `group_kind` and `transfer_direction`.

## ADR-006 — Household membership is the authorization boundary

Status: accepted — implemented foundation, reaffirmed for v5

Authenticated membership, enforced through RLS, controls access to the shared household. Textual owner labels describe attribution and filtering; they are not security boundaries. The service role remains server-side only.

The earlier permissive authenticated policies from migration `002` are superseded by migration `023` membership policies.

## ADR-007 — High-consequence actions use propose/confirm/audit

Status: accepted — carried forward and reaffirmed for v5

Writes beyond loss-sensitive transaction intake are proposed and explicitly confirmed before application. Optimistic transaction intake may write-and-flag because a missed spend can be lost, but uncertainty remains visible and reviewable.

## ADR-008 — Investment cash flow and holdings are separate facts

Status: accepted — carried forward and reaffirmed for v5

A typed/chat-reported investment purchase may create the cash-flow record but does not mutate quantity, average cost, or price. Holdings require authoritative broker-sourced facts. This avoids silently corrupting positions.

## ADR-009 — V5 information architecture consolidates around four domains

Status: planned — 2026-08-22 — Our Money v5

The target product centers on Overview, Money, Wealth, and Planning, with Settings supporting them. Current ten-screen navigation remains until separately implemented and validated.

This supersedes treating the v4 ten-tab layout as the target architecture; it does not remove any current screen by itself.

## ADR-010 — One canonical definition per core metric

Status: accepted direction; implementation incomplete — 2026-08-22 — SHR-108

Income, spend, cash flow, savings, savings rate, assets, liabilities, net worth, investment value, goal progress, debt progress, and budget actual each require one shared definition and implementation.

Current code distributes some calculations across database views and client helpers. Reconciliation is incremental. Undefined semantics—especially canonical savings/savings rate and historical FX attribution—must be resolved in a future reviewed issue, not guessed.

## ADR-011 — Deployment is a separate, explicit stage

Status: accepted — 2026-08-22 — SHR-108

Normal flow is issue contract → implementation → validation → handoff → independent QA → approval → merge/deploy → production verification. Implementation does not authorize Supabase or Netlify production changes.

## ADR-012 — Netlify builds are budgeted and batched

Status: accepted — 2026-08-22 — operational constraint

The connected Netlify site automatically publishes production-branch changes. The current monthly allowance is 285 credits and each deploy costs 15 credits, so builds are a limited resource.

- Documentation-only and non-deployed changes merge with `[skip netlify]` in the final production commit.
- Deploy Previews and branch deploys are opt-in when their review value justifies the credit cost.
- Approved site changes are batched into deliberate releases, normally no more than weekly.
- At least two builds per month are reserved for retries and urgent fixes.
- Git state and deployed state are tracked separately because skipped commits accumulate into the next deployment.

