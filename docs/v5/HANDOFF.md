# Our Money v6 handoff — SHR-191 immutable audit substrate

Date: 31 August 2026

Branch: `shreydxb1/shr-191-immutable-audit-substrate-and-typed-reference-boundary`

Exact reviewed base: `53195835d9f22de328ec7c0073b325525c85a7fa`

The immutable PR head, PR URL, and final CI conclusions are recorded in the SHR-191 Linear implementation handoff because embedding a commit's own SHA would change it.

## Outcome

This bounded Tier-3 package introduces the first V6.0 audit substrate: immutable action evidence in `public.audit_events`, a private typed append function, a redacted authenticated household-member read function, and a service-only QA reference flow. It does not connect any production financial writer.

Audit evidence records who or what performed an allowed action. It is deliberately separate from economic ownership, provenance, financial quality, attention, integration observations, and generic telemetry.

## Database contract

Migration `045_immutable_audit_substrate.sql` creates:

- `public.audit_events`, with exclusive actor representations for authenticated access user, private hashed Telegram sender reference, service actor, or system actor;
- typed/versioned action, target, and evidence references;
- request, correlation, causation, and hashed idempotency references;
- typed outcomes, minimized allowlisted change evidence, schema/redaction/history versions, and a canonical payload digest;
- an update/delete rejection trigger protecting ordinary and accidentally privileged application paths;
- `private.append_audit_event_v1(...)`, an owner-controlled `SECURITY DEFINER` append boundary with exact-replay return, conflicting-replay rejection, and race-safe uniqueness;
- `public.audit_history_v1(...)`, an authenticated redacted read boundary whose authorization root remains `private.is_household_member(...)`; and
- `public.record_audit_qa_fixture_v1(...)`, a service-only fixture/reference flow used solely by QA.

The initial allowlist contains only `audit.qa_fixture.recorded` and `audit.qa_fixture.verified`, with fixed `audit.qa_fixture` target/evidence types. Evidence shapes are exact and versioned; unknown fields, unrestricted bodies, secrets, raw Telegram identifiers, and arbitrary JSON are rejected.

## Security and immutability

The table grants no DML to `anon` or `authenticated`. `service_role` has table `SELECT` only for the backup path. The private append function is not executable by API roles, and the QA wrapper is executable only by `service_role`. The member history function is executable only by `authenticated` and derives the caller from `auth.uid()` rather than accepting an actor or household override.

RLS is enabled with an explicit deny-all raw-table policy for `anon` and `authenticated`. Household authorization remains rooted exclusively in the existing private membership helper. Actor, owner, economic party, category, and Telegram sender are never authorization predicates. Economic party is not present in the audit schema and is never inferred from actor identity.

The mutation trigger makes inserted evidence append-only through ordinary SQL and application roles, including an accidentally over-granted role. As with all PostgreSQL trigger-based immutability, the database owner remains the ultimate trust root and can deliberately alter or disable the protection; this package does not claim an impossible guarantee against that owner.

## Backup, restore, and migration safety

The backup manifest now includes `audit_events` as financial data. Focused database coverage exports a representative row through the manifest contract, restores it to an isolated table with the immutability trigger, compares the complete JSON representation, and proves update/delete rejection after restore.

The migration is additive, has no historical backfill, and uses guarded/restart-safe object creation or replacement. Upgrade coverage builds schema through migration 044, preserves a representative existing transaction byte-for-byte and at the same tuple identity, applies and reapplies migration 045, and confirms no audit synthesis. Fresh-path coverage uses the complete migration sequence.

## Validation

Local validation completed:

- `npm ci` — pass; 184 packages, zero vulnerabilities reported;
- `npm run lint` — pass with six pre-existing warnings and zero errors;
- `npm run test:node` — pass, 526/526 tests;
- `npm run test:ui` — pass, 9 files and 89/89 tests;
- `npm run build` — pass, 215 modules transformed;
- `npm audit --omit=dev --audit-level=high` — pass, zero vulnerabilities;
- syntax checks for both new database test runners — pass; and
- `git diff --check` — pass.

This host has no local PostgreSQL runtime, so the fresh, upgrade, restart, ACL/RLS, replay, immutability, isolation, and restore database proofs run in the repository's isolated GitHub database job. Exact-head CI evidence is recorded in Linear before independent review.

## Protected boundaries

- No transaction, category, economic-party/mapping, or other production writer integration.
- No attention, integration-observation, provenance, UI, Telegram behavior, notification, historical audit synthesis, retention purge, financial calculation, or classification change.
- No production migration, data change, deployment, or merge.
- No existing consumer behavior change.

The PR remains unmerged and is labeled `[skip netlify]` because this package has no site change.
