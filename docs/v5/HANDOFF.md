# Our Money v5 handoff — SHR-113 Phase C scheduler review

Date: 24 August 2026

Branch: `shreydxb1/shr-113-phase-c-scheduler`

Base: `1f39da032f21b1dd54c2b4846741504f3a5cbf73`

Production application: **NOT APPLIED**

Scheduler: **OFF**

The immutable PR head SHA and PR URL are recorded in the SHR-113/SHR-124
Linear handoff after the final commit. They cannot be embedded in that commit
without changing its SHA.

## Scope and outcome

Phase B is independently production-QA-passed. This branch adds the smallest
repository-controlled Phase-C scheduler plan required to invoke the protected
`snapshot-net-worth` orchestrator once after each Dubai reporting day closes.
It does not change financial calculations, publication policy, schema
migration `043`, RLS/grants, Edge orchestration, Accounts, history, or any
production state.

A repository change is required because enabling hosted extensions, defining
a permanent dispatcher/job, and preserving rollback instructions are durable
infrastructure. The configuration is under `supabase/scheduler/`, deliberately
outside the portable schema migration chain. Merge alone cannot activate it;
production application remains a separately approved step.

## Scheduler contract

- One job: `shr-113-authoritative-net-worth-close`.
- Expression: `0 22 * * *` in production GMT/UTC.
- Fire time: 22:00 UTC = 02:00 Asia/Dubai the following day.
- Target: previous Dubai calendar day, closed two hours earlier.
- One intended scheduled invocation per reporting day.
- No automatic cron retry window.
- pg_net request timeout: 120 seconds.
- Same-name configuration reapplication updates the intended job rather than
  introducing another named schedule.

The dispatcher sends `trigger_kind=scheduled` plus the explicit previous-Dubai
`target_day`. Existing Phase-B `claim_nw_snapshot_run` independently validates
the target, serializes concurrent claims, and refuses Legacy/already-published
dates. No revision, promotion, replacement, backfill, or reconstruction path is
added.

## Security and secrets

`private.dispatch_authoritative_net_worth_snapshot()` is SECURITY INVOKER with
an empty pinned search path and fully qualified `vault`/`net` objects. PUBLIC,
anon, authenticated, and service_role all have execution revoked. The
postgres-owned cron job is its only caller.

Three environment values are read from Supabase Vault by name only:

- `shr113_snapshot_endpoint`;
- `shr113_snapshot_anon_jwt` — least-privilege legacy anon JWT for the existing
  `verify_jwt=true` platform gate;
- `shr113_snapshot_job_secret` — same newly rotated 256-bit value as the Edge
  `SNAPSHOT_JOB_SECRET`.

The scheduler does not hold a service-role key. Repository files contain no
endpoint, JWT, API key, or job-secret value. Activation fails closed before
scheduling when a required Vault entry is absent or empty.

## Retry, recovery, and observability

There is one cron invocation and no automatic retry. Provider/capture failures
that reach Edge remain durable in the existing logical run and append-only
attempt model. Protected operator `manual_recovery` may retry only an explicit
still-missing past target day, preserving earlier failure evidence.

First-live-run QA must reconcile:

- `cron.job` and `cron.job_run_details`;
- `net._http_response` within hosted pg_net's six-hour retention window;
- Edge logs;
- the target-day logical run and ordered attempt events;
- item manifest, deterministic digest, source timestamps, quality, and totals;
- one truthful Complete/Provisional daily point, or `skipped_incomplete` plus a
  visible gap when required monetary inputs are invalid.

A successful cron row proves asynchronous enqueue, not HTTP/provider/capture
success. A transport/auth failure before claim is visible as a cron firing with
no expected target-day run plus pg_net/Edge evidence. The non-destructive
rollback file only marks the named job inactive and preserves all evidence.

## Files

- `supabase/scheduler/activate_authoritative_net_worth.sql`
- `supabase/scheduler/disable_authoritative_net_worth.sql`
- `supabase/scheduler/README.md`
- `supabase/db-test/scheduler_config.test.mjs`
- `supabase/db-test/README.md`
- `docs/v5/ARCHITECTURE.md`
- `docs/v5/DATA_MODEL.md`
- `docs/v5/DECISIONS.md`
- `docs/v5/FINANCIAL_RULES.md`
- `docs/v5/HANDOFF.md`
- `supabase/schema/README.md`
- `supabase/functions/snapshot-net-worth/README.md`
- `supabase/config.toml`

There is no numbered schema migration, application source, Edge source, or
frontend change.

## Validation

- `npm run lint`: PASS with the same five pre-existing React warnings and no
  Phase-C warning/error.
- `npm test`: PASS, 511/511 full app and Edge tests.
- `npm run build`: PASS, 126 modules; the existing large-chunk advisory remains.
- `npm run test:db`: PASS, 92/92 after applying all 42 schema files from empty.
  This includes migration `043` rerun/idempotency, full snapshot/RLS/security
  integration, and all four new scheduler source/security checks.
- Supabase CLI 2.115 `db lint --schema public,private --level warning
  --fail-on error`: PASS against the clean local database; no schema errors.
- `git diff --check`, complete diff/status, secret-literal scan, and self-review:
  PASS. No applied migration SQL, application source, Edge source, production
  credential/value, or unrelated file changed.

The first local database invocation correctly failed because the isolated
server was not listening on the configured port. After starting the local test
server, the clean from-empty rerun passed. The first db-lint connection refused
TLS because the isolated server is non-TLS; rerunning the same pinned linter
with local-only `sslmode=disable` passed. Neither transient setup failure
contacted production or changed repository content.

## Production baseline and boundary

Read-only verification before implementation confirmed:

- main/production merge: `1f39da032f21b1dd54c2b4846741504f3a5cbf73`;
- exactly 9 `nw_daily` rows, all Legacy;
- zero runs, attempts, items, and `nw_snapshots` rows;
- migration `043`, `accounts.price_quote_at`, deployed protected orchestrator,
  and Phase-B canonical Accounts behavior present;
- Vault installed with zero entries;
- pg_cron and pg_net available but not installed; cron/net schemas absent;
- no job, dispatch, snapshot invocation, or history mutation.

This branch has not changed production Supabase, Edge Functions, Vault,
Netlify, or financial data. It has not enabled pg_cron/pg_net or created a
schedule. SHR-113 and SHR-124 remain open.

## Independent review checks

1. Confirm exact base/head and that no migration `043`, Edge, app, or financial
   semantic changed.
2. Review exact UTC/Dubai boundary and the one-job/no-auto-retry decision.
3. Confirm Vault-only dual authentication, no service-role cron credential,
   dispatcher mode/search path/ACL, and absence of secret literals.
4. Confirm activation is separate from the portable migration chain and cannot
   occur from merge alone.
5. Confirm legacy/published protection and manual missing-day-only recovery
   remain owned by the unchanged Phase-B contracts.
6. Confirm rollback deactivates only the named job and retains all evidence.
7. Keep scheduler OFF until a new exact-head production activation approval.
