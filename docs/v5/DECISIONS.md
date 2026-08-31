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

Status: accepted; Phase A foundation and debt-quality correction applied to production through migration `042` — 2026-08-23 — SHR-108 / SHR-111

Income, spend, cash flow, savings, savings rate, assets, liabilities, net worth, investment value, goal progress, debt progress, and budget actual each require one shared definition and implementation.

Current consumers still distribute calculations across database views and client helpers, so reconciliation remains incremental. SHR-111/ADR-015 resolves the Phase A semantics and implements additive database contracts; consumer migration and historical dated-FX attribution remain separately reviewed work.

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

## ADR-013 — RLS helpers stay outside the exposed API surface

Status: accepted and applied to production — 2026-08-22 — SHR-109 / SHR-119

Household reporting views execute with caller privileges so underlying RLS remains authoritative. A helper that genuinely requires `SECURITY DEFINER` for policy evaluation stays in a non-exposed schema with a pinned search path and only the grants needed by the policy role.

For the current implementation, `v_transactions_aed` is `SECURITY INVOKER` and the existing membership-helper function object moves from `public` to `private`. Moving the object preserves policy dependencies while removing the unnecessary PostgREST RPC surface. The `private` schema must never be configured as a Supabase Data API exposed schema.

## ADR-014 — Pending actions are server-only guarded state machines

Status: accepted, implemented, and applied to production — 2026-08-23 — SHR-110 / SHR-120

`pending_actions` is operational authorization and audit state owned by the trusted Telegram Edge Function, not shared household application data. Anonymous and authenticated callers need neither table access nor transition-RPC access. The service role has direct read access only.

Every mutation—create, one-time prompt bind, claim, apply, cancel, and expire—uses a narrowly scoped `SECURITY DEFINER` RPC executable only by `service_role`, with an empty pinned `search_path` and fully schema-qualified references. This exception is required because a `SECURITY INVOKER` transition would need direct service-role `UPDATE` grants on guarded state columns, creating a parallel bypass around requester/chat/prompt, expiry, replay, and state predicates.

Proposal identity and payload are immutable after creation; request keys are idempotent and collision-checked. A successful atomic claim is required before the financial handler runs, and a terminal resolution cannot reopen. If a handler's success is uncertain, the action remains claimed and unresolved for audit/manual reconciliation rather than becoming replayable.

## ADR-015 — Canonical financial metrics preserve economic decomposition and quality

Status: accepted and applied to production through migration `042` — 2026-08-23 — SHR-111 Phase A

Posted income is separate from recurring expected income. Canonical transaction classification has three mutually exclusive economic classes: `consumption_spend`, `savings_movement`, and `internal_transfer`. Typed transfers and legacy exact `Transfer` rows are internal movements; exact `Savings & Investments` rows are savings movements; all remaining active rows, including uncategorised rows and negative category refunds, are consumption spend.

The period contracts keep five meanings separate:

- `cash_retained = posted_income - consumption_spend - savings_movement`;
- `cash_flow = cash_retained`;
- `savings = posted_income - consumption_spend`;
- `savings_movement` is the explicit allocation component; and
- savings rate is `100 × savings / posted_income` only for complete inputs and positive income, otherwise NULL with a reason.

Nonzero `needs_review` money is included provisionally. An unresolved zero placeholder or missing required FX/input makes dependent metrics incomplete and NULL, not plausible partial totals. Current-rate AED remains the Phase A compatibility basis and outputs round in Postgres `numeric` to two decimals.

Assets and liabilities use current canonical account values with positive liability magnitudes; net worth is rounded assets minus rounded liabilities. Quoted investment value is quantity × authoritative last price; manual values stay available only as provisional, and missing cost basis makes unrealized all-time P&L incomplete. No universal stale threshold is invented; valuation timestamps are exposed and callers may supply a reviewed threshold.

Linked save-up goals use linked account value and treat contributions as activity only. Unlinked save-up goals use implicit-AED contributions. Pay-down goals use AED starting balance minus authoritative linked-liability value, with raw negative progress preserved. Historical `nw_daily` facts remain unchanged.

Migration `041` implements additive security-invoker views/functions and split-original identity for new/replaced splits. Migration `042` corrects the implementation so only save-up goals require a positive target; pay-down quality follows the already-approved starting-balance plus linked-liability authority. Existing APIs and consumers remain on legacy outputs until separately reviewed consumer migrations.

## ADR-016 — Daily net worth is a qualified server-captured valuation close

Status: accepted, implemented, and applied to production through Phase B; scheduler remains inactive — 2026-08-24 — SHR-113

