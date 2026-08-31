# SHR-197 implementation handoff

Status: capability and evidence implementation complete; independent Tier-3 category/data reconciliation review required before merge or any production authorization.

## Git and release boundary

- Issue: `SHR-197 — Category stable-reference reconciliation and evidence manifest`.
- PR: `#30` from `shreydxb1/shr-197-category-stable-reference-reconciliation-and-evidence`.
- Base: `a35eb62df303036630e6f588c113b07bd0206b07`, the fetched and verified `origin/main` at implementation start.
- Migration: `050_category_stable_reference_reconciliation.sql` only.
- Production was inspected read-only and remains at migration 044. Migrations 045–050 were not applied.
- No production manifest was created, inferred, approved, or executed. No production UUID mapping appears in this branch.
- Migration 045 still must release with its reviewed backup source. This branch updates that source for migration 050 but does not deploy it.
- The immutable final head and exact-head CI run identifiers are recorded in PR #30 and the Linear implementation handoff after CI completes.

## Additive stable-reference schema

- Adds nullable `public.transactions.category_id` and `public.category_rules.category_id` references to `public.categories(id)` with `ON UPDATE RESTRICT ON DELETE RESTRICT`.
- Migration application is inert: it seeds no system code, performs no backfill, and changes no legacy classification text.
- `NULL` remains a valid unresolved/uncategorized value. It is never converted to `Other`.
- Active and soft-deleted transactions use the same explicit reconciliation path.
- No V1 reader, writer, calculation, rule resolver, Telegram path, or consumer is cut over to the new references.
- Existing migration 046 category lifecycle, alias/history, rename, archive/reactivation, and hard-delete protections are preserved.

## Evidence-gated reconciliation

- `private.category_reconciliation_preflight_v1()` produces exact deterministic evidence: category UUID/name/system-code/archive state and transaction/rule counts by legacy label, including NULL, unknown, ambiguous, active, and soft-deleted coverage.
- `private.category_reconciliation_state_digest_v1()` and `private.category_classification_text_digest_v1()` bind the complete reviewed source state and byte-preserved V1 classification text with SHA-256 digests.
- `private.reconcile_category_references_v1(...)` accepts only an explicit, exhaustive manifest and the exact expected preflight digest/counts. It never derives a target UUID from a live category-name join.
- The only permitted initial system codes are `transfer` and `savings_investment`; both require explicit reviewed UUIDs. Any missing, extra, duplicate, stale, ambiguous, mismatched, or invalid declaration aborts before mutation.
- Every distinct non-NULL transaction or rule label must have exactly one manifest decision: `mapped` with an explicit category UUID or `unresolved_unknown` without one. Unknown values remain unresolved.
- Table/advisory locks, complete prechecks, and one database transaction provide fail-closed, no-partial-write behavior.
- Exact same manifest reference plus exact same content is an idempotent replay. Reusing a reference with different content fails closed.

## Durable evidence and audit boundary

- Append-only evidence tables record reviewed state, exact approved manifest content, explicit system assignments, per-row resolutions, unresolved rows, execution time, replay receipts, and mismatch status:
  - `category_reconciliation_runs`
  - `category_reconciliation_system_entries`
  - `category_reconciliation_manifest_entries`
  - `category_reconciliation_row_evidence`
  - `category_reconciliation_replay_evidence`
- UPDATE, DELETE, and TRUNCATE are guarded; raw API roles cannot mutate evidence or invoke private preflight/reconciliation functions.
- `private.category_reconciliation_mismatch_report_v1(run_id)` deterministically reports post-run reference/text drift against evidence.
- SHR-191's typed `audit_events` contract is unchanged. The bounded append-only reconciliation ledger is the audit surface for this one-time classification-reference capability; no generic financial audit payload was introduced.
- Evidence stores identifiers, legacy labels, resolution outcomes, counts, and digests only; it does not copy transaction amounts, descriptions, notes, or other raw financial payloads.

## RLS and ACL evidence

- Existing household authorization remains rooted in `private.is_household_member`; economic-party ownership is not used as authorization.
- Existing transaction, rule, and category RLS policies and grants are not broadened.
- New evidence tables have RLS enabled with no raw API policies. `anon` and `authenticated` have no privileges; `service_role` receives SELECT only for backup export.
- Private functions have PUBLIC/anon/authenticated/service-role EXECUTE revoked. Reconciliation therefore requires a deliberately privileged database session and does not create an API mutation surface.
- Stable-reference guard triggers prevent ordinary API roles from inserting or changing `category_id`; an outsider still sees zero writable household rows.
- FK rejection, archived-category explicit mapping, system-category guards, hard-delete/TRUNCATE protections, and category lifecycle non-regression are covered by database tests.

## Classification and financial parity

- Reconciliation writes only stable UUID references and the two controlled system codes; transaction `category` and rule `category` text are asserted byte-identical before and after.
- A classification digest covers every active and soft-deleted transaction plus every category rule, preserving NULL explicitly.
- NULL and `Other` are independently tested as distinct states; archived and unknown labels remain independently represented.
- The canonical financial parity runner remains unchanged and passes because no V1 calculation consumes `category_id` or `system_code`.
- This capability preserves current classification only. It asserts no provenance verification, transfer pairing/group repair, transaction correction, or historical semantic reconstruction.

## Backup and restore

- Backup export now includes category system codes, both stable-reference columns, and all reconciliation evidence tables.
- Restore ordering is categories → accounts → stable-referencing transactions/rules → reconciliation run/manifest/row/replay evidence, preserving foreign keys.
- Round-trip tests cover stable UUIDs, both system codes, active and soft-deleted transactions, NULLs, archived-category evidence, exact legacy text, and replay evidence.
- Backup format/version compatibility remains coupled to the migration release order; no backup function was deployed.

## Validation

- `npm ci`: PASS.
- `npm run lint`: PASS with 0 errors and 7 pre-existing warnings.
- `npm run test:node`: PASS, 534/534.
- `npm run test:ui`: PASS, 91/91 across 9 files.
- `npm run test:db`: PostgreSQL-backed CI coverage includes fresh setup, six dedicated upgrade/restart/replay runners, and 348 database tests. Exact-head result is recorded externally in PR #30 and Linear.
- `npm run build`: PASS, 216 modules transformed.
- `npm audit --omit=dev --audit-level=high`: PASS, 0 vulnerabilities.
- `git diff --check`: PASS.
- Local PostgreSQL was unavailable, so PostgreSQL execution evidence comes from the repository's GitHub Actions PostgreSQL service on the exact PR head.

## Reviewer hotspots

1. Verify canonical JSON/digest ordering binds every stated preflight dimension and cannot admit stale evidence.
2. Verify exhaustive manifest validation, explicit UUID writes, ambiguity/unknown handling, and no hidden live-name authority.
3. Verify locking and prevalidation put every expected mismatch before the first write and rollback late failures atomically.
4. Verify exact replay versus conflicting-reference semantics and append-only evidence protection.
5. Verify stable-reference guards, RESTRICT FKs, existing category lifecycle protections, and household RLS/ACL non-regression.
6. Verify backup ordering and the migration-045/reviewed-backup release coupling before any production authorization.

## Explicit stop boundary

- Do not merge or self-approve this PR.
- Do not apply migration 050 or migrations 045–049 to production.
- Do not infer production system-category UUIDs from names or construct a production manifest without explicit human approval in Linear.
- Do not run reconciliation, deploy backup code, modify production data, or start SHR-198/SHR-195 from this handoff.
