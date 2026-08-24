# Authoritative net-worth snapshot orchestrator (SHR-113)

Production state: **DEPLOYED and protected**. Scheduler: **INACTIVE / not installed**.

This function is a trusted orchestrator, not a financial engine. After both
platform JWT verification and a constant-time `SNAPSHOT_JOB_SECRET` check, it:

1. claims one logical Dubai reporting-date run through the service-only RPC;
2. refreshes FX using the shared FX provider module and appends evidence;
3. refreshes investment quotes using the shared price provider module and
   appends complete/partial per-account evidence;
4. asks Postgres to evaluate canonical inputs and atomically publish a
   Complete/Provisional point or retain a skipped-incomplete run.

Provider fetch timestamps and provider quote/session-as-of timestamps are
separate evidence. HTTP 200 is not accepted as success when the parsed
provider result or any required timestamp is invalid. The function never sums
assets, liabilities, investments, or net worth.

## Phase-C activation contract (repository-only pending independent review)

The Phase-C schedule has exactly one intended invocation per reporting day:
`0 22 * * *` UTC, corresponding to 02:00 Asia/Dubai on the next calendar day.
It targets the just-ended Dubai day. There is no automatic cron retry window;
failed or missing days use the existing protected operator recovery contract.
URL/JWT/job-secret values come from Vault, never source SQL or the browser.

The reviewed activation and immediate-disable artifacts live under
`supabase/scheduler/`. They remain separate from the portable schema migration
chain and must not be applied before exact-head independent approval. See that
directory's runbook for the authentication, observability, recovery, and
rollback contract.

Manual recovery is operator-only through the same authenticated/secret path
with `trigger_kind: "manual_recovery"` and an explicit missing past
`target_day`. It cannot replace or promote an existing `nw_daily` point.
