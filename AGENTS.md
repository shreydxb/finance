# Our Money — repository instructions

Our Money is a production household-finance system. Financial correctness, data preservation, authorization, and auditability take priority over speed or visual novelty.

## Start here

Before changing anything:

1. Read this file and the relevant documents in `docs/v5/`.
2. Read the assigned Linear v5 issue and treat it as the work contract.
3. Inspect the current implementation, schema migrations, and relevant tests.
4. Identify conflicts, assumptions, financial invariants, security implications, and deployment scope.
5. Present a plan before editing when the user or issue asks for one.

Do not implement a requirement merely because it appears in `PLAN.md`, `CLAUDE.md`, old Taskiv material, or Linear v4 history.

## Source-of-truth order

Sources answer different questions; do not collapse them into one ranking:

- **Current production state:** live Supabase schema/configuration/data and the deployed Netlify build. Inspect read-only unless production access is explicitly authorized.
- **Implemented repository behavior:** current GitHub code, migrations, tests, and configuration on the working branch.
- **Intended v5 design:** `docs/v5/ARCHITECTURE.md`, `FINANCIAL_RULES.md`, `DATA_MODEL.md`, and `DECISIONS.md`.
- **Current task scope:** the assigned Linear v5 issue and its acceptance criteria.
- **Historical context only:** Linear v4, Taskiv, `PLAN.md`, `CLAUDE.md`, old handoffs, and comments describing past production observations.

When sources conflict, report the conflict. Never silently change production behavior to match intended design, or rewrite intended design to match an accidental implementation.

## Safety boundaries

- Never invent or silently correct balances, transactions, holdings, prices, FX rates, ownership, categories, or historical values.
- Never destroy, rewrite, or backfill production financial history without explicit approval and a reviewed recovery plan.
- Database changes are additive and backwards-compatible by default. Add a new numbered migration; do not edit an applied migration.
- Do not weaken RLS, grants, authentication, household isolation, or secret handling to make a feature work.
- Never expose Supabase secret/service-role credentials to browser code or logs.
- High-consequence writes require explicit confirmation, validation, and an auditable result.
- AI may classify or propose actions, but it must not invent financial facts, perform authoritative financial arithmetic, generate arbitrary SQL, or write without the approved confirmation semantics.
- Do not deploy, merge, apply production migrations, change production configuration, or alter production data unless explicitly instructed for that task.

## Implementation rules

- Reuse the canonical money, date, reporting, grouping, and database primitives. Screens must not define competing versions of core metrics.
- Preserve soft-delete, transaction-group, transfer-direction, idempotency, review-state, and missing-FX behavior.
- Treat `Asia/Dubai` as the household date boundary where the existing domain logic does so.
- Keep changes within the assigned issue. Preserve unrelated user changes in the worktree.
- Update canonical documentation when a change alters architecture, financial semantics, the domain model, or an accepted decision.
- Mark proposed schema and behavior as **planned** until implemented and, where relevant, separately mark whether it is deployed.

## Validation and handoff

Run validation proportional to the change. The normal repository checks are:

```text
npm run lint
npm test
npm run build
npm run test:db     # for database/RLS/RPC/migration work
```

For schema work, also follow `supabase/schema/README.md`, test migrations from empty, and run Supabase advisors before production consideration.

Before finishing:

1. Review the complete diff and working-tree status.
2. Confirm no unrelated or prohibited files changed.
3. Overwrite `docs/v5/HANDOFF.md` with the latest session evidence.
4. Record commands actually run and their exact outcome; never imply validation that did not run.
5. Record branch/base/head, migrations, production/deployment state, risks, and reviewer checks.
6. Leave the Linear issue ready for independent QA; do not mark it Done unless explicitly instructed.
