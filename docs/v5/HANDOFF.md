# Our Money v6 handoff — SHR-194 evidence-reviewed access-to-party reconciliation and mapping lifecycle

Date: 31 August 2026

Branch: `claude/shr-194-access-party-reconciliation-bwwjly`

Exact reviewed base: `6fcbaa8752b1ef06ea6159534a471e3a0fac5abb` (SHR-193, `main`)

The immutable PR head, PR URL, and final CI conclusions are recorded in the SHR-194 Linear implementation handoff because embedding a commit's own SHA would change it.

## Outcome

This bounded Tier-3 package is P04 in the V6.0 convergence sequence: the reconciliation and lifecycle layer on top of SHR-193's empty economic identity substrate. It adds a read-only preflight, a transactional evidence-gated manifest path, the audited mapping create/change/deactivate lifecycle, immutable decision history, the SHR-191 typed audit policy for mapping decisions, and one narrow context API.

**It is capability, not data.** Applying migration `048` creates no economic household, no party, no mapping decision and no audit event. Rows appear only when a separately approved manifest is applied, and **no manifest is approved** — see "Production manifest" below. No financial consumer behaviour changes, no financial RLS policy differs, and no historical financial fact is read for inference or written.

## Database contract

Migration `048_access_party_reconciliation.sql` adds:

- `public.access_party_mapping_history` — append-only per-decision history with a monotonic `decision_version`, the before and after status and party of each transition, the database-authored decision time, the acting access identity and the evidence reference. Composite foreign keys bind the row to its own mapping's household and both party references to that same household;
- `public.access_party_reconciliation_runs` — the immutable record of an applied manifest, keyed by a unique manifest reference and carrying the manifest digest and the roster digest actually proven at apply time;
- `private.access_roster_digest_v1()`, `private.access_party_preflight_v1()`, `private.access_party_roster_v1()` — the read-only preflight;
- `private.create_economic_party_v1(...)` — approved party creation;
- `private.set_access_party_mapping_v1(...)`, `private.deactivate_access_party_mapping_v1(...)`, `private.current_access_party_mapping_v1(...)` — the ordinary lifecycle;
- `private.reconcile_access_parties_v1(...)` — the transactional manifest path;
- `public.access_scope_context_v1(p_economic_household_id default null)` — the context API, the only product surface this package adds;
- `private.reject_access_party_evidence_mutation()` / `..._truncate()` and their triggers — append-only enforcement on both new tables;
- an additive unique constraint on `access_party_mappings (mapping_id, household_id)`, added only so the history table's composite foreign key has something to target. It is implied by the primary key and constrains nothing new.

It also widens three `audit_events` check constraints additively and replaces two function bodies. Both SHR-191 QA branches are reproduced verbatim, so every 045 assertion and every existing payload digest is unaffected.

## Mapping lifecycle

`create` is an ordinary `INSERT`, `change` and `deactivate` are ordinary `UPDATE`s — which is exactly what makes SHR-193's lifecycle trigger author the decision timestamp. Every transition writes one history row and one audit event in the same transaction.

**"Archive" means what the SHR-193 schema can express.** That schema gave *parties* an archive lifecycle and gave mappings three statuses and no archive column, so deactivating a mapping moves the decision to `access_only`. Household authorization is untouched, the mapping row and its whole history survive, the party survives, and the withdrawal is itself a new audited decision. No mapping row is ever deleted and no `archived_at` column was invented for one.

**Re-applying a decision already exactly in force is an explicit no-op**: no new decision time, no history row, no audit event, and the call reports `changed = false`. That is not a swallowed mismatch — there is nothing different to record — and it is what makes a retry safe. A decision that differs in any way is a real change and is recorded as one.

Concurrency is deterministic and fail-closed at three independent levels: a transaction-scoped advisory lock on the exact decision subject, `SELECT ... FOR UPDATE` on the existing row, and — if both were bypassed — the unique key on `(mapping_id, decision_version)` plus SHR-193's own unique key on `(household_id, auth_user_id)`. Neither an ambiguous current state nor a lost history row is representable. A real two-connection race is exercised in the upgrade runner and proves consecutive decision versions, a single-valued current mapping, a contiguous history chain and one audit event per decision.

## The SHR-193 restore boundary is not used

`private.restore_access_party_mapping_v1()` remains SHR-193's administrative disaster-recovery path and is not this package's writer. Proven four ways:

- no SHR-194 function's body references it or sets `shr193.restore_mapping_id` — asserted by inspecting `pg_get_functiondef` for all nine functions, not by reading the source;
- the ordinary writer refuses to run at all, with `SHR194_RESTORE_TOKEN_SET_ON_ORDINARY_DECISION`, if that token is set before it is called;
- the SHR-193 lifecycle trigger is neither disabled, dropped nor replaced, asserted against `pg_trigger` on both a fresh and an upgraded database;
- the restore function still exists exactly once, still invoker-mode, still executable by no API role.

