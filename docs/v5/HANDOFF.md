# Our Money v6 handoff — SHR-154 account ownership stable references

Date: 31 August 2026

Branch: `claude/account-ownership-stable-refs-o6lfah`

Exact reviewed base: `ee116417021c5ef60414f01cf26ddf4d8111b806` (SHR-194 / PR #26, `main`)

The immutable PR head, PR URL, and final CI conclusions are recorded in the SHR-154 Linear implementation handoff because embedding a commit's own SHA would change it.

## Outcome

This bounded Tier-3 package is the account-ownership reference foundation on top of SHR-193's economic identity substrate and SHR-194's reconciliation capability. It adds two additive columns on `accounts`, append-only ownership decision evidence, a read-only preflight, one transactional evidence-gated manifest path, and the additive V2 read adapters.

**It is capability, not data.** Applying migration `049` creates no ownership fact. Every existing account arrives `ownership_kind = 'unreconciled'` with `owner_party_id` null, and stays that way until a separately approved manifest is applied. **No manifest is approved**, and none can be until SHR-194's own manifest is — production has no economic parties for an account to reference. No consumer is cut over, no financial value moves, no financial RLS policy differs, and the legacy `owner` text remains authoritative everywhere it already was.

## Database contract

Migration `049_account_ownership_stable_refs.sql` adds:

- `public.accounts.ownership_kind` — `personal` | `household` | `unreconciled`, `not null default 'unreconciled'` (a constant default, so Postgres applies it as a fast default and rewrites no tuple);
- `public.accounts.owner_party_id` — nullable UUID, a **typed logical reference** to `public.economic_parties(party_id)` rather than a foreign key (see "Reviewer hotspots");
- `accounts_ownership_kind_check`, `accounts_ownership_shape_check` (personal ⇒ exactly one party; household/unreconciled ⇒ none) and two indexes;
- `public.account_ownership_history` — append-only per-account decision history with a monotonic `decision_version`, the before/after kind and party, the economic household, the acting identity and the evidence reference. `account_id` is a **typed logical reference, not a foreign key**, so deleting an account still works exactly as it does today and the evidence outlives it;
- `public.account_ownership_reconciliation_runs` — the immutable record of an applied manifest, keyed by a unique manifest reference and carrying the manifest digest and the account-state digest actually proven at apply time;
- `private.account_ownership_digest_v1()`, `private.account_ownership_preflight_v1()`, `private.account_ownership_roster_v1()` — the read-only preflight;
- `private.set_account_ownership_v1(...)` — the ownership writer, operator-only;
- `private.reconcile_account_ownership_v1(...)` — the transactional manifest path;
- `private.guard_account_ownership_reference()` and its `accounts` trigger — the compatibility boundary;
- `private.begin_account_ownership_restore_v1(uuid)` — the single-use per-account restore boundary;
- `private.reject_account_ownership_evidence_mutation()` / `..._truncate()` and their triggers;
- `public.v_account_ownership_v2` and `public.canonical_balance_sheet_v2(text, uuid)` — the additive V2 read adapters.

### What it deliberately does not do

- **No inference from any label.** `Shrey`, `Tarika`, `Joint`, `Both`, `Me`, `Partner` — none is read to decide ownership. `Joint` specifically does not become `household`. A test asserts the writers consult no legacy label, transaction, income, goal, recurring row, setting or `income_split`.
- **No fractional ownership.** No share, weight, percentage, ratio or split column exists on any object in this package, and a shared account is one row counted once, never duplicated per party. The historical 69/31 income target is untouched and is not an ownership input.
- **No authorization change.** `public.household_members` + `private.is_household_member()` remains the only root. No existing policy is created, dropped or altered; no policy anywhere reads ownership; no role is invented. Owning an account grants nothing and owning none removes nothing.
- **No ownership mutation API.** No API role can assign ownership even though `authenticated` holds table-level `UPDATE` on `accounts` — the guard refuses with `SHR154_OWNERSHIP_WRITE_FORBIDDEN`. The household-facing lifecycle belongs to SHR-158.
- **No audit change.** `049` writes no `audit_events` row and alters no SHR-191/194 audit constraint, function or allowlist. See "Reviewer questions" below.
- **No consumer cutover and no valuation math.** Every v1 canonical contract is byte-identical before and after.

## Compatibility

The guard's fast path returns an unchanged `NEW` for any account write that does not touch the ownership columns — every insert, update and delete the app performs today, including edits to `owner`. An ownership decision writes only the two ownership columns and deliberately never touches `updated_at`, because `v_canonical_accounts_aed` derives valuation freshness from it.

Legacy owner-text consumers that remain unchanged and are owned by their own downstream issues:

| Consumer | Kind | Owning issue |
|---|---|---|
| `canonical_balance_sheet(scope, person)` — `a.owner is not distinct from p_person` | financial calculation | SHR-173 |
| `canonical_investment_metrics(scope, person)` — same predicate | financial calculation | SHR-173 |
| `canonical_period_metrics` / `v_canonical_ledger_aed.owner` (transaction owner) | financial calculation | SHR-195 |
| `record_net_worth_snapshot` → `nw_snapshot_items.owner`, `nw_daily.by_owner` | financial history | SHR-172 |
| `src/lib/accounts.js` `OWNERS = ['Shrey','Tarika','Joint']` | presentation source | SHR-158 |
| `AccountForm.jsx` owner select | write surface | SHR-158 |
| `Accounts.jsx` group-by owner, card/detail owner lines | presentation | SHR-153 / SHR-158 |
| `NetWorthBreakdown.jsx` group-by owner | presentation | SHR-173 |
| `Investments.jsx` owner filter and group-by | presentation | SHR-173 |
| `canonicalPresentation.js` owner dimension, `canonicalMetrics.js` person scope | presentation/read | SHR-173 |
| `routes.js` `group: ['type','owner']`, owner filters | routing state | SHR-153 |
| `Recurring.jsx` / `RecurringForm.jsx` owner | planning scope | SHR-171 |
| `TransactionForm.jsx` / `TransactionList.jsx` / `transactions.js` owner | transaction attribution | SHR-195 |
| `reports.js` owner grouping and CSV header | reporting | SHR-173 |
| Telegram `resolveOwner` / `paid_by` → `transactions.owner` | intake attribution | SHR-160 / SHR-184 / SHR-195 |

A test asserts that no v1 canonical function and no existing view reads `ownership_kind` or `owner_party_id`.

## Backup and restore

`BACKUP_TABLES` gains `account_ownership_history` and `account_ownership_reconciliation_runs`, both `financial`. **`accounts` now restores after `economic_households` and `economic_parties`**, because the ownership guard resolves the party on every write that sets ownership — a restore included — and refuses an account whose party does not exist yet. The ordering test enforces it. A backup source deployed from before this change would restore a reconciled database in the wrong order, so the backup deployment and `049` must ship together.

A restore drill exports a three-version ownership history through the manifest, restores it into a clean table carrying the production constraints and compares exactly; a second drill proves the archived-party restore boundary is single-use, INSERT-only, and unreachable by the ordinary writer.

## Validation

Run on this branch against Postgres 16, from a clean `npm ci`:

| Command | Result |
|---|---|
| `npm ci` | clean |
| `npm run lint` | 0 errors, 7 warnings (all pre-existing) |
| `npm run test:node` | 531 pass, 0 fail (base `main`: 529 — **+2** new backup-manifest tests) |
| `npm run test:ui` | 89 pass, 0 fail (unchanged) |
| `npm run test:db` | 325 pass, 0 fail (base `main`: 268 — **+57** new SHR-154 tests) |
| `npm run test:db:ownership-upgrade` | passes — new runner, wired into `test:db` |
| `npm run build` | clean |
| `npm audit --omit=dev --audit-level=high` | 0 vulnerabilities |
| `git diff --check` | clean |

The shared-database `test:db` suite was run five additional consecutive times with zero failures.

**Two CI-only failures were found and fixed before the final head**, both worth the reviewer's attention:

1. *Wall-clock comparison.* The upgrade runner compared `v_canonical_accounts_aed` wholesale, including `valuation_age_seconds` — `now() - valuation_as_of`, which moves with the clock rather than with anything the migration changes. It passed locally because the before/after snapshots landed in the same second. Reproduced locally by injecting a two-second delay, fixed by excluding that one column, and re-verified: the pre-fix runner fails on exactly that column under the injected skew and the fixed one passes. Every other column is still compared in full.

2. *A real design problem the FK caused.* CI reported `deadlock detected` between `truncate table public.economic_parties cascade` (SHR-193's own reviewed test) and a plain `insert into accounts` from an unrelated pre-existing test — neither statement touching ownership. Root cause: the draft's `accounts.owner_party_id` foreign key made **every** write to `accounts` take a lock on `economic_parties`, and made any exclusive statement on `economic_parties` reciprocally lock `accounts`. That is a genuine coupling between the household's hottest financial table and the identity substrate, not a test artifact. Fixed by making `owner_party_id` a typed logical reference validated by the guard — the same boundary 045 uses for audit actors and 047 for mapping auth identities. Nothing is lost: the guard resolves the party on every write that sets ownership (ordinary and restore alike, raising `SHR154_OWNERSHIP_PARTY_UNKNOWN`), no API role can write the column, and 047 forbids party deletion, so a reference cannot dangle. A test asserts the absence of the foreign key, the refusal of a bogus party id on both the writer and raw-operator paths, and that an ordinary account insert takes no write-blocking lock on `economic_parties`.

`npm run parity:canonical` was **not run**: it requires `PARITY_DATABASE_URL` against a live database and is a production parity harness, not part of `test:db`. No production credentials were used in this session beyond read-only inspection.

## Production state — re-verified read-only

- Highest applied migration: `20260828220730 / 044_manual_transaction_safety`. `045`, `046`, `047`, `048` and `049` are all **unapplied**.
- `public.accounts`: 50 rows. `owner` is `Shrey` (42) and `Tarika` (8). No `Joint`, `Both`, `Me` or `Partner` row exists.
- `accounts` carries no `ownership_kind` or `owner_party_id` column.
- No `audit_events`, `economic_households`, `economic_parties`, `access_party_mappings`, `access_party_mapping_history`, `access_party_reconciliation_runs`, `account_ownership_history` or `account_ownership_reconciliation_runs` table exists.
- No DDL, no DML, no deploy and no migration apply was performed.

## Release gates

1. **SHR-191's gate stands.** `045` must be applied together with the deployment of the reviewed backup source. `049` does not weaken it and is downstream of it.
2. **The backup source must ship with `049`.** The restore ordering changed.
3. **SHR-194's manifest must be approved and applied first.** There are no economic parties to own an account otherwise.
4. **No SHR-154 account-ownership manifest is approved.** The procedure and template are in `docs/data-ops/shr-154-account-ownership-manifest.md`; filling it in is the human approval step and is explicitly not done here.
5. Production apply of `045`–`049` remains a separately authorized release with its own post-apply advisor/ACL/RLS/backup smoke.

## Reviewer hotspots

- **Two reviewed tests were narrowed by exact column name**, not by pattern: `access_party_reconciliation.test.mjs`'s "SHR-194 adds no ownership or attribution column" and `economic_identity.test.mjs`'s "no financial table receives ownership or attribution in SHR-193". Both run against the fully migrated shared database and so cannot tell which migration added a column. Each now excludes only `accounts.owner_party_id` (and `ownership_kind`); anything else still fails. That 047 and 048 themselves add no column at all is proved directly and unchanged by their own upgrade-path runners, which diff the whole column set across those migrations alone.
- **The `accounts` guard inlines the operator predicate** rather than calling `private.economic_identity_operator_authority()`. It is the identical expression, and a test pins that they agree for the operator and for all three API roles. It is inlined because this trigger, unlike every guard in 045–048, is genuinely reached by unprivileged roles.
- **A lock-ordering line in the SHR-154 test helper.** Tests in this file write ownership, so their transactions touch both `accounts` and `economic_parties` while SHR-193's truncate test holds the latter exclusively. `seedAccounts` reads `economic_parties` first so both take the same lock order. This is a test-harness ordering fix, not a product change, and is now belt-and-braces rather than load-bearing since the foreign key was removed.
- **Neither `accounts.owner_party_id` nor `account_ownership_history.account_id` is a foreign key.** Both are deliberate and for different reasons. For `owner_party_id` it is the financial-write/identity-lock decoupling described above, proven necessary by a CI deadlock. For `account_id` on the history table, an FK would either erase evidence on account deletion or, with RESTRICT, make a reconciled account undeletable — silently breaking behaviour the app has today. `accounts` therefore holds no foreign key at all, exactly as before 049, and the upgrade runner asserts that.
- **The cross-household invariant is relational, not a column.** `accounts` gains no `household_id` (047 fans none out), so containment is enforced by refusing a party whose economic household differs from that of every other account already carrying ownership.

## Reviewer questions

1. **Audit.** `049` writes no `audit_events` row and widens no audit constraint. SHR-194's issue explicitly required its mapping changes to be audited; SHR-154's issue does not mention audit, ADR-018 scopes `audit_events` to minimized action evidence rather than domain state, and reconciliation here is a release-time operator action no API role can reach. Durable evidence is the append-only history row plus the immutable run record. Is that the intended reading, or should ownership decisions also carry a typed SHR-191 policy?
2. **Exhaustive manifest coverage.** The reconciliation path requires exactly one decision per current account, so no account is silently left unreconciled. That means a later manifest must re-state already-reconciled accounts (which no-op). Is exhaustive coverage preferred over batched partial manifests?
3. **`canonical_balance_sheet_v2` party scope excludes shared and unreconciled accounts and reports both as counts.** This is deliberate — no allocation of any kind — but it means party scopes do not sum to the household total. Confirm that is the intended contract before SHR-173 consumes it.
