# Database-integration tests (Taskiv #101)

`npm test` runs against fakes (`FakeStore`, in-memory jsonb) and never touches
a real database. That is fast and catches plenty, but a fake has no NOT NULL,
no indexes, no constraints — it cannot fail the way Postgres fails. Three bugs
reached production in the Aug 2026 round despite 268 passing tests, and all
three were exactly that shape:

1. `save_telegram_settings` on a one-person setup — `NULL` into a `NOT NULL`
   jsonb column.
2. `42P10` on the single-spend upsert — a partial unique index that raw SQL
   can target but PostgREST's `on_conflict=` cannot.
3. An untrimmed webhook secret — a comparison bug, not a schema one, but same
   family: real bytes the fakes never see.

This suite runs the real `supabase/schema/*.sql` files against a real
Postgres, from empty, in order — the one thing that had never been tested.

## Running locally

Needs a reachable Postgres server (role must be able to `CREATEDB`).

```bash
export DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/postgres
npm run test:db
```

`test:db` first runs `setup-db.mjs`, which:

- drops and recreates a scratch database (`our_money_test` by default —
  override with `TEST_DB_NAME`)
- creates a minimal stand-in for the Supabase-managed pieces the schema
  depends on: an `auth.users` table and `auth.uid()`, the `anon` /
  `authenticated` / `service_role` roles, and pgcrypto installed in the hosted
  `extensions` schema rather than `public`. Nothing else about Supabase is
  emulated — no PostgREST, no Storage, no Realtime server. `is_household_member()`
  and every `to authenticated` policy behave identically to production because
  they only ever call `auth.uid()`.
- seeds two `auth.users` rows *before* applying any schema file, so 023's
  `household_members` seed (which reads `auth.users` mid-migration) behaves
  the same as it did against the real two-person household
- applies `supabase/schema/001` through the highest-numbered file, in order,
  inside the same session `psql` would use — no skipping, no squashing

then runs every `supabase/db-test/**/*.test.ts` file with `node --test`.

## What's covered

- **`migrations.test.mjs`** — the apply-from-empty run itself is the test:
  `setup-db.mjs` exits non-zero on the first failing statement. This file
  asserts migration 043 resolves pgcrypto through `extensions.digest` while
  `public.digest` is absent, preventing a plain-Postgres layout from masking a
  hosted-Supabase failure. It also asserts the objects the later suites depend
  on exist. SHR-109
  coverage verifies the money view's `security_invoker` option and read-only
  grants, the private helper's schema/attributes/ACL, absence of its public RPC
  target, and every policy dependency following the moved function object.
- **`pending_actions.test.mjs`** — SHR-110 catalog and state-machine coverage:
  exact API-role table ACLs, policy-free default deny, service-only pinned
  `SECURITY DEFINER` RPC execution, anonymous/member/outsider denial,
  idempotent creation, one-time prompt binding, requester/chat/prompt isolation,
  database-time expiry, non-reopenable terminal states, contradictory-row
  constraints, and a real two-connection claim race with exactly one winner.
- **`audit-upgrade-path.mjs` + `audit_events.test.mjs`** — SHR-191 fresh,
  through-044 upgrade and restart/rerun paths; exact ACL/RLS/function matrix;
  raw client denial; trusted QA append; owner/accidentally-granted immutability;
  four actor kinds; no actor-to-owner/party/category inference; typed
  action/target/evidence/causation; forbidden payload rejection; redaction and
  household isolation; exact replay/collision/distinct-action semantics;
  append failure atomicity; backup manifest and representative restore with
  immutable evidence preserved.
- **`category-lifecycle-upgrade-path.mjs` + `category_lifecycle.test.mjs`** —
  SHR-196 fresh, through-044 → 045 → 046 upgrade and restart/rerun paths, with
  existing category ids/names/groups/icons/created_at and every category-text
  consumer proven unchanged; the closed system-code vocabulary and its
  single-anchor uniqueness; assignment, change, clear, archive, delete and
  rename attempts through `anon`, `authenticated`, `service_role`, the named
  operator functions and the database-owner path; the no-hard-delete and
  no-truncate guards; fail-closed archive while the budget and rule predicates
  are undefined; rename history that is immutable and creates no resolver
  alias; alias compatibility-active → terminal history-only lifecycle with
  collision handling and label release; the exact ACL/RLS/function matrix; and
  the backup manifest plus a representative restore that preserves ids, system
  codes, archive state, history and alias lifecycle along with their
  constraints and re-attached protections.
