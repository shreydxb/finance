# Our Money v5 handoff — SHR-113 Phase A

Date: 2026-08-24 (Asia/Dubai)

Branch: `shreydxb1/shr-113-authoritative-net-worth-phase-a`

Production base: `main` merge `a3b864d92a55af532efea1fc8cd05aeac6953661` (tree-equivalent SHR-122 head `283cdd899521508fcee0ea33604f29cf290128fb`)

Status: **IMPLEMENTED FOR INDEPENDENT QA. PRODUCTION STATE = NOT APPLIED. EDGE FUNCTION = NOT DEPLOYED. SCHEDULER = INACTIVE / NOT INSTALLED. DO NOT MERGE OR DEPLOY PRODUCTION.**

The immutable final PR head SHA, PR URL, Deploy Preview URL/deploy ID, and verified preview `commit_ref` are recorded in the SHR-113 Linear implementation handoff after the final commit. They cannot be embedded in that same commit without changing its SHA.

## Delivered Phase-A contract

- Corrected the independent-QA hosted-Supabase blocker without changing the
  Phase-A contract: migration `043` now resolves pgcrypto as
  `extensions.digest(...)`, matching a clean hosted project. The clean DB
  harness installs pgcrypto in `extensions`, grants the same schema USAGE as
  hosted Supabase, proves `public.digest(bytea,text)` is absent, and rejects a
  migration source regression back to `public.digest(...)`.

- Added migration `043_authoritative_net_worth_snapshots.sql` with one logical run per Dubai reporting date, append-only attempt/failure evidence, immutable per-published-run valuation items, deterministic SHA-256 input digest, and additive nullable `nw_daily` provenance.
- Preserved every pre-existing `nw_daily` tuple and value. There is no migration `UPDATE`, backfill, reconstruction, interpolation, or guessed historical FX/price/account input. Null run provenance means legacy.
- Kept `nw_snapshots` untouched/deprecated and read-only; SHR-113 never populates it.
- Removed authenticated/anonymous history mutation. Household members retain RLS-governed read-only history/provenance access; authenticated outsiders see zero rows and anonymous callers have no table access.
- Added service-role-only, pinned-search-path, `SECURITY INVOKER` claim/evidence/policy/capture contracts. Browser identities cannot execute them. Postgres canonical account contracts remain the financial engine.
- Added snapshot publication policy `shr-113-snapshot-policy-v1` only in the SHR-113 evaluation layer: FX fetch age through six hours; provider quote/session-as-of through 36 hours Complete, over 36 through 96 hours Provisional when evidence permits, and missing/older invalid; manual investment and older valid bank/liability inputs Provisional with age/reason evidence. SHR-111 canonical views/functions were not changed.
- Missing/invalid canonical monetary input records a `skipped_incomplete` run and publishes no `nw_daily` point. A plausible partial balance sheet is impossible.
- Enforced valuation-close semantics: `target_day` is the Dubai reporting date, while actual `snapshot_at` and per-source as-of/fetch timestamps are retained. Capture before the Dubai day close is rejected.
- Enforced one-publish-per-day idempotency, transaction/advisory-lock concurrency, immutable published evidence/items/daily points, append-only retries, and no automatic replacement/promotion. Manual recovery can fill only an explicit missing past day.
- Added `accounts.price_quote_at` so provider quote/session time remains distinct from `price_updated_at` fetch/write time.
- Extracted shared FX and investment provider modules and refactored the existing refresh Edge Functions to reuse them. HTTP success without valid provider content/timestamps is failure evidence; partial price success is explicit per account.
- Added `snapshot-net-worth` Edge source. It checks both platform JWT configuration and a dedicated constant-time `SNAPSHOT_JOB_SECRET`, then claims, refreshes, appends evidence, and requests Postgres capture. It performs no net-worth arithmetic.
- Removed the Accounts mount/open `nw_daily` upsert side effect and deleted the browser snapshot writer.
- Migrated current Accounts net worth/assets/liabilities to `canonical_balance_sheet`, investment value to `canonical_investment_metrics`, and account/composition/forecast starting values to `v_canonical_accounts_aed`. Canonical unavailable stays unavailable; there is no legacy financial fallback.
- Made history read-only and visually distinguishes Legacy, Complete, Provisional, skipped-incomplete, and genuine gaps. Null gaps break the chart rather than interpolating or becoming zero.
- Added the provenance tables to encrypted backup dependency order.
- Corrected production-status drift: production is through migration `042`; `043` is repository-only and not applied.

## Migration and schema intent

Only one migration is added:

- `supabase/schema/043_authoritative_net_worth_snapshots.sql`

New tables:

- `nw_snapshot_runs` — unique logical `target_day` and idempotency identity, lifecycle, actual capture time, final quality/evidence, source version, digest, and publication ID.
- `nw_snapshot_attempt_events` — immutable phase/outcome/evidence events keyed by run + attempt; failed retries remain queryable.
- `nw_snapshot_items` — immutable exact valuation inputs and quality for each account in a published run.

Additive columns:

- `accounts.price_quote_at`.
- Nullable `nw_daily.run_id`, `snapshot_at`, `published_at`, `quality_status`, `investment_value_aed`, `source_version`, `quality_evidence`, and `input_digest`.

There is no household ID because the current production model is one shared household with membership authorization. SHR-115 owns future household normalization.

## Edge source/version intent

