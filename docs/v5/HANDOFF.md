# Our Money v5 implementation handoff

## Linear issues

- Implementation: SHR-111 — Financial engine: define and test canonical core metrics
- Independent QA: child issue linked from SHR-111 after the final PR head is available

## Status

READY FOR INDEPENDENT QA. Phase A only. Production state: **NOT APPLIED**.

## Git

- Repository: `shreydxb/finance`
- Branch: `shreydxb1/shr-111-financial-engine-define-and-test-canonical-core-metrics`
- Exact base SHA: `195c47cae47565d36fe4e6f868c2ecc7fce9da21`
- Exact final PR-head SHA: recorded in the SHR-111 Linear implementation handoff and PR metadata after this file is committed, following the established non-self-referential SHA convention
- Netlify intent: `[skip netlify]`; no preview or production deploy was run; expected credits consumed: 0

## Approved Phase A delivered

Migration `041_canonical_financial_metrics_phase_a.sql` is additive and keeps all existing views, APIs, stored history, and consumers unchanged.

- `v_canonical_ledger_aed` classifies every active ledger row as exactly one of `consumption_spend`, `savings_movement`, or `internal_transfer`. Typed transfer metadata wins; legacy exact `Transfer` remains compatible; exact `Savings & Investments` is a savings movement; uncategorised rows are consumption; negative category refunds reduce consumption.
- `v_canonical_income_aed` exposes posted income separately from recurring expected income.
- `canonical_period_metrics` keeps `posted_income`, `consumption_spend`, `savings_movement`, `cash_retained`, `savings`, and `cash_flow` distinct. `cash_retained = cash_flow = income - consumption - savings movement`; `savings = income - consumption`. Savings rate is returned only for complete inputs and positive income.
- `v_canonical_accounts_aed` and `canonical_balance_sheet` implement positive liability magnitudes and exact two-decimal `assets - liabilities = net worth`. Quoted holdings use quantity × last price; manual valuations are explicit and provisional.
- `canonical_investment_metrics` returns current value, cost basis, and unrealized all-time P&L. Missing basis/price/value/FX is incomplete rather than zero gain. Manual/stale counts and source timestamps remain visible; callers may pass a staleness boundary, but migration `041` invents no universal threshold.
- `canonical_budget_actuals` is the category decomposition of canonical consumption, includes Uncategorised and budgetless categories, and excludes transfers/savings movements.
- `v_canonical_goal_progress` uses exactly one basis: linked account for linked save-up, implicit-AED contributions for unlinked save-up, and AED starting balance minus linked-liability balance for debt. Linked contributions/payments remain activity evidence and never double-count progress; raw negative debt progress is preserved.
- Nonzero `needs_review` rows are included with `provisional` status. Missing FX/input, unresolved zero placeholders, invalid account magnitude/type, missing investment basis, or unreconciled split identity makes dependent outputs `incomplete`/NULL.
- New/replaced category splits store `split_original_amount` and `split_original_currency`; cross-currency and sub-cent splits are rejected. Legacy split rows are not rewritten and would be reported incomplete when original identity is absent.
- All canonical views are `security_invoker`; all metric functions are `SECURITY INVOKER`. Anonymous access is revoked, authenticated household access is read/execute only, non-members receive no aggregate row, and service-role read access remains available.
- `nw_daily` and `nw_snapshots` are untouched.

## Compatibility boundaries

No Home, Reports, Budget, Forecast/FIRE, Telegram, Accounts/Wealth, Goals, or Debts consumer was migrated. Existing `v_transactions_aed`, frontend helpers, Telegram queries, RPC signatures, and production financial history remain compatible. `replace_category_split` retains its four-argument signature and now stores reconciliation identity on future writes.

## Files changed

