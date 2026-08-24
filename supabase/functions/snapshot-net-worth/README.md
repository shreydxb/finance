# Authoritative net-worth snapshot orchestrator (SHR-113 Phase A)

Production state: **NOT DEPLOYED**. Scheduler: **INACTIVE / not installed**.

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

## Future activation contract (not Phase A)

The reviewed schedule is an independently enabled pg_cron/pg_net retry window:
`*/15 22-23 * * *` UTC, corresponding to 02:00 through 03:45 Asia/Dubai. Each
scheduled invocation targets the just-ended Dubai day; the first publish wins
and later invocations are no-ops. URL/JWT/job-secret values must come from
Vault, never source SQL or the browser.

Phase A deliberately contains no `cron.schedule`, pg_net installation, Vault
write, or production secret/deployment command. Deployment, migration apply,
scheduler enablement, and first production publication remain separate gates.

Manual recovery is operator-only through the same authenticated/secret path
with `trigger_kind: "manual_recovery"` and an explicit missing past
`target_day`. It cannot replace or promote an existing `nw_daily` point.
