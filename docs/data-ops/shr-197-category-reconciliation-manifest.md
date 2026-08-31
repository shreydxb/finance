# SHR-197 category reconciliation manifest procedure

Migration `050` installs capability only. It contains no production UUID,
manifest, inferred mapping, or automatic name backfill. Production remains
unchanged until a human independently reviews the exact preflight and approves
one immutable manifest reference and payload.

## Release ordering

Production is independently verified through migration `044`. Migration `045`
must ship together with the reviewed backup-function source. Migrations
`046`–`050` are not production-authorized merely because they are merged.

Before any reconciliation, independently verify the deployed backup source can
export and restore the `050` columns and all five reconciliation-evidence
tables. Do not apply this procedure from an application, browser, Edge
Function, or service-role session. The private functions are database-owner /
migration-authority operations and are executable by no API role.

## 1. Read-only preflight

Run these reads in one read-only transaction and retain their unedited output:

```sql
begin transaction read only;

select * from private.category_reconciliation_preflight_v1();
select private.category_reconciliation_roster_v1();
select * from private.category_legacy_label_candidates_v1();

rollback;
```

The evidence includes exact category UUID/name/system-code/archive state,
active and soft-deleted transaction counts, rule-target counts, NULL category
counts, every distinct legacy label, candidate UUIDs, unknown/ambiguous status,
the V1 classification-text digest, and the source-state digest. Candidate UUIDs
are review evidence only. They are never a mapping decision and the release
function never joins a legacy label to `categories.name` to choose a UUID.

If `ambiguous_label_count` is non-zero, stop. Strict reconciliation is not
permitted. If the roster or digest changes after review, stop and obtain a new
review; do not edit an old approval in place.

## 2. Human-approved manifest

The approval must include:

- a unique immutable `manifest_ref`;
- the exact preflight source digest and every expected count required by
  `private.reconcile_category_references_v1`;
- exactly two explicit system assignments, one each for `transfer` and
  `savings_investment`, each naming the independently reviewed category UUID;
- exactly one classification decision for every non-NULL legacy label;
- `mapped` plus an explicit reviewed `category_id` for each uniquely evidenced
  label; and
- `unresolved_unknown` with no UUID for every unknown label.

NULL transaction category is deliberately absent from the manifest. The
database records it as `uncategorized_null` and preserves `category_id IS NULL`.
`Other` is an ordinary label/UUID decision and is never substituted for NULL.

Example shape for controlled fixtures only (the UUIDs below are deliberately
non-production placeholders):

```json
{
  "system_categories": [
    {"system_code":"transfer","category_id":"00000000-0000-0000-0000-000000000101"},
    {"system_code":"savings_investment","category_id":"00000000-0000-0000-0000-000000000102"}
  ],
  "classifications": [
    {"legacy_label":"Fixture Transfer","resolution":"mapped","category_id":"00000000-0000-0000-0000-000000000101","evidence_ref":"review-fixture"},
    {"legacy_label":"Unknown Fixture","resolution":"unresolved_unknown","evidence_ref":"review-fixture"}
  ]
}
```

Do not replace those placeholders with production UUIDs based on names. The
approval must come from independent review of the exact production evidence.

## 3. Apply atomically

Call `private.reconcile_category_references_v1(...)` once in a deliberate
release transaction with the approved values. The function serializes releases,
locks the three source tables, checks replay/conflict, proves the complete
preflight and exhaustive manifest, and validates every UUID before its first
row write. Any mismatch or later error aborts the whole statement/transaction.

The same manifest reference plus the same exact content returns `replayed=true`
with no DML. Reusing the reference for different content fails with
`SHR197_MANIFEST_CONFLICT`.

## 4. Verify without changing V1

After commit, retain these results with the release evidence:

```sql
select * from public.category_reconciliation_runs where manifest_ref = '<approved-ref>';
select * from public.category_reconciliation_system_entries where run_id = '<run-id>' order by entry_index;
select * from public.category_reconciliation_manifest_entries where run_id = '<run-id>' order by entry_index;
select resolution, subject_kind, transaction_soft_deleted, count(*)
from public.category_reconciliation_row_evidence
where run_id = '<run-id>'
group by resolution, subject_kind, transaction_soft_deleted
order by subject_kind, resolution, transaction_soft_deleted;
select * from private.category_reconciliation_mismatch_report_v1('<run-id>');
```

The mismatch report must be empty. The run's before/after classification digest
must be identical. Independently re-run canonical V1 financial parity evidence.
No transaction/rule legacy text, amount, transfer grouping, provenance, rule
precedence, Telegram behavior, or financial equation is changed by SHR-197.

Rollback is route-level: stop future `category_id` consumers and retain every
stable reference and evidence row. Never delete reconciliation evidence or
attempt to undo it with a name-based update.
