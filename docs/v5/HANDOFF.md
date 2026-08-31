# Our Money v6 handoff — SHR-196 category lifecycle foundation

Date: 31 August 2026

Branch: `shreydxb1/shr-196-category-lifecycle-and-system-code-protection-foundation`

Exact base: `3662be1c589b9c01fc74302098abceb3fbe2363e`

The immutable PR head, PR URL, and exact-head CI conclusions are recorded in
the SHR-196 Linear implementation handoff because embedding a commit's own SHA
would change it.

## Outcome

This bounded Tier-3 package adds only the category identity/lifecycle protection
substrate in migration `046_category_lifecycle_foundation.sql`:

- nullable constrained `categories.system_code`;
- nullable `categories.archived_at` and database-authored `updated_at`;
- immutable `category_name_history`;
- explicit `category_aliases` with `compatibility_active` and terminal
  `history_only` states;
- exact active-alias/current-name collision protection; and
- database guards that freeze rename/archive/reactivation and reject hard
  delete/truncate.

No system code is seeded. Existing category IDs, names, groups, icons, creation
times, transactions, budgets, rules, canonical classification, and consumers
remain V1-compatible and unchanged.

## System-code and lifecycle trust boundary

Only `transfer` and `savings_investment` are structurally valid, unique non-null
codes. Browser and service-role DML cannot make a first assignment. The database
owner is the explicit migration/restore trust root for a future reviewed
assignment. Once populated, even database-owner ordinary DML cannot change or
clear a code. Coded categories cannot be archived or deleted.

Production rename and archive are not enabled. No public/private lifecycle RPC
or resolver exists. A database-owner restore may insert an already archived
ordinary category as historical state, but ordinary UPDATE cannot archive or
reactivate it. The existing unsupported Settings rename/delete paths therefore
fail closed at the database boundary after any separately authorized apply.

## History, aliases, ACL, and RLS

Name history is immutable evidence only and never creates an alias. Aliases are
separate durable rows. An exact compatibility-active alias reserves its label
against another active alias or current category name; retiring it to
history-only releases the ordinary label. No case, whitespace, or Unicode
normalization algorithm and no permanent historical-label reservation is
invented.

Authenticated household members may read history and aliases through the
existing `private.is_household_member()` root. They have no direct writes.
`service_role` has SELECT only for encrypted backup. Anonymous access is absent.
No category, code, actor, owner, party, or invented taxonomy role participates
in authorization. Private trigger functions are not executable by API roles.

## Backup, restore, and validation

The backup manifest includes category name history and aliases immediately
after categories; `select *` preserves the three new category columns. Focused
restore coverage inserts an active protected system category, an archived
ordinary category, name history, and active/history-only aliases, compares the
complete JSON rows exactly, and re-proves code-clear, delete, history-mutation,
and alias-reactivation rejection.

The dedicated through-045 upgrade runner compares legacy category content and
tuple identity, transaction/budget/rule rows, and canonical V1 classification
before and after `046`, reapplies the migration, and verifies no code, archive,
history, alias, or consumer-data change. Fresh migration and full ACL/RLS,
constraint, classification, backup, and restore vectors run in `npm run test:db`.

Final local and exact-head CI command results are recorded in Linear after all
checks complete.

## Protected boundaries

- No system-code seed or category-reference backfill.
- No transaction/rule stable category IDs.
- No production rename/archive/reactivation or hard-delete support.
- No resolver, V2 writer/read, rule lifecycle, budget predicate, or audit
  producer integration.
- No category, budget, rule, transaction, canonical calculation, Activity,
  Telegram, or UI consumer change.
- No production migration, data change, deployment, or merge.

The PR must remain open and `[skip netlify]` until independent Tier-3 review.
