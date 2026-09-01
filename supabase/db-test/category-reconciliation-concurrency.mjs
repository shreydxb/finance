// SHR-197 deterministic two-connection lock/race proof.
//
// This runner owns a disposable database. Test-only BEFORE INSERT gates pause
// first-run/replay after verification has reached the durable-receipt boundary.
// pg_locks, not elapsed sleeps, proves concurrent transaction and alias writes
// are waiting until the reconciliation transaction commits.

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const { Client } = pg
const here = dirname(fileURLToPath(import.meta.url))
const setupPath = join(here, 'setup-db.mjs')
const adminUrl = process.env.DATABASE_URL || 'postgres://postgres:postgres@127.0.0.1:5432/postgres'
const dbName = 'our_money_shr197_concurrency_test'

function dbUrl(url, database) {
  const parsed = new URL(url)
  parsed.pathname = `/${database}`
  return parsed.toString()
}

async function dropDatabase() {
  assert.equal(dbName, 'our_money_shr197_concurrency_test')
  const admin = new Client({ connectionString: adminUrl })
  await admin.connect()
  try {
    await admin.query(
      `select pg_terminate_backend(pid) from pg_stat_activity
       where datname=$1 and pid<>pg_backend_pid()`,
      [dbName]
    )
    await admin.query(`drop database if exists ${admin.escapeIdentifier(dbName)}`)
  } finally {
    await admin.end()
  }
}

const setup = spawnSync(process.execPath, [setupPath], {
  env: { ...process.env, TEST_DB_NAME: dbName },
  encoding: 'utf8',
})
if (setup.stdout) process.stdout.write(setup.stdout)
if (setup.stderr) process.stderr.write(setup.stderr)
if (setup.status !== 0) process.exit(setup.status ?? 1)

const url = dbUrl(adminUrl, dbName)
const control = new Client({ connectionString: url })
const observer = new Client({ connectionString: url })
const gate = new Client({ connectionString: url })
const reconciler = new Client({ connectionString: url })
const transactionWriter = new Client({ connectionString: url })
const aliasWriter = new Client({ connectionString: url })
const clients = [control, observer, gate, reconciler, transactionWriter, aliasWriter]

const reconcileSql = `select private.reconcile_category_references_v1(
  $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb,$13) result`

function argsFor(pre, fixture, manifestRef = 'SHR197-concurrency-controlled-manifest') {
  return [
    manifestRef,
    pre.source_state_digest,
    pre.category_count,
    pre.transaction_count,
    pre.category_rule_count,
    pre.null_transaction_category_count,
    pre.soft_deleted_transaction_count,
    pre.distinct_legacy_label_count,
    pre.unknown_label_count,
    pre.reconciliation_run_count,
    JSON.stringify([
      { system_code: 'transfer', category_id: fixture.transferId },
      { system_code: 'savings_investment', category_id: fixture.savingsId },
    ]),
    JSON.stringify([
      { legacy_label: fixture.ordinaryName, resolution: 'mapped', category_id: fixture.ordinaryId },
      { legacy_label: fixture.savingsName, resolution: 'mapped', category_id: fixture.savingsId },
      { legacy_label: fixture.transferName, resolution: 'mapped', category_id: fixture.transferId },
      { legacy_label: fixture.unknownName, resolution: 'unresolved_unknown' },
    ]),
    null,
  ]
}

async function preflight(client = control) {
  return (await client.query(`select * from private.category_reconciliation_preflight_v1()`)).rows[0]
}

async function expectDatabaseError(client, expected, fn) {
  await assert.rejects(fn(), expected)
  await client.query('rollback')
}

async function waitUntilBlocked(pid, label) {
  for (let attempt = 0; attempt < 1000; attempt += 1) {
    const { rows } = await observer.query(
      `select exists(select 1 from pg_locks where pid=$1 and not granted) blocked`,
      [pid]
    )
    if (rows[0].blocked) return
    await new Promise((resolve) => setImmediate(resolve))
  }
  throw new Error(`${label} never entered a deterministic PostgreSQL lock wait`)
}

