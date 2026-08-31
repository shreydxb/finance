# SHR-154 — account ownership manifest

Status: **mechanism implemented, no manifest approved.** Migration `049` is in
the repository and is not applied to production. No account in production
carries a stable owner, and none may until a human has approved a manifest
through the procedure below.

It is also **blocked on SHR-194.** An account's stable owner is an economic
party, and production has no economic parties — SHR-194's access-to-party
manifest is itself still unapproved. There is nothing for an account to point
at yet, and inventing a party in order to give an account an owner would be
exactly the identity invention both packages exist to prevent.

This document is the procedure and the template. It is deliberately not a
filled-in manifest, because filling it in is the human approval step.

## Why a manifest exists at all

Production's `accounts.owner` column holds free text. Today it reads `Shrey`
(42 rows) and `Tarika` (8 rows); the app's own picker also offers `Joint`, and
`Both`, `Me` and `Partner` are v6 presentation language that no row carries.
Every one of those is a **label a human typed**, and none of them is an economic
identity. Reading them backwards would be wrong in three separate ways:

- a label names no party. Two accounts labelled `Shrey` may legitimately belong
  to different economic parties, or one of them may be genuinely shared. Only a
  human knows which;
- `Joint` is not a synonym for `ownership_kind = 'household'`. It is a habit of
  data entry. A `Joint`-labelled account may be shared, or may be one person's
  account that was mislabelled years ago;
- a label is mutable. Anything derived from it would silently drift the next
  time someone edits an account form.

SHR-194 established that access identity cannot be inferred from presentation
evidence. This is the same rule applied to a financial fact, and the
reconciliation function honours it structurally: it reads no label, no account
name, no transaction, no category, no goal and no historical percentage. It is
handed the decisions and refuses to run if the world has moved since they were
approved.

**The historical 69/31 income split is not an ownership input.** It is an income
guidance target in Settings and Reports, it has never described account
ownership, and no part of this contract may use it — or any other percentage —
to allocate anything. There is no fractional ownership in this schema at all.

## Prerequisite — SHR-194 first

```sql
select count(*) from public.economic_parties;   -- must be > 0
select count(*) from public.economic_households;
```

If these are zero, stop. Approve and apply the SHR-194 manifest first
(`docs/data-ops/shr-194-access-party-manifest.md`). Account ownership references
parties by UUID; it cannot create one and must not.

Note also what the SHR-194 manifest deliberately does *not* settle: a party's
`legacy_owner_label` is optional there and is compatibility evidence only. Even
when it is set, it is **not** an input to this manifest. Do not join accounts to
parties through it.

## Step 1 — take the preflight evidence

Run as the database owner (the migration/operator authority). Both functions are
read-only, and neither is executable by `anon`, `authenticated` or
`service_role`.

```sql
select * from private.account_ownership_preflight_v1();
select * from private.account_ownership_roster_v1();
```

`account_ownership_preflight_v1()` returns the counts and the state digest the
manifest is approved against. `account_ownership_roster_v1()` returns one row
per account with the name and legacy label a human needs in order to recognise
which account is which. **That output is evidence for a person to read, not an
input to any automated decision** — nothing consumes it, and it is deliberately
not transcribed into this repository, both because it describes the household's
finances and because a transcribed roster goes stale silently while a live
digest does not.

Record, in the SHR-154 Linear issue, the exact values you approved against:

- `account_count`
- `account_state_digest`
- `unreconciled_account_count`
- `reconciliation_run_count` (expected to be `0` for the first reconciliation)
- the `economic_household_id` the parties belong to

## Step 2 — a human decides every account

For each account in the roster, a human decides one of exactly two things, and
writes it down in the issue:

- **`personal`** — this account belongs to one specific economic party, named by
  its `party_id` UUID;
- **`household`** — this account is genuinely shared household truth. It is one
  row, counted once. It gets **no** owning party, and it is **not** split,
  duplicated per party, or allocated by any percentage.

There is no third option and no default. `unreconciled` is the absence of a
decision and cannot be chosen; the reconciliation function refuses a manifest
that does not cover every current account exactly once, and refuses a duplicate.

### Template — fill in and get approved before use