- New function source: `supabase/functions/snapshot-net-worth/`.
- Source version persisted on capture: `shr-113-phase-a-v1`.
- Shared provider logic: `supabase/functions/_shared/fxRefresh.ts` and `priceRefresh.ts`.
- `supabase/config.toml` keeps `verify_jwt = true` for the new function.
- Required future secret: `SNAPSHOT_JOB_SECRET`, server/Vault only.
- Intended future retry window (documentation only): `*/15 22-23 * * *` UTC, 02:00–03:45 Asia/Dubai, targeting the just-ended Dubai date.
- Phase A installs no extension, Vault value, pg_net call, `cron.schedule`, or notification job. It deploys no Edge function.

## Security model

- Authenticated household member: SELECT through membership RLS on daily history, runs, attempts, and items; no INSERT/UPDATE/DELETE and no execution of snapshot contracts.
- Authenticated outsider: zero rows through RLS; no snapshot contract execution.
- Anonymous: no table access and no snapshot contract execution.
- Service role: minimum direct privileges required by the trusted `SECURITY INVOKER` workflow plus execution of four closed contracts. No browser-callable recovery RPC exists.
- All four contracts pin `search_path = ''`, fully qualify data references, and revoke PUBLIC/anon/authenticated execution. No new `SECURITY DEFINER` function or view was introduced.
- Published logical runs, attempt events, item manifests, and authoritative daily points are trigger-protected against mutation. Direct authenticated fabrication of legacy or authoritative history is denied.

## Validation evidence

Run on an isolated PostgreSQL 17.11 scratch cluster; production Supabase was not modified.

- Lint: PASS; five pre-existing React warnings only, no SHR-113 warning/error.
- Full browser/Edge/function test suite: PASS — 511/511.
- Production Vite build: PASS — 126 modules transformed. Existing large-chunk advisory only.
- Clean database migration from empty: PASS — all 42 schema files through numbered migration `043` applied.
- Complete DB integration: PASS — 88/88 against real PostgreSQL, including a
  clean hosted-compatible pgcrypto layout with `extensions.digest` present and
  `public.digest` absent.
- Migration rerun/idempotency: PASS; `043` reruns inside the test transaction and preserves legacy `nw_daily` content plus physical tuple identity.
- RLS/security catalog/advisor-shape regression: PASS for RLS, primary keys, grants, write policies, invoker mode, pinned search paths, and anon/authenticated function exposure.
- Official Supabase CLI v2.115.0 `db lint --schema public,private --level warning --fail-on error`: PASS; only the pre-existing unrelated `create_goal_contribution.v_contribution` unused-variable warning.
- Edge orchestration/provider tests: PASS, including secret rejection, execution ordering, provider timestamp separation, partial price success, FX failure, published no-op, and manual target forwarding.
- Diff hygiene: `git diff --check` PASS.

Coverage includes duplicate same-day invocation, concurrent claim loser, Dubai UTC boundary and pre-close rejection, missing/stale FX, 36h/96h quote boundaries, missing provider timestamp, partial price refresh, manual investment, old bank/liability Provisional evidence, canonical incomplete account/liability skip, Complete and Provisional publication, skipped-incomplete without a point, retry evidence preservation, missing-day recovery, no replacement, household read, outsider/anonymous isolation, direct write/RPC denial, legacy tuple preservation, empty `nw_snapshots`, Accounts zero-write open path, canonical-only current Accounts values, and truthful gaps.

## Production and rollback state

- Production database: unchanged; migration `043` **NOT APPLIED**.
- Production `nw_daily`: unchanged; no repair, backfill, reconstruction, or new row.
- Production `nw_snapshots`: unchanged/empty.
- Production Edge Functions: unchanged; `snapshot-net-worth` **NOT DEPLOYED** and existing refresh functions are not redeployed by this handoff.
- Production scheduler: **INACTIVE / NOT INSTALLED**. No pg_cron/pg_net/Vault change.
- Netlify production: unchanged. The QA artifact is a Deploy Preview only.
- Git `main`: unchanged; no merge.

Operational rollback after any future separately approved application is additive disablement: disable the future schedule first, make the Edge endpoint unreachable/roll back its source, and roll back the frontend independently. Do not drop provenance schema, restore browser history writes, delete run evidence, or rewrite a published/legacy daily point.

## Independent QA gate

The child QA issue created from this handoff must verify the exact PR head and exact Deploy Preview commit:

1. Schema applies from empty and reruns without changing a seeded legacy tuple; no existing history is backfilled.
2. Grants, RLS, catalog mode/search paths, outsider/anon isolation, and direct authenticated write/RPC denial match the matrix above.
3. Complete, Provisional, skipped-incomplete, duplicate, concurrent, retry, manual-recovery, timestamp, FX, price, and account/liability fixtures reproduce the DB evidence.
4. Published run/items/daily evidence is immutable; failed attempt evidence survives retry; `nw_snapshots` remains empty.
5. Edge orchestration has both gates, reuses shared provider logic, treats partial/invalid responses explicitly, and performs no financial calculation.
6. Accounts open/mount makes zero snapshot mutations, current values come only from canonical contracts, and canonical unavailable never falls back.
7. History labels Legacy/Complete/Provisional/skipped and leaves gaps unconnected and nonzero.
8. Preview UI loads against current production (without migration `043`) through the read-only legacy compatibility path; its `commit_ref` equals the final PR head.
9. Production database, Edge deployments, scheduler, Netlify production, and `main` remain unchanged throughout QA.

SHR-113 must remain open. Phase B production application and Phase C scheduler activation/first-run verification require separate explicit approvals.
