# Our Money — latest implementation handoff

## Linear issue

SHR-108 — V5 foundation: reconcile architecture and establish canonical source of truth

## Status

READY FOR INDEPENDENT QA

## Objective

Establish the repository-side Codex/ChatGPT handoff protocol and canonical v5 documentation without changing application behavior or production systems.

## Git

- Repository: `shreydxb/finance`
- Branch: `shr-108-v5-foundation-handoff-protocol`
- Base: `0c0432b`
- Head: documentation commit created locally; use the branch tip as the authoritative SHA after any final handoff amendment

## Changes made

- Added root `AGENTS.md` with source-of-truth, financial safety, implementation, validation, deployment, and handoff rules.
- Added canonical current/planned architecture and v5 domain boundaries.
- Added explicit financial invariants and clearly marked unresolved definitions.
- Added a semantic current/planned data-model map.
- Added a decision log that preserves and supersedes v4 decisions explicitly.
- Added this overwrite-per-session handoff record.

## Files changed

```text
AGENTS.md
docs/v5/ARCHITECTURE.md
docs/v5/FINANCIAL_RULES.md
docs/v5/DATA_MODEL.md
docs/v5/DECISIONS.md
docs/v5/HANDOFF.md
```

## Sources reconciled

- Linear SHR-108 and Our Money v5 project description/milestones.
- Repository `PLAN.md` and `CLAUDE.md` as v4/historical context.
- Current React screens and `src/lib` financial/data helpers.
- Supabase migrations `001`–`038`, schema README, database tests, Edge Function structure, and configuration.
- Git history and GitHub Actions CI configuration.

## Validation

- Documentation consistency review: pending final diff review.
- Application tests: not run; no application code changed.
- Database tests: not run; no schema or database code changed.
- Build/lint: not run; Markdown-only change with no Markdown-specific checker configured.

## Database and deployment state

- Migration created: NO
- Local database changed: NO
- Supabase production changed: NO
- Netlify production changed: NO
- GitHub merged/deployed: NO; branch publication is recorded in the final task report
- Financial data changed: NO

## Behavior changes

None. Repository instructions and documentation only.

## Risks and reviewer checks

1. Verify current-versus-planned labels prevent v5 targets from being read as deployed features.
2. Verify financial rules match existing helper/migration semantics, especially transfer exclusion, missing FX, soft deletion, and goal links.
3. Verify `AGENTS.md` does not grant deployment or production-write authority.
4. Verify unresolved canonical definitions remain explicit rather than encoded as guesses.
5. Independently check live Supabase and deployed Netlify state before accepting any future claim about production.

## Codex assessment

Ready for independent QA. Do not mark SHR-108 Done solely from this handoff; inspect the actual diff first.
