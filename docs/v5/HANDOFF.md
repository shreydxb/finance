# Our Money — latest implementation handoff

## Linear issues

- Implementation: SHR-110 — Security redesign: pending_actions authorization before adding sensitive write tools
- Independent QA: linked child issue recorded in Linear after the final PR head is available

## Status

READY FOR INDEPENDENT QA. Production state: **NOT APPLIED**.

## Git

- Repository: `shreydxb/finance`
- Branch: `shreydxb1/shr-110-security-redesign-pending_actions-authorization-before`
- Exact base SHA: `80d09254edcdcc9b8e5f38c2c6a5aee32d3d532e`
- Exact implementation SHA: `cf38d4c0ebcca930260897264b8633e3ae33bd2d`
- Final PR-head SHA: recorded in the SHR-110 Linear handoff comment and PR metadata after this file's handoff commit, following the established non-self-referential SHA convention

## Scope reconciled from deployed v41

Current `main` did not contain the historical deployed v41 `pending_actions` and `/undo` source modules, while the production database contained the separately applied `037_pending_actions` table. SHR-110 ports only the required generic pending-action orchestration, `/undo` handler, store/types, fixtures, and focused tests. It does not merge the historical branch or port `/review` and unrelated query features.

## Files changed

```text
docs/v5/ARCHITECTURE.md
docs/v5/DATA_MODEL.md
docs/v5/DECISIONS.md
docs/v5/HANDOFF.md
supabase/db-test/README.md
supabase/db-test/migrations.test.mjs
supabase/db-test/pending_actions.test.mjs
supabase/functions/_shared/store.test.ts
supabase/functions/_shared/store.ts
supabase/functions/_shared/types.ts
supabase/functions/telegram-intake/actions/pending.test.ts
supabase/functions/telegram-intake/actions/pending.ts
supabase/functions/telegram-intake/actions/undo.test.ts
supabase/functions/telegram-intake/actions/undo.ts
supabase/functions/telegram-intake/demo.ts
supabase/functions/telegram-intake/fixtures/fakes.ts
supabase/functions/telegram-intake/fixtures/updates.ts
supabase/functions/telegram-intake/index.ts
supabase/functions/telegram-intake/intake.test.ts
supabase/functions/telegram-intake/intake.ts
supabase/schema/040_harden_pending_actions_authorization.sql
supabase/schema/README.md
```

## Authorization design implemented

- `pending_actions` is server-side Telegram coordination/audit state. `anon` and `authenticated` receive no direct table privileges, no RLS policy, and no transition-RPC execution.
- RLS remains enabled with zero policies as deliberate default deny. `service_role` receives direct table `SELECT` only—no `INSERT`, `UPDATE`, `DELETE`, `TRUNCATE`, `REFERENCES`, `TRIGGER`, or column-level state update.
- Six public-schema transition RPCs are `SECURITY DEFINER`, pin `search_path=''`, use fully qualified references, and are executable only by `service_role`: `create_pending_action`, `bind_pending_action_prompt`, `claim_pending_action`, `apply_pending_action`, `cancel_pending_action`, and `expire_pending_action`.
- `request_key` makes creation idempotent. Reuse returns the original row only when kind, payload, chat, and requester are identical; collision with a different immutable proposal fails.
- `prompt_msg_id` binds once while open, unclaimed, and unexpired. It cannot be overwritten directly.
- Claim atomically requires the exact requester, chat, bound prompt, open/unclaimed state, and database time strictly before `expires_at`. One successful claim blocks replay/double confirmation before the financial handler runs.
- Apply requires the matching successful claim. Cancel/expire require an unclaimed action. Paired claim/resolution constraints, terminal-resolution constraints, and revoked writes prevent reopening or contradictory audit rows.
- Expiry is the half-open interval `[created_at, expires_at)`: the exact deadline is expired. Apply does not recheck expiry after a valid claim, so a slow successful handler remains truthfully auditable as applied.
- A missing or throwing handler deliberately leaves the action claimed and unresolved. This surfaces uncertain financial outcome for manual reconciliation and prevents unsafe automatic replay.
- `/undo` proposes the latest live Telegram-sourced transaction in the same chat, uses a deterministic Telegram update/requester request key, and soft-deletes only after a valid claim. The callback is bound to the requester, source chat, and exact bot prompt.

## Migration design and compatibility

`040_harden_pending_actions_authorization.sql` is transactional, rerunnable, and non-destructive to rows.