`nw_daily` is the long-term daily authority; `nw_snapshots` remains deprecated. Existing daily rows are preserved as legacy facts with unknown provenance and are never silently recomputed. One logical run exists per Dubai reporting date, while append-only attempt events preserve every retry/failure and an immutable item manifest preserves the exact qualified valuation inputs of a publication.

The point is a valuation close labeled by Dubai `target_day` and stamped with the actual `snapshot_at`; it does not imply all source facts existed before the target day's 23:59:59. Provider fetch and quote/session timestamps are distinct. Snapshot policy v1 freshness thresholds are local to SHR-113 and do not change SHR-111 canonical contracts.

Only trusted service orchestration can claim/capture. Postgres/canonical contracts calculate money and fail closed: missing or invalid canonical inputs produce a `skipped_incomplete` run and no daily point. Complete and Provisional are explicit; no plausible partial balance sheet, revision, automatic replacement, historical reconstruction, or scheduler activation is permitted in Phase A. Accounts is a canonical-value/history reader and opening it has no snapshot write side effect.

## ADR-017 — One post-close UTC job dispatches the previous Dubai reporting day

Status: accepted Phase-C implementation plan; repository configuration pending independent review and production activation remains unauthorized — 2026-08-24 — SHR-113 / SHR-124

The authoritative snapshot scheduler has one intended invocation per reporting day: one named pg_cron job runs at `0 22 * * *` in production GMT/UTC, which is 02:00 Asia/Dubai after the target day closed. The dispatcher derives the previous Dubai calendar day and sends it explicitly; the existing claim contract independently validates the same date boundary.

There is no automatic cron retry window. Failures that reach orchestration remain durable in the logical run and append-only attempt model; an operator may recover only a still-missing past day through the existing protected `manual_recovery` contract. Target-day uniqueness, advisory locking, and immutable daily history prevent duplicate publication, replacement, or Legacy-row modification.

The permanent scheduler configuration is version-controlled under `supabase/scheduler/` but deliberately separate from the portable application-schema migration chain, because applying it is a separately approved hosted-infrastructure gate. A private postgres-owned SECURITY INVOKER dispatcher reads the function URL, least-privilege platform JWT, and operator secret from Vault, pins an empty search path, and is executable by no API role. pg_cron/pg_net evidence and Edge logs provide transport observability; the existing snapshot run/attempt/item model remains the authoritative business evidence.

## ADR-018 — Audit is immutable typed action evidence, not domain truth

Status: accepted, independently reviewed, and merged in repository migration `045`; production apply pending — 2026-08-31 — SHR-191

`audit_events` records who/what performed an allowlisted action, the typed target/evidence references, request/correlation/causation/idempotency references, outcome, and a minimized action-specific change projection. It does not determine economic ownership, fact provenance, financial quality, attention, integration health, notification delivery, or telemetry.

Raw browser DML is absent. An owner-only private append primitive is reachable only through independently reviewed typed wrappers; SHR-191 provides a service-only QA wrapper and no production mutation integration. Authenticated reads use a redacted definer RPC whose authorization root remains `private.is_household_member()`. Actor, owner, party, category, and Telegram identity are forbidden as RLS predicates.

Successful replay returns the original event only when the canonical payload is identical. A collision fails and distinct actions do not collapse. UPDATE/DELETE triggers protect immutable evidence even after accidental application-role grants, while the database owner remains the explicit DDL/administrative trust boundary. No historical audit is synthesized and V1 has no purge.

## ADR-019 — Category identity is UUID; lifecycle evidence and resolver aliases are separate

Status: accepted and implemented in review migration `046`; independent Tier-3 review and production apply pending — 2026-08-31 — SHR-196 / SHR-157

Category UUID is identity. Display name remains frozen V1 compatibility data until a measurable zero-text-semantic-consumer gate is satisfied. Uncategorized is null, never `Other` or a fabricated category.

Only `transfer` and `savings_investment` are valid initial system-code values. SHR-196 seeds neither. Browser/service DML cannot assign codes; the database-owner migration/restore path may make a first reviewed assignment, after which the code is immutable and the category cannot be archived/deleted. This does not change current exact-name financial classification; SHR-197 owns reviewed assignments/stable-reference reconciliation and SHR-198 owns resolver/classification/writer compatibility.

Immutable `category_name_history` records historical rename evidence and does not resolve. `category_aliases` separately records exact compatibility-active aliases that can retire irreversibly to history-only. Only active aliases reserve an exact label. No normalization algorithm or permanent reservation of ordinary historical labels is invented.

Rename, archive/reactivation, hard delete, and truncate are fail-closed. Archive stays disabled until an evidence-backed budget predicate and SHR-160 atomic rule lifecycle exist. Existing household membership remains the only RLS authorization root; no taxonomy administrator role or category/system-code authorization predicate exists.

