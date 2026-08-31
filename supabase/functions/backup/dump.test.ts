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
    'economic_households',
    'economic_parties',
    'access_party_mappings',
    'access_party_mapping_history',
    'access_party_reconciliation_runs',
    'account_ownership_history',
    'account_ownership_reconciliation_runs',
  ]) {
    assert.ok(names.includes(required), `${required} must be backed up`)
  }
})

test('durable category lifecycle evidence is financial and restores after its references', () => {
  // Losing rename history or alias state would leave a restored database
  // unable to prove which label a category used to carry, or which former
  // label a resolver is still allowed to accept.
  const history = BACKUP_TABLES.find((table) => table.name === 'category_name_history')
  const aliases = BACKUP_TABLES.find((table) => table.name === 'category_aliases')
  assert.ok(history)
  assert.ok(aliases)
  assert.equal(history.financial, true)
  assert.equal(aliases.financial, true)
  assert.deepEqual((history as { dependsOn?: readonly string[] }).dependsOn, ['categories'])
  assert.deepEqual((aliases as { dependsOn?: readonly string[] }).dependsOn, [
    'categories',
    'category_name_history',
  ])
})

test('durable economic identity substrate is financial and restores after its references', () => {
  // A party UUID is the stable identity later attribution packages reference,
  // and a mapping decision records which access identity was reviewed as
  // representing which party. Neither can be reconstructed by inspection, and
  // restoring a mapping before its party or household would violate the
  // composite foreign key that keeps a mapping inside one economic household.
  const households = BACKUP_TABLES.find((table) => table.name === 'economic_households')
  const parties = BACKUP_TABLES.find((table) => table.name === 'economic_parties')
  const mappings = BACKUP_TABLES.find((table) => table.name === 'access_party_mappings')
  assert.ok(households)
  assert.ok(parties)
  assert.ok(mappings)
  assert.equal(households.financial, true)
  assert.equal(parties.financial, true)
  assert.equal(mappings.financial, true)
  assert.deepEqual((households as { dependsOn?: readonly string[] }).dependsOn ?? [], [])
  assert.deepEqual((parties as { dependsOn?: readonly string[] }).dependsOn, [
    'economic_households',
  ])
  assert.deepEqual((mappings as { dependsOn?: readonly string[] }).dependsOn, [
    'economic_households',
    'economic_parties',
  ])
})

test('SHR-194 reconciliation evidence is financial and restores after its references', () => {
  // Mapping history is the only record that a decision was ever different: lose
  // it and a restored database asserts the current mapping as though it had
  // always been true. The run records are what make a re-applied manifest a
  // replay rather than a second set of decisions.
  const history = BACKUP_TABLES.find((table) => table.name === 'access_party_mapping_history')
  const runs = BACKUP_TABLES.find((table) => table.name === 'access_party_reconciliation_runs')
  assert.ok(history)
  assert.ok(runs)
  assert.equal(history.financial, true)
  assert.equal(runs.financial, true)
  assert.deepEqual((history as { dependsOn?: readonly string[] }).dependsOn, [
    'economic_households',
    'economic_parties',
    'access_party_mappings',
  ])
  assert.deepEqual((runs as { dependsOn?: readonly string[] }).dependsOn, ['economic_households'])

  const names = BACKUP_TABLES.map((table) => table.name)
  assert.ok(
    names.indexOf('access_party_mappings') < names.indexOf('access_party_mapping_history'),
    'history restores after the mapping rows its composite foreign key targets'
  )
})

test('SHR-154 account ownership evidence is financial and restores after its references', () => {
  // Ownership history is the only record that an account's economic ownership
  // was ever different: lose it and a restored database asserts the current
  // owner as though it had always been true. The run records are what make a
  // re-applied manifest a replay rather than a second reconciliation.
  const history = BACKUP_TABLES.find((table) => table.name === 'account_ownership_history')
  const runs = BACKUP_TABLES.find(
    (table) => table.name === 'account_ownership_reconciliation_runs'
  )
  assert.ok(history)
  assert.ok(runs)
  assert.equal(history.financial, true)
  assert.equal(runs.financial, true)
  // The account reference is a typed logical reference rather than a foreign
  // key, so history survives an account being deleted and only the economic
  // household ordering is load-bearing.
  assert.deepEqual((history as { dependsOn?: readonly string[] }).dependsOn, [
    'economic_households',
  ])
  assert.deepEqual((runs as { dependsOn?: readonly string[] }).dependsOn, ['economic_households'])

  const names = BACKUP_TABLES.map((table) => table.name)
  assert.ok(
    names.indexOf('economic_households') < names.indexOf('account_ownership_history'),
    'ownership history restores after the economic household it references'
  )
})

test('accounts restore after the economic parties a reconciled account references', () => {
  // SHR-154 gave accounts a stable owner_party_id foreign key. Restoring the
  // accounts table before economic_parties would fail on that key for any
  // account whose ownership has been reconciled.
  const accounts = BACKUP_TABLES.find((table) => table.name === 'accounts')
  assert.ok(accounts)
  assert.deepEqual((accounts as { dependsOn?: readonly string[] }).dependsOn, ['economic_parties'])

  const names = BACKUP_TABLES.map((table) => table.name)
  assert.ok(names.indexOf('economic_households') < names.indexOf('economic_parties'))
  assert.ok(names.indexOf('economic_parties') < names.indexOf('accounts'))
  assert.ok(
    names.indexOf('accounts') < names.indexOf('transactions'),
    'the tables that reference accounts still restore after it'
  )
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
