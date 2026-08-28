# Our Money v5 handoff — SHR-126 transaction capture and correction safety

Date: 28 August 2026

Branch: `shreydxb1/shr-126-transaction-capture-correction-safety`

Exact production base: `e71fac23892214bd02d839b2587702700531f32a`

The immutable PR head, PR URL, and CI conclusions are recorded in the SHR-126 Linear implementation handoff because embedding a commit's own SHA would change it.

## Outcome

This bounded Tier-3 change makes ordinary manual expense recording and correction server-authoritative. Valid creates use a durable `manual:<uuid>` request key, return the original row on an exact replay, and record `source = 'manual'`, `needs_review = false`, and database-authored `reviewed_at`. Valid corrections preserve source and intake provenance while confirming the corrected fact.

The UI reports the committed transaction as successful before optional category-rule creation or list refresh. Single deletion uses a confirmation dialog, remains a soft delete, and exposes immediate exact-row Undo. New split entry is temporarily disabled in Activity, Account detail, and Card detail because the existing split RPC has no durable replay identity. Existing split rows remain readable and their existing atomic group correction stays available. Ordinary entry and correction exclude `Transfer`.

## Database contract

Migration `044_manual_transaction_safety.sql` adds one `SECURITY INVOKER` function with an empty search path: `save_manual_transaction(uuid,text,date,numeric,text,uuid,text,text,text,text[],text,uuid)`. Execution is revoked from `public`/`anon` and granted to `authenticated`/`service_role`; existing household RLS remains authoritative.

The migration also replaces the body of the existing four-argument `replace_category_split` function without changing its PostgREST signature. It adds current account/category validation, positive two-decimal amounts, Dubai-local date validation, transfer rejection, and explicit confirmed-review state on new split lines.

There are no new tables, columns, triggers, RLS policies, `SECURITY DEFINER` helpers, backfills, or canonical financial SQL changes. Existing production transactions are untouched.

## Scope decisions and boundaries

- No concurrency/version framework, fuzzy/near-duplicate subsystem, refund flow, transfer implementation, audit/history tables, toast infrastructure, party normalization, category normalization, Budget migration, Activity redesign, or broad responsive convergence.
- Refund/reimbursement entry truthfully remains unsupported and is never redirected to income.
- New split submission is removed instead of acquiring a second idempotency protocol. Existing Activity split groups retain their atomic correction behavior. Unknown split outcomes tell the user to check Activity and never claim that retry cannot duplicate a transaction.
- Transfer facts cannot enter the generic expense create/correction path; SHR-127 owns transfer integrity.
- Canonical classification/calculation views, account semantics, Supabase Auth/RLS, snapshots, Netlify configuration, SHR-113, and production data/configuration are protected and unchanged.

## Tests and release

Database integration coverage exercises confirmed create semantics, exact replay and request-key conflict, invalid/future date, invalid/sub-cent amount, stale account/category, transfer rejection, provenance-preserving correction, refusal of deleted/grouped/transfer correction, RLS/privilege metadata, and canonical split reconciliation. Application/UI coverage exercises ordinary request-key/error contracts, split outcome truthfulness, fresh Activity split-create containment, preserved existing split correction, post-commit follow-up failure truth, field validation, delete confirmation, account/card split removal, and functional 360/390-width controls.

Migration `044` must be applied before deploying the frontend. Rollback order is frontend first, then drop `save_manual_transaction` and restore the migration-041 split function body. No stored data needs reversal because the migration has no backfill; manual rows created after release remain valid ordinary transaction facts.

No migration was applied to production and no production deploy was performed. The PR remains unmerged for independent QA.
