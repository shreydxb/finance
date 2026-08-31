# Our Money v6 handoff — SHR-196 category lifecycle and system-code protection foundation

Date: 31 August 2026

Branch: `claude/shr-196-category-lifecycle-v4j5ov`

Exact reviewed base: `3662be1c589b9c01fc74302098abceb3fbe2363e` (SHR-191, `main`)

The immutable PR head, PR URL, and final CI conclusions are recorded in the SHR-196 Linear implementation handoff because embedding a commit's own SHA would change it.

## Outcome

This bounded Tier-3 package is P02 in the V6.0 convergence sequence: the database substrate that must exist before category stable-reference reconciliation. It adds lifecycle and system-code protection to `categories`, immutable rename history, and an explicitly separate alias lifecycle.

It is deliberately dormant from the product's point of view. No category receives a system code, nothing is backfilled, no rename or archive path becomes usable, no resolver exists, and no consumer, classification, budget actual, canonical view, Telegram path or UI behaviour changes.

## Database contract

Migration `046_category_lifecycle_protection.sql` adds:

- `categories.system_code` — nullable, uniquely indexed where present, constrained to exactly `transfer` and `savings_investment`, NULL on every row after the migration;
- `categories.archived_at` — nullable lifecycle field, NULL is active;
- `categories.updated_at` — database-authored, seeded from each row's own `created_at`;
- `public.category_name_history` — immutable rename evidence written by a trigger, with a closed reason vocabulary and the access identity from `auth.uid()` where one exists;
- `public.category_aliases` — explicitly registered compatibility aliases with a `compatibility_active` → terminal `history_only` lifecycle and a partial unique index that constrains only active aliases;
- `private.guard_category_lifecycle()` and the alias/history guards — invoker-mode triggers, so the acting role is real;
- `private.assign_category_system_code_v1(...)`, `private.register_category_alias_v1(...)` and `private.retire_category_alias_v1(...)` — named operator paths for SHR-197 and SHR-198, executable by no API role and called by nothing in this package.

## Protection model

Assignment of a system code is reachable only from the database-owner/migration authority — the role that owns `public.categories`, of which `anon`, `authenticated` and `service_role` are not members. Once assigned, no path the guard can see may change or clear the code, operator included: reassignment would silently move a financial semantic between rows. A registered system category can never be archived or deleted, enforced by both the guard and `categories_system_not_archivable_check`, and its rename is rejected by a distinct, more specific error.

Category hard delete is refused for every role and TRUNCATE is refused on all three tables.

**Rename, archive and reactivation are fail-closed for every role, the database owner's ordinary DML included.** Category text still carries financial meaning — `transactions.category`, `category_rules.category` and `041`'s classification all read it — so SHR-157 R12's measurable zero-text-semantic-consumer inventory must be zero before a label may change. And no archive eligibility predicate is consulted at all: a placeholder that let some archives through would be an operational archive algorithm, not a deferral. SHR-167 owns the current-plan predicate; SHR-160 owns atomic rule lifecycle.

The line the guards draw is between an operational lifecycle transition and the restoration of historical state. A transition is an `UPDATE` on a row that exists, and every rename, archive and reactivation is refused. A restore is an `INSERT` of a row that does not exist, and only there — and only on the operator path — may an archive timestamp appear, because an encrypted backup has to be re-importable exactly as it was. That is not a back door: archiving a live category through `INSERT` would mean deleting it first, and `DELETE` is refused for every role.

Rename history and resolver aliases stay separate. The history writer stays wired even though no rename can reach it, so whichever package meets the gate inherits working evidence rather than an untested trigger; QA exercises it through an isolated owner-DDL fixture — disabling the guard inside the test's own transaction — which needs table ownership and a schema-level ALTER and is therefore reachable by no product surface, API role or service role. A former label becomes resolvable only through an explicit alias registration, and retiring that alias releases the label rather than reserving an ordinary former name forever. Collision handling is exact text equality on purpose: no normalization algorithm has been specified or reviewed, and inventing one would have created a second authoritative identity rule.

Authorization is unchanged. Both new tables enable RLS with a single member `SELECT` policy rooted in `private.is_household_member()`; no API role holds INSERT/UPDATE/DELETE; `service_role` holds raw `SELECT` only for the encrypted export. Every new function lives in `private`, pins an empty `search_path`, and is executable by no API role. Category lifecycle and `system_code` never appear in an RLS predicate, and no taxonomy administrator role is invented. As with SHR-191, trigger-based protection binds ordinary and accidentally over-granted application paths while the database owner remains the documented administrative trust root.

