# Our Money v5 implementation handoff

## Linear issues

- Implementation: SHR-111 — Financial engine: define and test canonical core metrics
- Independent QA: SHR-121 — QA SHR-111 Phase A

## Status

**DEBT-QUALITY CORRECTION READY FOR INDEPENDENT QA.** Production migration `041` remains applied; additive correction `042` is **NOT APPLIED**.

## Git

- Repository: `shreydxb/finance`
- Branch: `shreydxb1/shr-111-debt-quality-correction`
- Exact base SHA: `9a9ffa9ebd1ca053fbd177bd7144a660ea39e55c`
- Exact final PR-head SHA: recorded in the SHR-111/SHR-121 Linear handoff and PR metadata after this file is committed, following the established non-self-referential SHA convention
- Netlify intent: `[skip netlify]`; no preview or production deploy was run; expected credits consumed: 0

## Confirmed production defect

Migration `041` correctly computes all three production pay-down balances and raw progress values, but its goal-quality CASE applies the generic `target_amount <= 0` guard before pay-down-specific checks. All three production pay-down goals use legacy-compatible `target_amount = 0` with valid positive AED starting balances and valid linked liabilities, so they are incorrectly marked incomplete.

The approved contract is kind-specific:

- `save_up` requires a positive target;
- `pay_down` requires a positive AED starting balance, a valid linked liability, and a linked canonical valuation that is not incomplete;
- pay-down progress may be negative and must not be clamped;
- contributions/payments remain reconciliation activity and do not change linked-balance progress.

## Correction delivered

Migration `042_fix_canonical_debt_quality.sql` additively recreates only `v_canonical_goal_progress`.

- Positive/non-null `target_amount` is required only when `kind = 'save_up'`.
- Pay-down quality requires positive/non-null `starting_balance`.
- Pay-down quality requires a present linked account whose canonical account row exists and is a liability.
- An incomplete linked canonical valuation makes pay-down quality incomplete; a provisional linked valuation remains provisional.
- Existing current amount, raw progress amount/percentage, raw remaining, basis, contribution metadata, classification version, columns, and ordering are unchanged.
- The view remains `security_invoker=true`; authenticated/service SELECT and anon/PUBLIC denial are explicitly re-established.
- No goal/transaction/account/history row is inserted, updated, deleted, rewritten, normalized, or backfilled.
- No consumer, function, Edge Function, or application calculation changes.

## Regression coverage

The `042` golden fixture proves:

1. a pay-down goal with `target_amount = 0`, positive starting balance, and valid linked liability is complete;
2. zero and missing starting balances are incomplete;
3. missing, non-liability, and incomplete linked accounts are incomplete;
4. a zero-target save-up goal remains incomplete;
5. a balance above starting balance returns complete negative raw progress and negative percentage without clamping;
6. linked save-up remains linked-account basis, unlinked save-up remains contribution basis, and linked contribution activity is not added to progress.

## Files changed

```text
docs/v5/ARCHITECTURE.md
docs/v5/DATA_MODEL.md
docs/v5/DECISIONS.md
docs/v5/FINANCIAL_RULES.md
docs/v5/HANDOFF.md
supabase/db-test/README.md
supabase/db-test/canonical_metrics.test.mjs
supabase/schema/042_fix_canonical_debt_quality.sql
supabase/schema/README.md
```

## Exact validation results

- Supabase current-doc/changelog check: PASS. No current breaking change affects a Postgres 17 security-invoker view replacement; extension-version and self-hosted/runtime notices are unrelated.
- Lint: PASS, exit 0 — six pre-existing warnings and zero errors.
- Complete application/Edge test suite: PASS — 474 tests, 474 passed, 0 failed; 9.2141139 s.
- Production build: PASS — 119 modules transformed in 1.01 s; existing 641.12 kB JavaScript chunk warning only.
- Fresh-database migration application: PASS — 41 repository schema files applied from empty through `042` on PostgreSQL 16.15.
- Complete database integration suite: PASS — 72 tests, 72 passed, 0 failed; 2.859439 s.
- Explicit second application of unchanged `042`: PASS — `BEGIN`, `CREATE VIEW`, `COMMENT`, `REVOKE`, `GRANT`, `COMMIT`.
- Focused canonical + migration catalog suites after actual rerun: PASS — 24/24; 1.7852621 s.
- Supabase CLI 2.115.0 security advisor against rebuilt test state: PASS with no new SHR-111/SHR-121 finding. Expected existing results only: service-only `pending_actions` policy-free INFO and `pgcrypto`-in-public WARN.
- RLS/catalog coverage: PASS — canonical views remain security-invoker/read-only; canonical functions remain invoker; member/service access, outsider isolation, and anon denial remain covered.

## Production and deployment state

- GitHub PR #10 / migration `041`: merged and applied as production migration `20260822222316 / 041_canonical_financial_metrics_phase_a`.
- Migration `042_fix_canonical_debt_quality`: **NOT APPLIED**.
- Production goal rows changed/backfilled: **NO**.
- Production transactions, legacy Transfer rows, splits, `nw_daily`, or `nw_snapshots` changed: **NO**.
- Home, Reports, Budget, Forecast/FIRE, Telegram, Accounts/Wealth, Goals, or Debts consumer migration: **NO**.
- Netlify preview/production deploy: **NOT RUN**.
- Edge Function deploy: **NOT RUN**.
- Merge of correction PR to `main`: **NOT DONE**.
- SHR-111 Done: **NO**.
- SHR-121 Done: **NO**.

## Independent reviewer checks

1. Confirm the correction PR base is exactly `9a9ffa9ebd1ca053fbd177bd7144a660ea39e55c` and only the documented files changed.
2. Confirm migration `041` is unchanged and `042` contains no DML/backfill or consumer change.
3. Diff the `041` and `042` goal-view definitions: only the kind-specific quality predicate, explicit missing-link guard, comment, and least-privilege regrant should differ.
4. Apply all schema files from empty, apply `042` a second time, and rerun the full database suite.
5. Reproduce the six `042` fixture cases, especially complete zero-target pay-down and complete negative raw progress.
6. Verify positive target remains mandatory for both linked and unlinked save-up goals.
7. Verify linked contributions/payments remain activity-only and do not alter raw debt progress.
8. Verify `v_canonical_goal_progress` remains `security_invoker=true` with member/service access, outsider RLS isolation, and anon/PUBLIC denial.
9. Run security advisors and confirm no new view/grant/RLS finding.
10. Before any production proposal, query the three live pay-down goals read-only and predict that only quality changes from incomplete to complete; their current balances and raw progress values must remain byte-for-byte/numerically unchanged.
