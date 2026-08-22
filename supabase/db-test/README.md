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
- creates a minimal stand-in for the two Supabase-managed pieces the schema
  depends on: an `auth.users` table and `auth.uid()`, and the `anon` /
  `authenticated` / `service_role` roles. Nothing else about Supabase is
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
  additionally asserts the objects the later suites depend on exist. SHR-109
  coverage verifies the money view's `security_invoker` option and read-only
  grants, the private helper's schema/attributes/ACL, absence of its public RPC
  target, and every policy dependency following the moved function object.
- **`pending_actions.test.mjs`** — SHR-110 catalog and state-machine coverage:
  exact API-role table ACLs, policy-free default deny, service-only pinned
  `SECURITY DEFINER` RPC execution, anonymous/member/outsider denial,
  idempotent creation, one-time prompt binding, requester/chat/prompt isolation,
  database-time expiry, non-reopenable terminal states, contradictory-row
  constraints, and a real two-connection claim race with exactly one winner.
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
