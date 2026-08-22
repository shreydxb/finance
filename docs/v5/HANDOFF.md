# Our Money — latest implementation handoff

## Linear issues

- Implementation: SHR-109 — Security hardening: financial view + security-definer exposure
- Independent QA: SHR-119 — QA SHR-109 — Verify financial view and membership-helper security hardening

## Status

READY FOR INDEPENDENT QA. Production state: **NOT APPLIED**.

## Git

- Repository: `shreydxb/finance`
- Branch: `shreydxb1/shr-109-security-harden-financial-view-and-security-definer-exposure`
- Exact base SHA: `6899fae3cc8afbe3c383c39993ec459f662fc627`
- Exact implementation SHA: `fbe68341812232104f0fbfd2193115b30c33d1d6`
- Final PR-head SHA: recorded in the SHR-109 Linear handoff comment and PR metadata after this file's handoff commit, per the approved non-self-referential SHA convention

## Files changed

```text
docs/v5/ARCHITECTURE.md
docs/v5/DATA_MODEL.md
docs/v5/DECISIONS.md
docs/v5/HANDOFF.md
supabase/db-test/README.md
supabase/db-test/migrations.test.mjs
supabase/db-test/money_view.test.mjs
supabase/db-test/rls.test.mjs
supabase/schema/039_harden_financial_rls_surfaces.sql
supabase/schema/README.md
```

## Migration

`039_harden_financial_rls_surfaces.sql` is transactional, additive, and rerunnable.

- Moves the existing `public.is_household_member()` function object to `private.is_household_member()`. Keeping the same object/OID preserves all policy dependencies; PostgreSQL deparses those policies against the new schema.
- Keeps the helper `STABLE SECURITY DEFINER` because the `household_members` policy otherwise recurses, but pins an empty `search_path` and removes the public/PostgREST RPC target.
- Revokes `private` schema access and helper execution from `PUBLIC`, `anon`, and `service_role`; grants authenticated only the schema `USAGE` and function `EXECUTE` needed to evaluate RLS.
- Sets `public.v_transactions_aed` to `security_invoker=true`, revokes anonymous and write access, and grants read-only access to authenticated and service roles.
- Does not recreate or alter the view definition, so AED normalization, missing-FX `NULL`, soft-delete filtering, and account metadata remain unchanged.
- Changes no financial rows or other production data.

## Household isolation evidence

- Household-member reads through `v_transactions_aed` still return the correct AED-normalized transaction.
- An authenticated non-member receives no rows through the view.
- An anonymous caller receives permission denied.
- Trusted service-role reporting retains read access.
- Catalog regression tests require every membership policy to resolve to `private.is_household_member()`, require the helper's exact attributes and minimum ACL, require absence of `public.is_household_member()`, and require the view's invoker option/read-only ACL.

## Exact validation results

- `npm run lint`: PASS (exit 0). Six existing warnings; zero errors: one in `AuthContext`, one in `Transactions`, two in `TransactionList`, one in `PrefsContext`, and one in `Reports`.
- `npm test`: PASS — 461 tests, 461 passed, 0 failed; 7.3995376 s.
- `npm run build`: PASS — 119 modules transformed; completed in 1.29 s. Existing JavaScript chunk-size warning (`641.12 kB`) remains.
- `npm run test:db`: PASS against a fresh local PostgreSQL 16.15 scratch cluster — all 38 prior migrations plus `039` applied from empty; 47 tests, 47 passed, 0 failed; 2.737039 s.
- Explicit second application of `039_harden_financial_rls_surfaces.sql`: PASS and committed successfully, proving the migration reruns cleanly.
- Focused post-rerun database suites (`migrations.test.mjs`, `rls.test.mjs`, `money_view.test.mjs`): PASS — 23 tests, 23 passed, 0 failed; 1.8786483 s.
- `git diff --check`: PASS.
- Complete base-to-head diff: reviewed by Codex before push.
- `npm audit --omit=dev --audit-level=high`: FAIL (exit 1) on pre-existing `nanoid < 3.3.18`, GHSA-2v37-7h3g-55p8; dependency remediation is out of SHR-109 scope and no package files changed.

## Supabase advisor status

Live production was checked read-only before and after local implementation and remains unchanged through migration `038`:

- `security_definer_view` on `public.v_transactions_aed`: still present in production because `039` is **NOT APPLIED**. Local catalog and access-matrix tests prove the proposed `security_invoker` state.
- `authenticated_security_definer_function_executable` on `public.is_household_member()`: still present in production because `039` is **NOT APPLIED**. Local tests prove the function moves out of `public` and retains only authenticated execution for RLS.
- `auth_leaked_password_protection`: still present and outside SHR-109's database-migration scope.

Do not claim either target advisor finding is resolved in production until SHR-119 passes, a separate production application is approved, and the live advisors are rerun.

## Risks, rollback, and independent-QA focus

1. `private` must remain absent from the Supabase Data API exposed-schema configuration. Reviewer should verify this before and after any future production application.
2. The local scratch cluster is PostgreSQL 16.15 while production reports PostgreSQL 17.6; the statements and catalog assertions used are supported in both, but QA should apply `039` to an isolated Supabase environment before production.
3. The migration takes brief catalog locks while moving the function and changing the view option; schedule any future production application deliberately.
4. Emergency rollback is documented in the migration. It restores the former public helper and definer-view behavior, so it intentionally reopens both advisor findings and must not be treated as a security-neutral rollback.
5. Independent QA should repeat the household member/non-member/anonymous matrix, verify AED/USD/missing-FX and aggregate behavior, inspect grants and policy expressions, confirm the public RPC is absent, and rerun advisors in the isolated environment.

## Production and deployment state

- Supabase production migration: **NOT APPLIED**
- Supabase production schema/data changed: **NO**
- Production financial data changed: **NO**
- Netlify deploy or preview: **NOT RUN**
- Netlify production changed: **NO**
- Merge to `main`: **NOT DONE**
- SHR-109 / SHR-119 marked Done: **NO**
- Netlify build intent: `[skip netlify]`; expected credits: 0

## Codex assessment

SHR-109 is ready for independent QA under SHR-119. Production application remains a separate, explicitly approved action after QA.