- It reconstructs the exact deployed `037` base table with `CREATE TABLE IF NOT EXISTS` so migration-from-empty works despite the historical `037` file being absent from current `main`.
- It adds `request_key`, `claimed_at`, and `claimed_by`, then performs a fail-closed preflight before applying `request_key NOT NULL` or new invariants.
- Existing rows are never rewritten to fabricate request identity, claims, or resolution history. Any incompatible row aborts the transaction before row changes. The read-only production baseline had zero `pending_actions` rows.
- It removes all historical table policies, revokes all API-role table grants, grants service read only, and establishes the six closed transition RPCs.
- Rollback must be a separately reviewed forward migration. Restoring the historical authenticated blanket policy or direct service state writes is not an acceptable rollback because it reopens the authorization bypass.

## Exact validation results

- Full application and Edge Function unit/integration suite: PASS — 474 tests, 474 passed, 0 failed; 8.0789414 s.
- Fresh-database suite on isolated PostgreSQL 16.15: PASS — 39 repository schema files applied from empty (the sequence is `001` through `040`, with historical `037` absent); 54 tests, 54 passed, 0 failed; 3.3119085 s.
- Explicit second application of `040_harden_pending_actions_authorization.sql`: PASS.
- Incompatible-existing-row preflight probe: PASS — migration failed with the intended SHR-110 error and left the legacy row unchanged.
- Real two-connection concurrent claim test: PASS — exactly one service-role caller won.
- Catalog/access matrix: PASS — exact API ACL, no policies, six pinned definer functions, service-only execution, no direct service writes, and anonymous/household-member/outsider denial.
- Full lint: PASS (exit 0). Six pre-existing warnings and zero errors: `AuthContext`, `Transactions`, two in `TransactionList`, `PrefsContext`, and `Reports`.
- Production build: PASS — 119 modules transformed in 1.43 s. Existing 641.12 kB JavaScript chunk warning remains.
- `git diff --check`: PASS.
- Supabase CLI `db advisors --type security --level info` against the rebuilt test database: PASS (exit 0). Findings are only expected `rls_enabled_no_policy` for the intentionally policy-free `pending_actions` table and pre-existing `extension_in_public` for `pgcrypto`. There are no anonymous/authenticated `SECURITY DEFINER` exposure findings (0028/0029 shape absent).
- Supabase CLI `db lint` could not run on the plain local PostgreSQL cluster because it does not install Supabase's `plpgsql_check` extension. SQL application, catalog assertions, behavior tests, rerun, and the supported CLI security-advisor pass all completed successfully.
- Complete base-to-head diff reviewed before push; no direct `pending_actions` PATCH/write path remains.

## Risks and independent-QA focus

1. Migration preflight is intentionally fail-closed. Recheck production row count immediately before any future application; if rows now exist, stop and reconcile them separately rather than inventing request keys or claim history.
2. The local scratch database is PostgreSQL 16.15 while production is PostgreSQL 17.6. QA should also apply/rerun `040` in an isolated Supabase project and run its advisors before production.
3. Prompt delivery and prompt binding are separate external/database operations. A truly concurrent duplicate Telegram delivery could send an extra stale prompt before one bind wins; only the uniquely bound prompt can authorize a transition, so there is one actionable proposal. Review should verify this failure mode remains safe.
4. Claim → financial handler → applied-finalization is intentionally not one database transaction because Telegram handlers can include external work. A failure after claim remains claimed/unresolved and non-replayable; it requires audit/manual reconciliation rather than an automatic retry that could duplicate a financial effect.
5. `requested_by` and `chat_id` are Telegram-origin facts trusted only because the authenticated browser cannot write them and the webhook/Edge Function is the sole creator. Review should verify webhook authentication/allowlist gates remain before proposal creation and callback routing.
6. Service-role secrecy remains mandatory. The six definer RPCs do not make a leaked service key safe; they limit accidental/broad direct state mutation by the trusted service.
7. Migration `040` and the Edge Function source must be promoted together in a separately approved deployment window; deploying one without the other is unsupported compatibility state.

## Production and deployment state

- Read-only production baseline: migrations through `039`; `pending_actions` row count 0 at investigation time; historical authenticated blanket `ALL` policy and broad API grants still present until `040` is approved and applied.
- Supabase production migration `040`: **NOT APPLIED**
- Telegram Edge Function deployment: **NOT RUN**
- Supabase production schema/data changed by SHR-110: **NO**
- Production financial data changed: **NO**
- Netlify deploy or preview: **NOT RUN**
- Netlify production changed: **NO**
- Merge to `main`: **NOT DONE**
- SHR-110 marked Done: **NO**
- Netlify build intent: `[skip netlify]`; expected credits: 0

## Codex assessment

SHR-110 is ready for independent QA. Production application and Edge deployment remain separate, explicitly approved actions after QA.
