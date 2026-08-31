// Applies 046 over an exact through-045 database, then applies it again.
// Existing categories, budgets, rules, transactions, and V1 classification
// are compared before/after so the foundation cannot silently cut over a
// consumer or reclassify current data.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import pg from 'pg'

const { Client } = pg
const here = dirname(fileURLToPath(import.meta.url))
const setupPath = join(here, 'setup-db.mjs')
const migrationPath = join(here, '..', 'schema', '046_category_lifecycle_foundation.sql')
const adminUrl =
  process.env.DATABASE_URL || 'postgres://postgres:postgres@127.0.0.1:5432/postgres'
const upgradeDbName = 'our_money_shr196_upgrade_test'

function withDatabase(url, database) {
  const parsed = new URL(url)
  parsed.pathname = `/${database}`
  return parsed.toString()
}

async function dropUpgradeDatabase() {
  assert.match(upgradeDbName, /^our_money_shr196_upgrade_test$/)
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
    SCHEMA_MAX_NUMBER: '45',
  },
  encoding: 'utf8',
})
if (setup.stdout) process.stdout.write(setup.stdout)
if (setup.stderr) process.stderr.write(setup.stderr)
if (setup.status !== 0) process.exit(setup.status ?? 1)

const client = new Client({ connectionString: withDatabase(adminUrl, upgradeDbName) })
try {
  await client.connect()

  const category = await client.query(
    `insert into public.categories(name, "group", icon, created_at)
     values('SHR-196 upgrade marker', 'Needs', 'marker', '2026-08-30T09:00:00Z')
     returning id`
  )
  const account = await client.query(
    `insert into public.accounts(name, owner, type)
     values('SHR-196 upgrade account', 'Shrey', 'cash') returning id`
  )
  const transaction = await client.query(
    `insert into public.transactions(date, amount, account_id, category, note)
     values('2026-08-30', 19.6, $1, 'SHR-196 upgrade marker', 'SHR-196 upgrade marker')
     returning id`,
    [account.rows[0].id]
  )
  const budget = await client.query(
    `insert into public.budgets(category_id, monthly_limit, "group")
     values($1, 196, 'Fixed') returning id`,
    [category.rows[0].id]
  )
  const rule = await client.query(
    `insert into public.category_rules(pattern, category)
     values('shr196-upgrade', 'SHR-196 upgrade marker') returning id`
  )

  const before = await client.query(
    `select ctid, jsonb_build_object(
       'id', id, 'name', name, 'group', "group", 'icon', icon, 'created_at', created_at
     ) as legacy_row
     from public.categories where id = $1`,
    [category.rows[0].id]
  )
  const categoryDigestBefore = await client.query(`
    select jsonb_agg(jsonb_build_object(
      'id', id, 'name', name, 'group', "group", 'icon', icon, 'created_at', created_at
    ) order by id) as rows
    from public.categories
  `)
  const dependentBefore = await client.query(
    `select
      (select to_jsonb(t) from public.transactions t where id = $1) as transaction,
      (select to_jsonb(b) from public.budgets b where id = $2) as budget,
      (select to_jsonb(r) from public.category_rules r where id = $3) as rule,
      (select to_jsonb(l) from public.v_canonical_ledger_aed l where id = $1) as classification`,
    [transaction.rows[0].id, budget.rows[0].id, rule.rows[0].id]
  )

  const migration = readFileSync(migrationPath, 'utf8')
  await client.query(migration)

  const after = await client.query(
    `select ctid, system_code, archived_at, updated_at, jsonb_build_object(
       'id', id, 'name', name, 'group', "group", 'icon', icon, 'created_at', created_at
     ) as legacy_row
     from public.categories where id = $1`,
    [category.rows[0].id]
  )
  assert.deepEqual(after.rows[0].legacy_row, before.rows[0].legacy_row)
  assert.equal(after.rows[0].ctid, before.rows[0].ctid, 'additive columns must not rewrite the category tuple')
  assert.equal(after.rows[0].system_code, null)
  assert.equal(after.rows[0].archived_at, null)
  assert.ok(after.rows[0].updated_at)

  const categoryDigestAfter = await client.query(`
    select jsonb_agg(jsonb_build_object(
      'id', id, 'name', name, 'group', "group", 'icon', icon, 'created_at', created_at
    ) order by id) as rows
    from public.categories
  `)
  assert.deepEqual(categoryDigestAfter.rows[0].rows, categoryDigestBefore.rows[0].rows)
  assert.equal(
    await client.query('select count(*)::integer as count from public.categories where system_code is not null')
      .then(({ rows }) => rows[0].count),
    0,
    'upgrade must assign no system code'
  )
  assert.equal(
    await client.query('select count(*)::integer as count from public.category_name_history')
      .then(({ rows }) => rows[0].count),
    0,
    'upgrade must synthesize no rename history'
  )
  assert.equal(
    await client.query('select count(*)::integer as count from public.category_aliases')
      .then(({ rows }) => rows[0].count),
    0,
    'upgrade must synthesize no aliases'
  )

  const dependentAfter = await client.query(
    `select
      (select to_jsonb(t) from public.transactions t where id = $1) as transaction,
      (select to_jsonb(b) from public.budgets b where id = $2) as budget,
      (select to_jsonb(r) from public.category_rules r where id = $3) as rule,
      (select to_jsonb(l) from public.v_canonical_ledger_aed l where id = $1) as classification`,
    [transaction.rows[0].id, budget.rows[0].id, rule.rows[0].id]
  )
  assert.deepEqual(dependentAfter.rows[0], dependentBefore.rows[0])

  await client.query(migration)
  const afterRerun = await client.query(
    `select ctid, system_code, archived_at, jsonb_build_object(
       'id', id, 'name', name, 'group', "group", 'icon', icon, 'created_at', created_at
     ) as legacy_row
     from public.categories where id = $1`,
    [category.rows[0].id]
  )
  assert.deepEqual(afterRerun.rows[0].legacy_row, before.rows[0].legacy_row)
  assert.equal(afterRerun.rows[0].ctid, before.rows[0].ctid)
  assert.equal(afterRerun.rows[0].system_code, null)
  assert.equal(afterRerun.rows[0].archived_at, null)

  await client.query('update public.categories set system_code = $1 where id = $2', [
    'transfer', category.rows[0].id,
  ])
  await client.query(migration)
  assert.equal(
    await client.query('select system_code from public.categories where id = $1', [category.rows[0].id])
      .then(({ rows }) => rows[0].system_code),
    'transfer',
    'migration rerun must preserve a future reviewed assignment'
  )

  console.log('SHR-196 through-045 upgrade, compatibility, and restart paths passed.')
} finally {
  await client.end().catch(() => {})
  await dropUpgradeDatabase()
}