async function assertSourceShareLocks(pid) {
  const { rows } = await observer.query(
    `select c.relname, l.mode, l.granted
       from pg_locks l join pg_class c on c.oid=l.relation
      where l.pid=$1 and c.relname = any($2::text[])
      order by c.relname`,
    [pid, [
      'categories', 'category_aliases', 'transactions', 'category_rules',
      'category_reconciliation_runs', 'category_reconciliation_system_entries',
      'category_reconciliation_row_evidence',
    ]]
  )
  const locked = new Map(rows.filter((row) => row.granted && row.mode === 'ShareLock')
    .map((row) => [row.relname, row.mode]))
  assert.deepEqual([...locked.keys()].sort(), [
    'categories', 'category_aliases', 'category_reconciliation_row_evidence',
    'category_reconciliation_runs', 'category_reconciliation_system_entries',
    'category_rules', 'transactions',
  ])
}

async function installGate(table, key) {
  await control.query(`create or replace function private.shr197_concurrency_gate()
    returns trigger language plpgsql security invoker set search_path='' as $$
    begin
      perform pg_catalog.pg_advisory_xact_lock(197, tg_argv[0]::integer);
      return new;
    end $$`)
  await control.query(`drop trigger if exists shr197_concurrency_gate on public.${table}`)
  await control.query(`create trigger shr197_concurrency_gate before insert on public.${table}
    for each row execute function private.shr197_concurrency_gate('${key}')`)
}

async function removeGate(table) {
  await control.query(`drop trigger if exists shr197_concurrency_gate on public.${table}`)
}

