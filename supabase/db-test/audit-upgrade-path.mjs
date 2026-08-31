// Applies 045 over an exact through-044 database, then applies it again.
// This is deliberately a separate scratch database so the normal fresh-path
// suite and its concurrent transaction tests remain isolated.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import pg from 'pg'

const { Client } = pg
const here = dirname(fileURLToPath(import.meta.url))
const setupPath = join(here, 'setup-db.mjs')
const migrationPath = join(here, '..', 'schema', '045_immutable_audit_substrate.sql')
const adminUrl =
  process.env.DATABASE_URL || 'postgres://postgres:postgres@127.0.0.1:5432/postgres'
const upgradeDbName = 'our_money_shr191_upgrade_test'

function withDatabase(url, database) {
  const parsed = new URL(url)
  parsed.pathname = `/${database}`
  return parsed.toString()
}

async function dropUpgradeDatabase() {
  assert.match(upgradeDbName, /^our_money_shr191_upgrade_test$/)
  const admin = new Client({ connectionString: adminUrl })
  await admin.connect()
  try {
    await admin.query(
      `select pg_terminate_backend(pid) from pg_stat_activity
       where datname = $1 and pid <> pg_backend_pid()`,
      [upgradeDbName]
    )
    await admin.query(`drop database if exists ${admin.escapeIdentifier(upgradeDbName)}`)
  } finally {
    await admin.end()
  }
}

const setup = spawnSync(process.execPath, [setupPath], {
  env: {
    ...process.env,
    TEST_DB_NAME: upgradeDbName,
    SCHEMA_MAX_NUMBER: '44',
  },
  encoding: 'utf8',
})
if (setup.stdout) process.stdout.write(setup.stdout)
if (setup.stderr) process.stderr.write(setup.stderr)
if (setup.status !== 0) process.exit(setup.status ?? 1)

const client = new Client({ connectionString: withDatabase(adminUrl, upgradeDbName) })
try {
  await client.connect()

  const account = await client.query(
    `insert into public.accounts(name, owner, type)
     values('SHR-191 upgrade marker', 'Shrey', 'cash') returning id`
  )
  const transaction = await client.query(
    `insert into public.transactions(date, amount, account_id, category, note)
     values('2026-08-30', 19.1, $1, 'Groceries', 'SHR-191 upgrade marker')
     returning id`,
    [account.rows[0].id]
  )
  const before = await client.query(
    `select ctid, to_jsonb(t) as row from public.transactions t where id = $1`,
    [transaction.rows[0].id]
  )

  const migration = readFileSync(migrationPath, 'utf8')
  await client.query(migration)

  const after = await client.query(
    `select ctid, to_jsonb(t) as row from public.transactions t where id = $1`,
    [transaction.rows[0].id]
  )
  assert.deepEqual(after.rows[0].row, before.rows[0].row)
  assert.equal(after.rows[0].ctid, before.rows[0].ctid)
  assert.equal(
    await client
      .query(`select count(*)::integer as count from public.audit_events`)
      .then(({ rows }) => rows[0].count),
    0,
    'upgrade must not synthesize historical audit rows'
  )

  await client.query(migration)
  assert.equal(
    await client
      .query(`select count(*)::integer as count from public.audit_events`)
      .then(({ rows }) => rows[0].count),
    0,
    'restart/rerun must remain no-backfill'
  )

  await client.query('begin')
  await client.query('set local role service_role')
  const appended = await client.query(`
    select * from public.record_audit_qa_fixture_v1(
      'service', null, null, 'qa.audit_fixture_runner', null, 'edge',
      'audit.qa_fixture.recorded',
      '10000000-0000-0000-0000-000000000045',
      '20000000-0000-0000-0000-000000000045',
      '30000000-0000-0000-0000-000000000045',
      '40000000-0000-0000-0000-000000000045',
      null,
      'sha256:4545454545454545454545454545454545454545454545454545454545454545'
    )
  `)
  assert.equal(appended.rows[0].replayed, false)
  await client.query('rollback')

  console.log('SHR-191 through-044 upgrade and restart paths passed.')
} finally {
  await client.end().catch(() => {})
  await dropUpgradeDatabase()
}
