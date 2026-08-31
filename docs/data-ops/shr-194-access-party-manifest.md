# SHR-194 — access-to-party reconciliation manifest

Status: **mechanism implemented, no manifest approved.** Migration `048` is in
the repository and is not applied to production. No economic household, party or
mapping decision exists in production, and none may be created until a human has
approved a manifest through the procedure below.

This document is the procedure and the template. It is deliberately not a filled
-in manifest, because filling it in is the human approval step.

## Why a manifest exists at all

An access identity is not an economic party. Which human an authenticated login
represents — or that it represents nobody, and is legitimately access-only — is
a fact about the household, not something the database can derive. Every
available shortcut is wrong:

- a **display name** or **email address** is presentation and evidence, never an
  ownership key, and both change;
- a **Telegram sender id** identifies a chat participant, not an economic party,
  and its migration is SHR-160/184's, not this package's;
- **transaction history**, **account ownership text**, **category behaviour**
  and the historical **69/31** split are all downstream consequences of who
  someone is. Reading them backwards to decide identity would encode today's
  bookkeeping as tomorrow's ownership truth.

So the reconciliation function infers nothing. It is handed the decisions and
refuses to run if the world has moved since they were approved.

## Step 1 — take the preflight evidence

Run as the database owner (the migration/operator authority). Both functions are
read-only, and neither is executable by `anon`, `authenticated` or
`service_role`.

```sql
select * from private.access_party_preflight_v1();
select * from private.access_party_roster_v1();
```

`access_party_preflight_v1()` returns the counts and the roster digest the
manifest is approved against. `access_party_roster_v1()` returns one row per
current access identity, with the email evidence a human needs in order to
recognise who is who. **That output is evidence for a person to read, not an
input to any automated decision** — nothing consumes it, and it is deliberately
not transcribed into this repository, both because it contains personal data and
because a transcribed roster goes stale silently while a live digest does not.

Record, in the SHR-194 Linear issue, the exact values you approved against:

- `access_member_count`
- `access_roster_digest`
- `economic_household_count`, `economic_party_count`, `mapping_count`
  (all expected to be `0` for the first reconciliation)

## Step 2 — a human approves the decisions

For each access identity in the roster, a human decides one of exactly two
things, and writes it down in the issue:

- **`mapped`** — this login represents a specific economic party, named by a
  `party_key` from the party list;
- **`access_only`** — this login is legitimately authorized for the household
  and is deliberately not an economic party.

There is no third option and no default. `unreviewed` is the absence of a
decision and cannot be chosen; the reconciliation function refuses a manifest
that does not cover every current access identity exactly once.

Two constraints from the SHR-156 contract apply to the party list:

- parties are N-party from day one. Nothing here encodes a couple, and the
  household may legitimately have one, two or many;
- `legacy_owner_label` is compatibility only and **frozen forever once set**. It
  records which legacy owner text a party corresponds to. It is never an
  identifier, never unique, and no permission is derived from it. Leave it out
  unless a downstream compatibility need is already known.

### Template — fill in and get approved before use

```jsonc
// parties
[
  { "party_key": "<stable-key-1>", "display_name": "<HUMAN NAME>" },
  { "party_key": "<stable-key-2>", "display_name": "<HUMAN NAME>" }
]

// decisions — one entry per current access identity, no exceptions
[
  { "auth_user_id": "<UUID FROM THE ROSTER>", "status": "mapped",
    "party_key": "<stable-key-1>" },
  { "auth_user_id": "<UUID FROM THE ROSTER>", "status": "mapped",
    "party_key": "<stable-key-2>" },
  { "auth_user_id": "<UUID FROM THE ROSTER>", "status": "access_only" }
]
```

`party_key` is a manifest-local label used only to join a decision to a party
being created in the same call. It is never stored, and it is never an economic
party identity — the generated UUID is.

**The existing test access identity stays `access_only`.** SHR-194 does not make
it an economic party and does not remove or change its authorization.

## Step 3 — apply, once, inside a transaction

```sql
begin;
select private.reconcile_access_parties_v1(
  p_manifest_ref                      => 'SHR-194-manifest-<date>',
  p_expected_access_member_count      => <from step 1>,
  p_expected_access_roster_digest     => '<from step 1>',
  p_expected_economic_household_count => 0,
  p_expected_economic_party_count     => 0,
  p_expected_mapping_count            => 0,
  p_household_display_name            => '<household name>',
  p_parties                           => '<approved party JSON>'::jsonb,
  p_decisions                         => '<approved decision JSON>'::jsonb,
  p_acting_access_user_id             => null
);
-- read the result, confirm the counts, then:
commit;
```

What the function guarantees:

- **it aborts before any DML** if the access count, the roster digest or the
  economic state differ from what was approved. A changed email or a replaced
  login moves the digest even at an unchanged headcount, and that is the point;
- **it is one transaction.** The household, every party, every decision, all
  their history rows, all their audit events and the run record commit together
  or not at all. Partial application is not representable;
- **it is idempotent by manifest reference.** Re-running the same approved
  manifest — after a retry, a restart, or a re-applied migration — is a replay
  that performs no DML and returns the original household. The same reference
  carrying *different* content is refused as `SHR194_MANIFEST_CONFLICT` rather
  than quietly applied a second time;
- **it never touches a financial fact.** No transaction, account, income,
  recurring item, goal, budget, investment or net-worth row is read for
  inference or written at all.

## Afterwards — the ordinary lifecycle

The reconciliation path is for the first, manifest-approved reconciliation.
Every later change goes through the ordinary lifecycle, which is audited the
same way:

```sql
select * from private.set_access_party_mapping_v1(
  p_household_id => ..., p_auth_user_id => ..., p_status => 'mapped',
  p_economic_party_id => ..., p_decision_evidence_ref => '<why>');

select * from private.deactivate_access_party_mapping_v1(
  p_household_id => ..., p_auth_user_id => ..., p_decision_evidence_ref => '<why>');

select * from private.current_access_party_mapping_v1(p_household_id => ..., p_auth_user_id => ...);
```

Three things about that path are worth knowing before using it:

- **the database authors the decision time.** No caller, operator included, may
  supply one. Reproducing a *historical* decision is
  `private.restore_access_party_mapping_v1()`, which is SHR-193's
  disaster-recovery boundary and is **not** a writer for new decisions. The
  ordinary writer refuses to run at all if that function's token is set;
- **re-applying a decision already exactly in force is a no-op** — no new
  decision time, no history row, no audit event. A decision that differs in any
  way is a real change and is recorded as one;
- **nothing is ever deleted.** Withdrawing an economic mapping is
  `deactivate_...`, which moves the decision to `access_only`, leaves household
  authorization untouched, keeps the party, and preserves every earlier decision
  in `public.access_party_mapping_history`.

## Release ordering

`048` depends on `045`, `046` and `047`. Production is currently through `044`,
and none of the four is applied. SHR-191's release condition still stands and is
not weakened here: `045` must be applied together with the deployment of the
reviewed backup source, so that audit evidence cannot accumulate before backup
coverage exists. `048` writes audit evidence, so it is downstream of that
condition rather than an exception to it.