```text
docs/v5/ARCHITECTURE.md
docs/v5/DATA_MODEL.md
docs/v5/DECISIONS.md
docs/v5/FINANCIAL_RULES.md
docs/v5/HANDOFF.md
package.json
supabase/db-test/README.md
supabase/db-test/canonical-parity.mjs
supabase/db-test/canonical_metrics.test.mjs
supabase/db-test/migrations.test.mjs
supabase/schema/041_canonical_financial_metrics_phase_a.sql
supabase/schema/README.md
```

## Exact validation results

- Lint: PASS, exit 0. Six pre-existing warnings and zero errors (`AuthContext`, `Transactions`, two in `TransactionList`, `PrefsContext`, `Reports`).
- Complete application/Edge test suite: PASS — 474 tests, 474 passed, 0 failed; 3.483331 s.
- Production build: PASS — 119 modules transformed in 477 ms. The existing 641.12 kB JavaScript chunk warning remains.
- Fresh-database application on isolated PostgreSQL 16.15: PASS — 40 repository schema files applied from empty (numeric sequence through `041`, historical `037` absent).
- Complete database integration suite: PASS — 71 tests, 71 passed, 0 failed; 1.885968 s.
- Focused canonical golden/invariant suite after final transfer/net-worth assertion: PASS — 17 tests, 17 passed, 0 failed; 2.446747 s.
- Explicit second application of migration `041`: PASS. The focused canonical + migration catalog suites after rerun passed — 22/22.
- Supabase CLI 2.115.0 security advisor against the rebuilt test database: PASS with no new SHR-111 findings. Results are only the expected `pending_actions` policy-free INFO and pre-existing `pgcrypto`-in-public WARN.
- Catalog/access matrix: PASS for four security-invoker views, four invoker functions, anonymous denial, household-member access, outsider empty results, service access, and least-privilege grants.
- Canonical monetary precision, transfer/card settlement, refunds, soft deletion, review quality, zero placeholders, missing FX, assets/liabilities/net worth, investments, budgets, goals/debts, person buckets, splits, and historical snapshot immutability all have golden database coverage.

## Live production dual-run/parity evidence (read-only)

Production project `our-rokda` (`wrxqgfbolryveivgdjia`) was queried only with SELECT CTEs; migration `041` was not applied.

| Month | Legacy app spend | Canonical consumption raw | Savings movement delta | Legacy Telegram total | Transfer delta | Quality facts |
|---|---:|---:|---:|---:|---:|---|
| 2026-02 | 280.39 | 280.39 | 0.00 | 280.39 | 0.00 | complete |
| 2026-03 | 8,148.58 | 8,148.58 | 0.00 | 22,717.58 | 14,569.00 | 6 provisional review rows |
| 2026-04 | 6,988.79 | 6,988.79 | 0.00 | 15,544.79 | 8,556.00 | 2 provisional review rows |
| 2026-05 | 5,498.33 | 5,498.33 | 0.00 | 19,154.33 | 13,656.00 | 18 provisional review rows |
| 2026-06 | 22,559.69 | 22,559.69 | 0.00 | 34,346.69 | 11,787.00 | 14 provisional review rows |
| 2026-07 | 10,357.80 | 10,357.80 | 0.00 | 22,449.80 | 12,092.00 | 27 provisional review rows |
| 2026-08 | 4,454.62 | 4,450.95 | 3.67 | 22,699.22 | 18,248.27 | 8 provisional + 3 zero placeholders |

Every observed period delta is intentional and arithmetically explained:

1. Legacy app spend equals canonical consumption plus exact `Savings & Investments` movement. The only nonzero difference is AED 3.67 in August.
2. Legacy Telegram total equals canonical consumption plus legacy exact-Transfer movement. Each monthly difference equals the transfer total exactly.
3. Production has zero typed-transfer rows and 16 legacy exact-Transfer rows, so preserving the legacy classification is required.
4. Production has zero missing-FX rows. The 75 nonzero review rows make affected periods provisional. Three August zero placeholders make August dependent canonical aggregates incomplete rather than returning the 4,450.95 raw partial as complete.
5. Current balance parity is exact: legacy and canonical assets AED 452,664.33; liabilities AED 126,524.67. There are zero missing FX, negative values, type mismatches, or quoted-value mismatches.
6. Three manual investment values intentionally make investment/balance quality provisional; all 41 holdings have cost basis, and quoted holdings reconcile.
7. All three live pay-down goals have present AED starting balances and valid linked liabilities. All three save-up goals are unlinked contribution-basis goals; one has AED 1,000 activity. No invalid contribution exists.
8. The only posted income is AED 6,000 dated December 2026. February–August therefore correctly exercise the `nonpositive_income` savings-rate behavior rather than producing a ratio.

No unexplained production parity delta was found.

## Risks and independent-QA focus

1. Migration `041` is not in production. QA must apply and rerun it only in an isolated Supabase/test project, then repeat security advisors and catalog/RLS checks before any production proposal.
2. Production is PostgreSQL 17.6 while the local scratch database is PostgreSQL 16.15. The features used are supported in both, but isolated PG17/Supabase application remains a reviewer check.
3. August will intentionally become incomplete until its three unknown zero placeholders are resolved; do not weaken the contract to preserve a plausible legacy number.
4. Manual investments remain values-with-warning. Reviewer should verify no UI/consumer interprets `provisional` as fresh after later migrations.
5. Production has no category-split groups. Split reconciliation is therefore proven synthetically, not by live history; no backfill is authorized.
6. Goal contributions have legacy implicit AED semantics. Non-AED contribution normalization remains future reviewed schema work, not a hidden conversion in `041`.
7. Text categories and owner/person values remain exact recorded compatibility fields. SHR-115 remains the normalization authority.
8. The read-only parity tool requires explicit dates and a database URL through environment variables and opens `BEGIN READ ONLY`; reviewers must never pass production credentials on a command line.
9. Current consumers intentionally continue producing legacy answers until separate migration issues. Phase A QA must review contracts and evidence, not expect UI changes.

## Production and deployment state

- Existing production baseline: migration `040` and Telegram Edge v42 are live/verified from SHR-110/SHR-120.
- Supabase production migration `041`: **NOT APPLIED**
- Production schema/data changed by SHR-111: **NO**
- Production financial history rewritten/backfilled: **NO**
- Netlify preview or production deploy: **NOT RUN**
- Edge Function deploy: **NOT RUN**
- Merge to `main`: **NOT DONE**
- SHR-111 marked Done: **NO**

## Independent reviewer checklist

1. Confirm the PR base is exactly `195c47c…` and scope contains no consumer migration.
2. Apply all migrations from empty and rerun `041`; verify no data-changing seed/backfill and no `nw_daily` write.
3. Re-run all canonical golden fixtures and the complete DB/app suites.
4. Verify all new views/functions use caller privileges and underlying RLS, with member/service access and outsider/anonymous denial.
5. Recalculate the five cash/savings outputs from the fixture and confirm labels/formulas are not collapsed.
6. Probe missing transaction/income/account/investment FX and missing cost basis; dependent amounts must be NULL/incomplete.
7. Verify typed and legacy transfers, card settlement, Savings & Investments, refund, soft delete, provisional review, and zero-placeholder rules.
8. Verify assets minus liabilities equals net worth at returned precision and invalid negative/type shapes fail visibly.
9. Verify quoted/manual/stale investment metadata and optional caller-supplied staleness boundary.
10. Verify budget categories plus Uncategorised reconcile to canonical consumption exactly.
11. Verify linked/unlinked save-up and linked debt bases, negative raw debt progress, and contribution activity non-double-counting.
12. Verify new split RPC identity/reconciliation, legacy incomplete behavior, cross-currency rejection, and migration compatibility.
13. Repeat read-only live parity and stop on any delta not fully decomposed by the documented reasons.