## Bounded application containment

`src/lib/categories.js`'s `deleteCategory` no longer issues a destructive request. v6 approved no user or API category hard delete, and migration `046` enforces that at the database boundary for every path; leaving the client helper issuing a `DELETE` would have meant sending a request that can only fail. The Settings screen still imports it and is otherwise untouched — replacing that control with archive UX is SHR-158's work, not this package's.

`updateCategory` is deliberately left as-is and documented rather than changed. The database is the single authority on what may change, and duplicating the rename rule in the client would create a second, weaker one; after `046` a rename attempt fails at the database with `SHR196_CATEGORY_RENAME_NOT_ENABLED`, so the helper provides no working rename path. Group and icon edits still work unchanged, which is what the household actually uses it for. Surfacing the refusal in the Settings form is SHR-158's work.

Nothing else in the application changed. `listCategories` and `createCategory` behave exactly as before, and a household member can still create a category and edit its group and icon.

## Backup, restore, and migration safety

The backup manifest now carries `category_name_history` and `category_aliases` as financial record, ordered after `categories` so a restore never violates their foreign keys. Focused coverage exports a system-coded category, a historically archived category, a renamed category, its immutable history and a retired alias through the manifest contract, restores them into isolated tables with the production constraints, and compares the complete JSON representation — including a check that the archived row comes back archived. The restored copy is then re-checked: an unapproved code and a duplicate system anchor are still rejected, an archived system category is still impossible, history is still immutable, and — once the lifecycle guard is re-attached — `history_only` is still terminal and alias evidence is still undeletable.

The migration is additive and restart-safe throughout: guarded column, constraint, index, table, function, trigger and policy creation, and a one-time `updated_at` backfill guarded by `where updated_at is null`. Upgrade coverage builds the schema through migration `044` — the exact state production is in — applies `045` then `046`, and asserts that every existing category's id, name, group, icon and `created_at` is unchanged, that no code is seeded, that nothing is archived, that `updated_at` still equals `created_at`, that no history, alias or audit row is synthesized, and that a representative transaction, the budgets and the category rules are byte-identical at the same tuple identity. It then applies `046` a second time and re-asserts all of it.

The one physical change to existing rows is the `updated_at` backfill, which writes a new MVCC tuple version per category. Every value a consumer can observe is identical; that is what the upgrade comparison asserts, and it is why `ctid` stability is asserted on `transactions` rather than on `categories`.

## Validation

Local validation completed against a real PostgreSQL 16 server on this host:

- `npm ci` — pass;
- `npm run lint` — pass, zero errors and the six pre-existing warnings;
- `npm run test:node` — pass, 527/527 (was 526; +1 backup manifest test);
- `npm run test:ui` — pass, 9 files and 89/89;
- `npm run build` — pass;
- `npm audit --omit=dev --audit-level=high` — pass, zero vulnerabilities;
- `npm run test:db` — pass, 154/154 (was 110; +44 SHR-196 cases) plus both upgrade-path runners.

## Protected boundaries

- No system-code seed, no inference from a current category name, and no reinterpretation of the legacy `Transfer` or `Savings & Investments` rows.
- No `transactions.category_id` or `category_rules.category_id`, no backfill, no consumer cutover, no V2 resolver.
- No rename, archive or reactivation path of any kind — not an RPC, and not ordinary DML for any role including the database owner. No budget-active predicate, no rule precedence or enabled lifecycle.
- No financial classification, canonical equation, budget actual, income, net-worth, account valuation, household scope or economic-ownership change.
- No category ownership or default-owner concept, no taxonomy administrator role, no RLS change.
- No audit-action allowlist expansion and no synthesized history of any kind.
- No production migration, data change, deployment, Netlify change, or merge.

The PR remains unmerged and is labeled `[skip netlify]` because this package has no site change.

## Next ownership boundaries

- **SHR-197** — evidence-reviewed system-code assignment and stable-reference reconciliation, including the transaction and rule UUID references and their manifest backfill.
- **SHR-198** — V2 resolver, canonical classification and writer compatibility.
- **SHR-160** — category-rule identity, deterministic precedence and enabled/disabled lifecycle, which archive enablement depends on.
- **SHR-167** — the current-budget predicate archive also depends on.
- **SHR-158** — Settings Categories UI, including whatever replaces the delete control.
