# Authoritative net-worth scheduler — SHR-113 Phase C

Status: **review artifact only; production scheduler is OFF**.

This directory is deliberately separate from `supabase/schema/`. The schema
migration chain must remain portable and must not activate hosted operational
infrastructure when a database is rebuilt. The reviewed activation SQL is a
separate production gate that enables hosted `pg_cron`/`pg_net`, installs one
private dispatcher, and creates one named job.

The activation follows the hosted Supabase extension layout: pg_net is enabled
with extension objects registered under `extensions` while its HTTP API remains
the extension-provided `net.http_post`; pg_cron owns its `cron` schema.

## Contract

- Job name: `shr-113-authoritative-net-worth-close`
- Cron expression: `0 22 * * *`
- Production cron timezone: GMT/UTC
- Fire time: 22:00 UTC = 02:00 Asia/Dubai on the following day
- Target: the previous Dubai calendar day, which closed two hours earlier
- Intended frequency: exactly one scheduled invocation per reporting day
- Automatic retries: none
- HTTP timeout: 120 seconds

Dubai is UTC+4 without daylight-saving transitions. Both the dispatcher and
the existing `claim_nw_snapshot_run` contract derive/validate the previous
Dubai day. The HTTP body supplies an explicit `target_day` and
`trigger_kind: scheduled`; the database claim remains the authoritative
idempotency and date-boundary check.

## Secret contract

Create these three entries in Supabase Vault before activation:

| Vault name | Value |
|---|---|
| `shr113_snapshot_endpoint` | Production `snapshot-net-worth` function URL |
| `shr113_snapshot_anon_jwt` | Active least-privilege legacy anon JWT used only to pass `verify_jwt=true` |
| `shr113_snapshot_job_secret` | Same newly rotated 256-bit value as the Edge `SNAPSHOT_JOB_SECRET` |

Never put values in Git, Linear, SQL history, screenshots, or logs. The
existing Phase-B secret plaintext is intentionally unrecoverable, so approved
activation rotates the Edge secret once and writes the same new value to
Vault. The scheduler does not use a service-role key.

The dispatcher is `SECURITY INVOKER`, pins an empty `search_path`, fully
qualifies Vault and pg_net objects, and revokes execution from PUBLIC, anon,
authenticated, and service_role. It is invoked only by its postgres-owned cron
job. The activation transaction checks every required Vault name before
scheduling, requires the installing session to be `postgres`, and fails closed
without printing values.

## Approved activation sequence

Do not perform these steps until the exact PR head has independent approval.

1. Reconfirm the reviewed Git SHA and the production baseline: nine untouched
   Legacy `nw_daily` rows, zero runs/attempts/items/`nw_snapshots`, and no
   cron/net schemas or jobs.
2. Generate a new 256-bit operator secret. Update the Edge
   `SNAPSHOT_JOB_SECRET`, then create the three Vault entries above without
   displaying or persisting their values elsewhere.
3. Apply `activate_authoritative_net_worth.sql` exactly as reviewed. Do not
   invoke the dispatcher manually.
4. Verify one active job with the exact name, expression, command, and postgres
   owner; verify the dispatch function mode, empty search path, owner, and ACL;
   verify required Vault *names* only.
5. Reconfirm the activation did not immediately create a snapshot run or
   change any existing history.
6. Wait for the next real 22:00 UTC firing and perform first-live-run QA within
   six hours, while pg_net response evidence is retained.

Reapplying the activation file uses the same case-sensitive job name. pg_cron
updates that named job rather than adding a second intended schedule. Review
must still assert that exactly one row with this name is active.

## Observability and first-live-run QA

`cron.job_run_details` proves the dispatcher command ran, but a successful
cron row proves only that pg_net accepted the asynchronous request. Inspect
all of the following:

- the one expected `cron.job_run_details` row;
- the matching `net._http_response` status/body (retained for six hours by
  hosted pg_net);
- `snapshot-net-worth` Edge logs;
- one target-day `nw_snapshot_runs` row;
- ordered append-only `nw_snapshot_attempt_events` refresh/capture evidence;
- immutable `nw_snapshot_items`, digest, quality, and totals when published;
- one Complete or truthful Provisional `nw_daily` point, or a truthful
  `skipped_incomplete` run and visible gap when a required monetary input is
  invalid.

No HTTP 200 alone proves provider or capture success. The run/attempt model is
the durable financial evidence. A transport/auth failure before Edge claim is
visible as the expected cron run plus no target-day logical run, with pg_net
and Edge evidence identifying the failure.

## Retry and recovery

There is no cron retry window. If a run is missing or failed, fix the cause and
use the existing protected operator `manual_recovery` request with the explicit
missing past target day. The logical run keeps earlier failed attempts and
assigns the recovery a later attempt number. Advisory locking, the unique
target day, and `nw_daily` protections prevent concurrent duplication.

Recovery cannot replace Legacy history or an already-published authoritative
point. Phase C adds no revision or promotion path.

## Rollback

Apply `disable_authoritative_net_worth.sql` to set the named job inactive.
Do not unschedule/drop it during incident response: retaining the row and run
history improves auditability. Do not delete snapshot evidence, rewrite
`nw_daily`, remove provenance, or restore a browser write. After correction,
activation/recovery requires the same approval discipline.