Every ordinary new decision has its `decided_at` authored by the database, and an archived party is still refused outright on every ordinary path.

## Audit contract

SHR-191 anticipated this: "future audited mutation RPCs may call it inside their own transaction after that action receives an independently reviewed typed policy." So `048` registers SHR-194's typed policy on the existing substrate rather than creating a parallel audit table. `private.append_audit_event_v1`'s 13-argument signature is unchanged — every 045 grant, revoke and test still applies to exactly that function — and what changed is that producer, kinds, versions, outcome code and change evidence are derived per action instead of hardcoded to the QA policy.

Three actions: `economic.access_party_mapping.created | .changed | .deactivated`, producer `shr194.access_party_mapping`, target kind `economic.access_party_mapping` (the mapping), evidence kind `economic.access_party_mapping_decision` (the history row for that exact decision version). The **audit event derives its versions and change projection from the history row named by `p_evidence_id`**, which is the important property: an event cannot disagree with the decision it describes, and cannot exist for a decision that never happened.

The projection is closed to exactly seven keys — `field_code`, `before_code`, `after_code`, `before_party_id`, `after_party_id`, `household_id`, `evidence_ref_digest` — enforced by the table's own check constraint, so an extra key is rejected. It carries coded states and opaque identifiers only; the free-text evidence reference appears as a SHA-256 digest, never verbatim, so no name, email address or request body reaches audit. Acting provenance is `authenticated_user` + `operator_api` when an access identity is supplied (and SHR-191's insert trigger still requires that identity to be a current household member), or `system` + `migration` for the migration/operator authority. No new actor kind and no new surface code was introduced.

`public.audit_history_v1` gained the new target kind and is otherwise unchanged: same membership authorization, same redaction, Telegram sender refs still never returned.

Audit failure rolls back the mutation it was recording — proven by making the audit append fail on a non-member actor and asserting no mapping, no history and no audit row survives.

## Context API

`public.access_scope_context_v1(p_economic_household_id default null)`, `SECURITY DEFINER`, executable by `authenticated` only, authorized by `private.is_household_member()` and nothing else.

It distinguishes four states — `mapped`, `access_only`, `unreviewed`, `unmapped` — and returns the caller's economic party if any, the economic household, the active party count, and `scope_options`. Options always lead with the whole-household scope (`scope_code: 'both'`, `counted_once: true`), followed by the household's **active** economic parties; an archived party stays resolvable for historical reads but is never offered as a new choice. `Me` and `Partner` are computed presentation codes, Partner only when precisely one other active party exists, and neither is stored.

Cross-household containment is structural rather than an added policy: the caller's own mapping decision names their economic household, so they can only ever see the household a reviewed decision placed them in. Naming any other household returns forbidden whether or not it exists, and a caller holding decisions in two households gets a fail-closed ambiguity error rather than a guess.

It is deliberately not a financial aggregation engine. It returns no amount, no balance, no allocation, no share, weight, percentage or ratio — asserted by walking the returned structure for fractional keys and for any numeric value in the scope options at all — and no email address or Telegram identity.

## Authorization, ACL and RLS

Authorization is unchanged, and the upgrade runner proves it as a diff rather than a claim: the entire pre-existing policy set is byte-identical across `048`, and the financial policy set is byte-identical all the way back to the through-`044` production shape. `private.is_household_member()` is still the only predicate, no policy anywhere consults economic identity, no role is created, and no household RBAC is invented.

Both new tables enable RLS. `access_party_mapping_history` gets one member `SELECT` policy — the same terms as the mapping decisions it describes, which `047` already grants members. `access_party_reconciliation_runs` follows the `audit_events` pattern instead: no API read at all, and `service_role` `SELECT` only for the encrypted export, because run records carry roster digests and manifest references and answer no product question.

No API role holds `INSERT`, `UPDATE` or `DELETE` on either table. Every writer, preflight and roster function lives in `private`, pins an empty `search_path`, is invoker-mode so the operator check sees the role that actually issued the statement, checks `private.economic_identity_operator_authority()` itself, and is executable by no API role — so a browser session or an Edge Function cannot reach a mapping decision even if a policy were misconfigured. `private.access_party_roster_v1()` in particular returns email evidence and is unreachable from any API surface.

## Production manifest — not approved, and not invented

**No approved manifest exists.** Checked: the SHR-194 Linear issue has no comments, attachments or documents; the parent SHR-156 states the manifest requirement without supplying one; a workspace document search returns nothing; and the repository contains no manifest.

Read-only production inspection confirms the *shape* the issue describes is consistent with reality — three access identities in `household_members`, and none of `economic_households`, `economic_parties`, `access_party_mappings` or `audit_events` exists yet — but which login represents which human, and which is the access-only test identity, is a human decision. Deriving it from the email addresses I can see would be exactly the inference this package exists to forbid.