- **`access-party-reconciliation-upgrade-path.mjs` + `access_party_reconciliation.test.mjs`**
  — SHR-194 fresh, through-044 → 045 → 046 → 047 → 048 upgrade and
  restart/rerun paths, with every financial row proven byte- and
  tuple-identical and the pre-existing RLS policy set proven byte-identical
  back to the production shape; the read-only preflight and its roster-evidence
  digest, including the case where the roster size is unchanged but an identity
  moved; exact-preflight success and stale-count, stale-digest and
  stale-economic-state aborts, each proven to write nothing at all; manifest
  exhaustiveness over the access roster; approved-only party and decision
  creation; the access-only identity staying access-only with its authorization
  intact; mapping create, change and deactivation with database-authored
  decision times; contiguous immutable decision history and its refusal to be
  updated, deleted or truncated; the SHR-191 typed audit policy, its derivation
  from the history row, its closed payload projection, and mutation rollback
  when the audit append fails; proof that no SHR-194 writer calls the SHR-193
  restore function or sets its token and that an ordinary decision is refused
  outright when that token is set; the SHR-193 lifecycle trigger, archived-party
  protection and cross-household containment all proven still intact; the
  no-op-on-identical-state, manifest-replay and manifest-conflict semantics; a
  real two-connection concurrency race proving consecutive decision versions, a
  single-valued current mapping and no lost audit evidence; the context API for
  mapped, access-only, unreviewed and unmapped callers plus its cross-household
  and ambiguity refusals; the exact ACL/RLS/function matrix; and the backup
  manifest plus a representative history restore that preserves the whole
  lifecycle in order and stays append-only.
- **`rpc.test.ts`** — every RPC added in 026/027/030/032 against the real
  schema: `replace_category_split`, `create_goal_contribution`,
  `create_transfer`, `create_bulk_transactions`, `apply_pending_income`,
  `claim_media_group`, `save_telegram_settings`.
- **`idempotency.test.ts`** — the idempotency unique index, exercised the way
  PostgREST actually issues it (`on conflict (idempotency_key) do nothing`,
  no predicate) as well as raw SQL — bug 2 above only reproduces under the
  first form.
- **`rls.test.mjs`** — the access matrix from `QA_QC_AUDIT_AND_REMEDIATION.md`
  (anon / authenticated-non-member / household-member), replayed against
  `transactions` and one other table per policy shape (`nw_daily`'s
  split read/insert/update, no delete).
- **`money_view.test.mjs`** — the same access matrix through
  `v_transactions_aed`, plus trusted service-role reporting and the unchanged
  AED/USD/missing-FX/soft-delete/account-metadata semantics from migration 036.
- **`canonical_metrics.test.mjs`** — SHR-111 Phase A golden fixtures for ledger
  classification, the five distinct cash/savings concepts, review/missing-input
  quality, canonical precision, balance sheet, investments, budget actual,
  goal/debt basis, split reconciliation, RLS, and intentional legacy parity
  deltas. The `042` regression fixture proves zero-target pay-down quality,
  starting-balance/link failures, unchanged save-up bases, and unclamped negative
  raw debt progress. `canonical-parity.mjs` is a separate read-only pre-migration
  probe for production-compatible evidence.
- **`scheduler_config.test.mjs`** — SHR-113 Phase C source/security contract:
  exactly one named `0 22 * * *` job, previous-Dubai target derivation,
  Vault-only dual authentication, no credential/endpoint literals,
  SECURITY INVOKER plus empty search path and API-role revokes, and a
  non-destructive exact-job disable path. The operational activation file is
  intentionally not applied by the portable from-empty schema test.
- **`constraints.test.ts`** — the zero-amount pair from 031, `group_kind` /
  `transfer_direction` pairing from 025, and `NULL` handling on
  `save_telegram_settings`'s person slots — bug 1 above.

## Isolation

One database, built once per run. Every test runs inside
`BEGIN; ... ROLLBACK;` (`withTx` in `helpers.mjs`), so tests can run
concurrently and never see each other's writes. Nothing here shares state
with `npm test`'s fakes, and nothing here talks to `our-rokda` — connection
info always comes from `DATABASE_URL`/`PG*` env vars pointed at a local
scratch database, never a Supabase project.

## CI

A separate `db-integration` job in `.github/workflows/ci.yml` runs this
against a `postgres:16` service container on every push — the same Postgres
major version as `our-rokda`. It is a distinct job from `check` (which stays
fast and network-free) so a DB-layer failure is reported separately from a
lint/unit/build failure.
