# Test-data cleanup — 12 August 2026

Authorised by the data owner during the QA/QC stabilization session, twice and
explicitly ("delete [TEST] data forever, we will build new test data later once
everything is fixed and we are ready to test").

## What was found

50 of 63 active `transactions` rows in production (`our-rokda`) carried a
`[TEST]` note prefix — **79% of the table**. They were inserted in two bulk
batches:

| Inserted at (UTC) | Rows | Amount (AED) | Transaction dates covered |
|---|---|---|---|
| 2026-08-11 19:19:25 | 44 | 28,841.50 | 2026-05-18 → 2026-08-09 |
| 2026-08-11 19:20:05 | 6 | 1,705.00 | 2026-06-08 → 2026-07-20 |
| **Total** | **50** | **30,546.50** | |

`income` held 3 further `[TEST]` rows (of 4), all cashback fixtures, totalling
48.50 AED.

Two things this changes beyond the cleanup itself:

- **Every total the app displayed was dominated by fixtures.** Real spend is
  2,717.57 AED, not the 32,264.07 the app was showing.
- **All 3 `split_group_id` groups belonged to this fixture set.** No real
  category split or transfer has ever been recorded, which shrinks DATA-01 from
  a data migration to a forward-looking schema change with nothing to backfill.

The fixtures were indistinguishable from real data except by a note prefix —
no `is_test` flag, no separate environment, no marker on `income` beyond text
in a free-form `source` field.

## Action taken

1. Soft-deleted all 50 transactions (`deleted_at`), verified the reconciliation.
2. On explicit instruction to make it permanent, hard-deleted the same 50 rows
   and the 3 `income` rows.

Checked first: **no `intake_logs` rows referenced any deleted transaction**
(`intake_logs.transaction_id` is a foreign key), so nothing was orphaned and no
observability history was lost.

## Reconciliation

| Table | Before | After | Removed |
|---|---|---|---|
| `transactions` | 63 | **13** | 50 |
| `income` | 4 | **1** | 3 |
| Active spend (AED, excl. transfers) | 32,264.07 | **2,717.57** | 29,546.50 |
| Rows with `split_group_id` | 6 | **0** | 6 |

Untouched and verified clean of fixtures: `accounts` (46), `goals` (6),
`goal_contributions` (1), `recurring` (24), `budgets` (12), `categories` (20).

## Rollback

**None.** This was a permanent delete, made on explicit instruction. The rows
are not recoverable from the database; recovery would require a Supabase backup
predating 2026-08-12 12:00 UTC.

## The 13 real transactions

All 13 survivors are Telegram-sourced, dated 11 Jul – 10 Aug. Of these:

- **3 have `amount = 0`** and 4 are flagged `needs_review` — these are the
  artifacts of the failed receipt extractions recorded in `intake_logs`
  (see BOT-02: 4 of 8 real photo extractions failed).
- **3 have a null category.**
- **None** has ever been marked reviewed.

They are the only real transaction data the household has. Treat them as
precious — and note that a 50% photo-extraction failure rate is the reason
there are so few.

## Follow-up recommended

Fixtures should never again be indistinguishable from real rows in the
production database. Options, in order of preference:

1. Seed test data into a separate Supabase branch/project, not production.
2. If fixtures must live in production, add an explicit `is_test boolean`
   column with a partial index, and filter it in every read path — not a
   convention inside a free-text note.