So the mechanism and its fixtures are implemented and the decisions are not. `docs/data-ops/shr-194-access-party-manifest.md` is the procedure and an explicitly unfilled template. **A human must complete step 2 of that document and record the approval in Linear before any production reconciliation may run.**

## Backup, restore and migration safety

`access_party_mapping_history` and `access_party_reconciliation_runs` are both `financial` in the backup manifest, ordered after the tables their foreign keys target. Coverage exports a decision that was created, changed and then deactivated, restores it into a clean table with the production constraints, and compares the complete JSON representation — every decision version, both party sides and the database-authored timestamps survive in order. That ordering is the point: a restore that lost the middle decision would produce a plausible but false history. The restored copy is then re-checked and is still append-only, and its shape constraints still refuse a creation that claims a previous state or a deactivation meaning anything other than mapped → access_only.

The migration is additive and restart-safe throughout: guarded constraint, index, table, function, trigger and policy creation, no backfill, and no `UPDATE` of any existing row. Upgrade coverage builds the schema through `044` — the exact state production is in — applies `045`, `046`, `047` then `048`, and asserts every financial row is byte- **and tuple-**identical, that no economic or audit row is created, that the policy set is unchanged, that no ownership column or `household_id` reaches any financial table, and that the SHR-193 restore boundary is intact. It then applies `048` twice more and re-asserts all of it, applies a production-shaped manifest for real, and re-applies `048` a fourth time over live decisions to prove a rerun disturbs no applied evidence and rewrites no history.

## Three SHR-193 assertions were made exact, not weakened

Three assertions in `economic_identity.test.mjs` were written as name-pattern proxies for SHR-193's scope and now match SHR-194's objects. Each was rewritten to assert the claim it was actually protecting, and each is now stronger:

- *"no party join/allocation table"* was a `table_name ilike '%part%'` probe. It now asserts structurally, across every table in the schema, that none holds more than one foreign key to `economic_parties` — with the one exception named and explained, since history's two party columns are the before and after of a single transition, not a join — plus that no fractional-ownership column exists anywhere in the substrate.
- *"nothing may reference mapping decisions"* now asserts that every inbound foreign key is `RESTRICT` or `NO ACTION`, never cascade or set-null. The claim was always about silent cascades; a `RESTRICT` reference makes a mapping harder to remove, never easier, and the assertion now proves that of every referencing table rather than relying on there being none.
- *"the four guards, the operator predicate and the restore boundary"* counted six matched functions. It now names those six explicitly and still applies every property check — invoker-mode, pinned `search_path`, no API `EXECUTE` — to all fourteen functions the probe matches, so the coverage went up rather than down.

## Validation

Local validation completed against a real PostgreSQL 16 server on this host:

- `npm ci` — pass;
- `npm run lint` — pass, zero errors and the six pre-existing warnings;
- `npm run test:node` — pass, 529/529 (was 528; +1 backup manifest test);
- `npm run test:ui` — pass, 9 files and 89/89;
- `npm run build` — pass;
- `npm audit --omit=dev --audit-level=high` — pass, zero vulnerabilities;
- `npm run test:db` — pass, 268/268 (was 200; +68 SHR-194 cases) plus all four upgrade-path runners;
- `git diff --check` — clean.

## Protected boundaries

- No economic household, party, mapping decision or audit event is created by applying the migration, and no production manifest is approved or executed.
- No identity is inferred from a name, email address, Telegram id, account, transaction, category, goal or historical percentage.
- The test access identity remains `access_only`; its authorization is neither removed nor changed.
- The SHR-193 restore function and token are not used, and its lifecycle trigger is not weakened, disabled or bypassed. No equivalent restore path is introduced.
- No transaction, account, income, recurring item, goal, budget, investment or net-worth fact is rewritten; no financial table receives an ownership or attribution column; no `household_id` is fanned out.
- No Telegram sender storage or association migration; no Telegram id is an economic key.
- No financial RLS policy diff, no new role, no household RBAC, no API-role mutation grant, no fractional allocation.
- No production migration, data change, DDL, DML, Edge Function or backup deployment, Netlify change, or merge.

The PR remains unmerged and is labeled `[skip netlify]` because this package has no site change.

## Release ordering

`048` depends on `045`, `046` and `047`, none of which is applied. SHR-191's release condition stands and is not weakened: `045` must be applied together with the deployment of the reviewed backup source, so audit evidence cannot accumulate before backup coverage exists. `048` writes audit evidence, so it is downstream of that condition rather than an exception to it.

## Next ownership boundaries

- **The human manifest approval** — step 2 of `docs/data-ops/shr-194-access-party-manifest.md`. Nothing downstream can reconcile production until it exists.
- **SHR-195** — transaction and posted-income stable attribution references.
- **SHR-154** — account ownership and joint-allocation compatibility.
- **SHR-171** — recurring and expected-income plan scope.
- **SHR-178** — canonical goal progress and lifecycle, including goal ownership, which stays deferred and unassigned.
- **SHR-160 / 184** — category-rule identity precedence and the Telegram association migration.