try {
  await Promise.all(clients.map((client) => client.connect()))

  const accountId = (await control.query(`insert into public.accounts(name,owner,type,value)
    values('SHR197 concurrency account','Fixture','cash',0) returning id`)).rows[0].id
  const suffix = crypto.randomUUID()
  const categoryRows = (await control.query(
    `insert into public.categories(name,"group") values
      ($1,'Wants'),($2,'Savings'),($3,'Wants') returning id,name`,
    [`SHR197 C Transfer ${suffix}`, `SHR197 C Savings ${suffix}`, `SHR197 C Ordinary ${suffix}`]
  )).rows
  const byName = Object.fromEntries(categoryRows.map((row) => [row.name, row.id]))
  const fixture = {
    transferName: `SHR197 C Transfer ${suffix}`,
    savingsName: `SHR197 C Savings ${suffix}`,
    ordinaryName: `SHR197 C Ordinary ${suffix}`,
    unknownName: `SHR197 C Unknown ${suffix}`,
  }
  fixture.transferId = byName[fixture.transferName]
  fixture.savingsId = byName[fixture.savingsName]
  fixture.ordinaryId = byName[fixture.ordinaryName]
  const txId = (await control.query(
    `insert into public.transactions(date,amount,account_id,category)
     values('2026-09-01',10,$1,$2) returning id`,
    [accountId, fixture.ordinaryName]
  )).rows[0].id
  await control.query(
    `insert into public.transactions(date,amount,account_id,category,deleted_at) values
      ('2026-09-01',20,$1,$2,'2026-09-01'),
      ('2026-09-01',30,$1,$3,null),
      ('2026-09-01',40,$1,$4,null),
      ('2026-09-01',50,$1,null,null)`,
    [accountId, fixture.transferName, fixture.savingsName, fixture.unknownName]
  )
  await control.query(`insert into public.category_rules(pattern,category) values($1,$2)`,
    [`SHR197 concurrency ${suffix}`, fixture.ordinaryName])

  // Alias creation changes candidate evidence and makes the approved digest stale.
  await control.query('begin')
  const staleCreation = await preflight(control)
  await control.query(`select * from private.register_category_alias_v1($1,$2,null)`,
    [fixture.ordinaryId, fixture.unknownName])
  const afterCreation = await preflight(control)
  assert.notEqual(afterCreation.category_alias_state_digest, staleCreation.category_alias_state_digest)
  assert.equal(afterCreation.unknown_label_count, staleCreation.unknown_label_count - 1)
  await expectDatabaseError(control, /SHR197_PREFLIGHT_DIGEST_STALE/,
    () => control.query(reconcileSql, argsFor(staleCreation, fixture, 'SHR197-stale-alias-create')))

  // Retirement + replacement keeps one candidate and all public counts stable,
  // but changes the exact candidate UUID and therefore the digest.
  await control.query('begin')
  const alias = (await control.query(`select * from private.register_category_alias_v1($1,$2,null)`,
    [fixture.ordinaryId, fixture.unknownName])).rows[0]
  const staleSwap = await preflight(control)
  await control.query(`select * from private.retire_category_alias_v1($1)`, [alias.alias_id])
  await control.query(`select * from private.register_category_alias_v1($1,$2,null)`,
    [fixture.transferId, fixture.unknownName])
  const afterSwap = await preflight(control)
  const beforeCandidate = staleSwap.roster.legacy_labels.find((row) => row.legacy_label === fixture.unknownName)
  const afterCandidate = afterSwap.roster.legacy_labels.find((row) => row.legacy_label === fixture.unknownName)
  assert.equal(beforeCandidate.candidate_category_count, 1)
  assert.equal(afterCandidate.candidate_category_count, 1)
  assert.notDeepEqual(afterCandidate.candidate_category_ids, beforeCandidate.candidate_category_ids)
  for (const field of [
    'category_count', 'transaction_count', 'category_rule_count',
    'null_transaction_category_count', 'soft_deleted_transaction_count',
    'distinct_legacy_label_count', 'unknown_label_count',
  ]) assert.equal(afterSwap[field], staleSwap[field])
  await expectDatabaseError(control, /SHR197_PREFLIGHT_DIGEST_STALE/,
    () => control.query(reconcileSql, argsFor(staleSwap, fixture, 'SHR197-stale-alias-swap')))

  // A controlled invalid alias fixture proves ambiguity still fails closed.
  await control.query('begin')
  await control.query(`alter table public.category_aliases disable trigger category_aliases_lifecycle_guard`)
  await control.query(
    `insert into public.category_aliases(category_id,alias_name,state)
     values($1,$2,'compatibility_active')`,
    [fixture.transferId, fixture.ordinaryName]
  )
  await control.query(`alter table public.category_aliases enable trigger category_aliases_lifecycle_guard`)
  const ambiguous = await preflight(control)
  assert.equal(ambiguous.ambiguous_label_count, 1)
  await expectDatabaseError(control, /SHR197_PREFLIGHT_AMBIGUOUS_LABELS/,
    () => control.query(reconcileSql, argsFor(ambiguous, fixture, 'SHR197-alias-ambiguity')))

  const approved = await preflight(control)
  const approvedArgs = argsFor(approved, fixture)
  const reconcilerPid = reconciler.processID
  const transactionWriterPid = transactionWriter.processID
  const aliasWriterPid = aliasWriter.processID

  // FIRST RUN: pause at the durable run insert. Both a transaction mutation
  // and alias registration must wait behind the already-acquired SHARE locks.
  await installGate('category_reconciliation_runs', 5001)
  await gate.query('begin')
  await gate.query(`select pg_advisory_xact_lock(197,5001)`)
  await reconciler.query('begin')
  const firstQuery = reconciler.query(reconcileSql, approvedArgs)
  await waitUntilBlocked(reconcilerPid, 'first-run evidence gate')
  await assertSourceShareLocks(reconcilerPid)

  await transactionWriter.query('begin')
  const firstTransactionMutation = transactionWriter.query(
    `update public.transactions set deleted_at=now() where id=$1`, [txId]
  )
  await aliasWriter.query('begin')
  const firstAliasMutation = aliasWriter.query(
    `select * from private.register_category_alias_v1($1,$2,null)`,
    [fixture.ordinaryId, fixture.unknownName]
  )
  await waitUntilBlocked(transactionWriterPid, 'first-run transaction writer')
  await waitUntilBlocked(aliasWriterPid, 'first-run alias writer')
  await gate.query('commit')
  const first = (await firstQuery).rows[0].result
  assert.equal(first.replayed, false)
  await waitUntilBlocked(transactionWriterPid, 'transaction writer through first-run receipt')
  await waitUntilBlocked(aliasWriterPid, 'alias writer through first-run receipt')
  await reconciler.query('commit')
  await Promise.all([firstTransactionMutation, firstAliasMutation])
  await Promise.all([transactionWriter.query('rollback'), aliasWriter.query('rollback')])
  await removeGate('category_reconciliation_runs')

  assert.deepEqual(
    (await control.query(`select source_state_digest from public.category_reconciliation_runs where run_id=$1`, [first.run_id])).rows[0],
    { source_state_digest: approved.source_state_digest }
  )
  assert.equal((await control.query(`select count(*)::int n from public.category_reconciliation_replay_evidence`)).rows[0].n, 0)
  assert.deepEqual((await control.query(`select * from private.category_reconciliation_mismatch_report_v1($1)`, [first.run_id])).rows, [])

  // REPLAY: pause after all replay checks at receipt insertion. The same two
  // ordinary mutations must remain blocked until the replay receipt commits.
  await installGate('category_reconciliation_replay_evidence', 5002)
  await gate.query('begin')
  await gate.query(`select pg_advisory_xact_lock(197,5002)`)
  await reconciler.query('begin')
  const replayQuery = reconciler.query(reconcileSql, approvedArgs)
  await waitUntilBlocked(reconcilerPid, 'replay evidence gate')
  await assertSourceShareLocks(reconcilerPid)

  await transactionWriter.query('begin')
  const replayTransactionMutation = transactionWriter.query(
    `update public.transactions set deleted_at=now() where id=$1`, [txId]
  )
  await aliasWriter.query('begin')
  const replayAliasMutation = aliasWriter.query(
    `select * from private.register_category_alias_v1($1,$2,null)`,
    [fixture.ordinaryId, fixture.unknownName]
  )
  await waitUntilBlocked(transactionWriterPid, 'replay transaction writer')
  await waitUntilBlocked(aliasWriterPid, 'replay alias writer')
  await gate.query('commit')
  const replay = (await replayQuery).rows[0].result
  assert.equal(replay.replayed, true)
  assert.equal(replay.run_id, first.run_id)
  await waitUntilBlocked(transactionWriterPid, 'transaction writer through replay receipt')
  await waitUntilBlocked(aliasWriterPid, 'alias writer through replay receipt')
  await reconciler.query('commit')
  await Promise.all([replayTransactionMutation, replayAliasMutation])
  await Promise.all([transactionWriter.query('rollback'), aliasWriter.query('rollback')])
  await removeGate('category_reconciliation_replay_evidence')

  assert.equal((await control.query(
    `select count(*)::int n from public.category_reconciliation_replay_evidence where run_id=$1`,
    [first.run_id]
  )).rows[0].n, 1)
  assert.equal((await control.query(
    `select count(*)::int n from public.category_aliases where state='compatibility_active'`
  )).rows[0].n, 0)
  assert.equal((await control.query(`select deleted_at from public.transactions where id=$1`, [txId])).rows[0].deleted_at, null)
  assert.deepEqual((await control.query(`select * from private.category_reconciliation_mismatch_report_v1($1)`, [first.run_id])).rows, [])

  console.log('SHR-197 concurrency: 7/7 source-lock, replay-lock, alias-digest, stale, ambiguity and no-invalid-receipt scenarios passed.')
} finally {
  await Promise.all(clients.map((client) => client.end().catch(() => {})))
  await dropDatabase()
}
