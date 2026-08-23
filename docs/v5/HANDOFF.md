# Our Money v5 handoff — SHR-122

Date: 2026-08-23 (Asia/Dubai)

Branch: `shreydxb1/shr-122-shr-111-phase-b-migrate-home-and-reports-to-canonical`

Baseline: `main` at `33a7d09b8fd9bf85b101bb20795e4f9cc9356781`

Status: **IMPLEMENTED; READY FOR INDEPENDENT CODE + EXACT-HEAD DEPLOY-PREVIEW QA. DO NOT MERGE OR DEPLOY PRODUCTION.**

## Scope delivered

- Migrated Home's current-month Consumption and Savings rate cards from raw transaction/income arithmetic to `canonical_period_metrics`.
- Migrated Reports headlines to direct canonical fields: posted income, consumption spend, savings movement, cash retained, cash flow, savings, and savings rate.
- Migrated category actuals to `canonical_budget_actuals`; merchant, recorded-owner, source, and recorded-person presentation groupings use only canonical AED facts from `v_canonical_ledger_aed` and `v_canonical_income_aed`.
- Replaced misleading Spent/Expenses/Spending labels with Consumption wherever the value is canonical `consumption_spend`.
- Added one strict runtime contract layer that fails closed on missing/duplicate/malformed/unknown rows, enum values, quality states, and contract versions.
- Added one shared deterministic quality model: `complete < provisional < incomplete`.
- Realtime events only invalidate/refetch canonical data; no realtime payload mutates financial totals.
- Fixed Home/Reports period defaults and comparison boundaries to `Asia/Dubai`.
- Preserved the existing transaction CSV contract. Net Worth, Investments, Goals, Budget planning, recurring items, recent transactions, and other out-of-scope Home consumers remain unchanged.
- Corrected v5 documentation: production is verified through migrations `041` and `042`.

No database migration, Supabase write, production deploy, or merge is part of SHR-122.

## Canonical behavior

- Canonical monetary truth stays in AED. `fmt` converts canonical AED for display only.
- Canonical `NULL` is rendered unavailable and never replaced with zero or a legacy calculation.
- Nonzero `needs_review` periods remain monetary and surface as Provisional.
- Missing required FX, unresolved zero placeholders, and other required incomplete inputs surface as Incomplete; affected period values, breakdowns, trends, comparisons, and flows do not show plausible partial authority.
- Savings rate remains `NULL` for nonpositive posted income and displays the canonical `nonpositive_income` reason.
- Internal transfers and legacy exact `Transfer` rows remain outside consumption.
- `Savings & Investments` remains `savings_movement`, separate from consumption.
- Refunds remain signed canonical consumption facts.
- Shrey, Tarika, Joint, and Unassigned remain exact recorded buckets. The 69/31 target is presentation guidance only.
- Category/merchant/source/person groups render only after their canonical AED facts reconcile to the authoritative period total at two-decimal precision.
- Sankey renders only when all required flows are nonnegative and both source and destination sides reconcile exactly at cents. Otherwise Reports shows the signed canonical-bars fallback (or unavailable values for Incomplete periods).

## Main implementation files

- `src/lib/canonicalContracts.js` — strict runtime response validation and quality ordering.
- `src/lib/canonicalMetrics.js` — canonical RPC/view reads and person/household scope application.
- `src/lib/canonicalPresentation.js` — presentation-only grouping, reconciliation, headline mapping, quality copy, and Sankey gate.
- `src/screens/Home.jsx` — canonical current-month KPIs and quality indicator.
- `src/screens/Reports.jsx` — canonical headlines, flows, breakdowns, trends, comparisons, and exact recorded-person presentation.
- `src/lib/spendingComparison.js` — Dubai-local periods and reconciled canonical-ledger comparisons.
- `src/components/CanonicalQualityIndicator.jsx` — subtle Complete/Provisional/Incomplete status treatment.

## Regression coverage

- Home/Reports equality for the same canonical response.
- Complete, provisional, zero-placeholder incomplete, and missing-FX incomplete fixtures.
- Positive, zero, and negative posted-income savings-rate behavior.
- Transfer/card-settlement exclusion.
- Savings & Investments decomposition.
- Signed refunds.
- Exact recorded person buckets.
- Category reconciliation and fail-closed mismatch behavior.
- Dubai midnight, month, quarter, year, and comparison boundaries.
- Sankey cents reconciliation/nonnegative gate and fallback conditions.
- Source-discipline checks proving migrated screen code does not import or call legacy total/group/FX financial arithmetic.

## Validation evidence

- `pnpm run lint`: PASS (pre-existing fast-refresh/exhaustive-deps warnings only).
- `pnpm test`: PASS — 485 tests.
- `pnpm run build`: PASS.
- Complete database integration suite: required `db-integration` GitHub CI job; run from empty through schema `042` against PostgreSQL before QA handoff acceptance.
- Read-only production-intent probes re-run against `our-rokda` (`wrxqgfbolryveivgdjia`):
  - February 2026 Complete: income AED 0.00; consumption AED 280.39; savings movement AED 0.00; cash retained/cash flow/savings AED -280.39; savings rate `NULL` / `nonpositive_income`; category actuals reconcile to AED 280.39.
  - July 2026 Provisional: income AED 0.00; consumption AED 10,357.80; 27 review rows; category actuals reconcile to AED 10,357.80.
  - August 2026 intentionally Incomplete: income AED 0.00; all dependent consumption/movement/cash/savings/rate values `NULL`; reason `incomplete_inputs`; 11 review rows; 3 zero placeholders. The unaffected partial category sum AED 4,130.97 is deliberately not promoted.
  - December 2026 Complete positive-income fixture: income/cash retained/cash flow/savings AED 6,000.00; consumption/movement AED 0.00; savings rate 100.00%.
  - Live canonical ledger and income field shapes match the strict browser contracts.

## Independent QA gate

The PR and exactly one Netlify Deploy Preview must be created from the final commit containing this handoff. Record the immutable PR head SHA, preview URL, Netlify build/deploy identifier, and verified preview `commit_ref` in the structured Linear SHR-122 implementation comment. Do not change code after that preview; any change creates a new preview/review gate.

Independent QA should verify:

1. GitHub `check` and `db-integration` jobs pass at the exact PR head.
2. Preview build SHA exactly equals the PR head SHA.
3. Home and Reports show equal canonical household figures for the same month, including July Provisional and August Incomplete.
4. August displays unavailable canonical monetary values and never AED 4,130.97 as authoritative consumption.
5. February/July/December meanings and savings-rate reasons match the production probes above.
6. Category and merchant breakdowns reconcile; refunds remain signed; Transfer/card settlements are absent; Savings & Investments remains separate.
7. Sankey appears only for exact, nonnegative reconciled flows and otherwise uses the signed-bars/unavailable fallback.
8. Dubai-local defaults and comparison boundaries are correct around 00:00–03:59 local time.
9. Display-currency changes convert canonical AED presentation without changing canonical meaning or quality.
10. CSV output remains compatible and out-of-scope Home widgets remain unchanged.

SHR-122 remains open pending independent QA. Do not merge to `main`, deploy production, or modify production Supabase without explicit approval.