```jsonc
// assignments — one entry per current account, no exceptions
[
  { "account_id": "<UUID FROM THE ROSTER>", "ownership_kind": "personal",
    "owner_party_id": "<PARTY UUID FROM SHR-194>" },
  { "account_id": "<UUID FROM THE ROSTER>", "ownership_kind": "personal",
    "owner_party_id": "<PARTY UUID FROM SHR-194>" },
  { "account_id": "<UUID FROM THE ROSTER>", "ownership_kind": "household" }
]
```

An optional `"evidence_ref"` per assignment records why that particular decision
was made; it defaults to the manifest reference.

## Step 3 — apply, once, inside a transaction

```sql
begin;
select private.reconcile_account_ownership_v1(
  p_manifest_ref                        => 'SHR-154-manifest-<date>',
  p_expected_account_count              => <from step 1>,
  p_expected_account_state_digest       => '<from step 1>',
  p_expected_unreconciled_account_count => <from step 1>,
  p_expected_reconciliation_run_count   => 0,
  p_economic_household_id               => '<economic household UUID>',
  p_assignments                         => '<approved assignment JSON>'::jsonb,
  p_acting_access_user_id               => null
);
-- read the result, confirm the counts, then:
commit;
```

What the function guarantees:

- **it aborts before any DML** if the account count, the ownership state digest
  or the reconciliation state differ from what was approved. An account added,
  removed or relabelled moves the digest even at an unchanged headcount, and
  that is the point;
- **it is one transaction.** Every assignment, every history row and the run
  record commit together or not at all. Partial application is not
  representable;
- **it is idempotent by manifest reference.** Re-running the same approved
  manifest — after a retry, a restart, or a re-applied migration — is a replay
  that performs no DML. The same reference carrying *different* content is
  refused as `SHR154_MANIFEST_CONFLICT` rather than quietly applied a second
  time;
- **it changes no financial value.** No account value, no `updated_at`, no
  transaction, income, budget, recurring item, goal or snapshot is written. Only
  `ownership_kind` and `owner_party_id` move. `updated_at` in particular is left
  alone deliberately, because `v_canonical_accounts_aed` derives valuation
  freshness from it;
- **it changes no authorization.** `public.household_members` and
  `private.is_household_member()` remain the only authorization root, and no
  policy anywhere reads ownership.

## Afterwards

SHR-154 deliberately ships **no ownership mutation API**. There is no product
surface for "change this account's owner", and no API role — `anon`,
`authenticated` or `service_role` — can assign ownership even though
`authenticated` holds table-level `UPDATE` on `accounts`; the guard refuses it
with `SHR154_OWNERSHIP_WRITE_FORBIDDEN`. Correcting a decision is an operator
action through `private.set_account_ownership_v1()`, and the household-facing
lifecycle belongs to SHR-158.

Three things about that path are worth knowing before using it:

- **a decision can never regress to `unreconciled`.** Correcting one is a
  forward change to the right fact, recorded as a new decision version. Both the
  writer and the table guard refuse the regression;
- **a new decision fails closed on an archived party.** An account whose party
  is archived *afterwards* is untouched and stays fully resolvable — that is the
  historical-stability half of the same rule. Reproducing such an account during
  a restore is `private.begin_account_ownership_restore_v1()`, a single-use
  per-account boundary that is **not** a writer for new decisions; the ordinary
  writer refuses to run at all if its token is set;
- **nothing is ever deleted.** `public.account_ownership_history` is append-only
  for every role, the database owner included, and it holds the account id as a
  typed logical reference rather than a foreign key — so deleting an account
  still works exactly as it does today, and the evidence that its ownership was
  once decided outlives it.

## Release ordering

`049` depends on `045`, `046`, `047` and `048`. Production is currently through
`044`, and none of the five is applied. SHR-191's release condition still stands
and is not weakened here: `045` must be applied together with the deployment of
the reviewed backup source, so that audit evidence cannot accumulate before
backup coverage exists.

The backup manifest changed in this package and must ship with it: `accounts`
now restores **after** `economic_parties`, because the ownership guard resolves
the party on every write that sets ownership — a restore included — and the two
new evidence tables are covered as `financial`. A backup source deployed from
before this change would restore a reconciled database in the wrong order.
