import assert from 'node:assert/strict'
import test from 'node:test'

import { BACKUP_TABLES, backupFilename, backupSummary, buildBackup } from './dump.ts'

const NOW = () => '2026-08-12T22:00:00.000Z'

function fakeFetcher(data: Record<string, unknown[]>) {
  return (table: string) => Promise.resolve(data[table] ?? [])
}

test('every table with a dependency is listed after what it depends on', () => {
  // Restoring in list order must never violate a foreign key.
  const seen = new Set<string>()
  for (const table of BACKUP_TABLES) {
    for (const dep of (table as { dependsOn?: readonly string[] }).dependsOn ?? []) {
      assert.ok(seen.has(dep), `${table.name} depends on ${dep}, which must come first`)
    }
    seen.add(table.name)
  }
})

test('the dump covers every table exactly once', () => {
  const names = BACKUP_TABLES.map((t) => t.name)
  assert.equal(new Set(names).size, names.length, 'no duplicates')
  // The tables holding the household's actual records.
  for (const required of [
    'accounts',
    'transactions',
    'goals',
    'budgets',
    'recurring',
    'income',
    'settings',
    'audit_events',
    'category_name_history',
    'category_aliases',
  ]) {
    assert.ok(names.includes(required), `${required} must be backed up`)
  }
})

test('category lifecycle evidence is financial and ordered after category identity', () => {
  const names = BACKUP_TABLES.map((table) => table.name)
  const categoryIndex = names.indexOf('categories')

  for (const name of ['category_name_history', 'category_aliases']) {
    const table = BACKUP_TABLES.find((candidate) => candidate.name === name)
    assert.ok(table)
    assert.equal(table.financial, true)
    assert.ok(names.indexOf(name) > categoryIndex)
    assert.deepEqual((table as { dependsOn?: readonly string[] }).dependsOn, ['categories'])
  }
})

test('immutable audit evidence is classified as financial and restore-order independent', () => {
  const audit = BACKUP_TABLES.find((table) => table.name === 'audit_events')
  assert.ok(audit)
  assert.equal(audit.financial, true)
  assert.deepEqual((audit as { dependsOn?: readonly string[] }).dependsOn ?? [], [])
})

test('a backup records row counts and separates financial from operational rows', async () => {
  const doc = await buildBackup(
    fakeFetcher({
      accounts: [{ id: 'a' }, { id: 'b' }],
      transactions: [{ id: 't' }],
      audit_events: [{ event_id: 'e' }],
      intake_logs: [{ id: 'l' }, { id: 'l2' }, { id: 'l3' }],
    }),
    '20260811201631',
    NOW
  )

  assert.equal(doc.meta.total_rows, 7)
  assert.equal(doc.meta.financial_rows, 4, 'audit is financial evidence; intake_logs is operational')
  assert.equal(doc.meta.row_counts.accounts, 2)
  assert.equal(doc.meta.schema_version, '20260811201631')
  assert.deepEqual(doc.tables.accounts, [{ id: 'a' }, { id: 'b' }])
})

test('every table appears in the document even when empty', async () => {
  const doc = await buildBackup(fakeFetcher({}), null, NOW)
  for (const table of BACKUP_TABLES) {
    assert.ok(table.name in doc.tables, `${table.name} must be present`)
    assert.deepEqual(doc.tables[table.name], [])
  }
  assert.equal(doc.meta.total_rows, 0)
})

test('a table that fails to read aborts the backup instead of omitting it', async () => {
  // A file that silently lacks `transactions` would look like a valid backup
  // and be trusted — the worst possible outcome.
  const fetcher = (table: string) =>
    table === 'transactions' ? Promise.reject(new Error('connection reset')) : Promise.resolve([])

  await assert.rejects(
    () => buildBackup(fetcher, null, NOW),
    (e: Error) => {
      assert.match(e.message, /backup aborted/)
      assert.match(e.message, /transactions/)
      return true
    }
  )
})

test('a missing schema version is tolerated', async () => {
  const doc = await buildBackup(fakeFetcher({}), null, NOW)
  assert.equal(doc.meta.schema_version, null)
})

test('the filename carries the date and row count', async () => {
  const doc = await buildBackup(fakeFetcher({ accounts: [{ id: 'a' }, { id: 'b' }] }), null, NOW)
  assert.equal(backupFilename(doc.meta), 'our-money-2026-08-12-2rows.ombk')
})

test('the summary names the financial tables that actually hold rows', async () => {
  const doc = await buildBackup(
    fakeFetcher({ accounts: [{ id: 'a' }], transactions: [{ id: 't' }], notifications: [{ id: 'n' }] }),
    null,
    NOW
  )
  const summary = backupSummary(doc.meta)

  assert.match(summary, /3 rows \(2 financial\)/)
  assert.match(summary, /accounts 1/)
  assert.match(summary, /transactions 1/)
  assert.doesNotMatch(summary, /notifications/, 'operational tables are not itemised')
})
