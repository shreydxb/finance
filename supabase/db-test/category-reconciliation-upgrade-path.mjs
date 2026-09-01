// SHR-197 production-shaped upgrade/restart proof:
// through-049 -> 050 -> 050 again, then a committed controlled manifest ->
// 050 again -> exact manifest replay. No production connection is used.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import pg from 'pg'

const { Client } = pg
const here = dirname(fileURLToPath(import.meta.url))
const setupPath = join(here, 'setup-db.mjs')
const migration = readFileSync(
  join(here, '..', 'schema', '050_category_stable_reference_reconciliation.sql'),
  'utf8'
)
const adminUrl = process.env.DATABASE_URL || 'postgres://postgres:postgres@127.0.0.1:5432/postgres'
const dbName = 'our_money_shr197_upgrade_test'

function dbUrl(url, database) {
  const parsed = new URL(url)
  parsed.pathname = `/${database}`
  return parsed.toString()
}

async function dropDatabase() {
  assert.equal(dbName, 'our_money_shr197_upgrade_test')
  const admin = new Client({ connectionString: adminUrl })
  await admin.connect()
  try {
    await admin.query(`select pg_terminate_backend(pid) from pg_stat_activity where datname=$1 and pid<>pg_backend_pid()`, [dbName])
    await admin.query(`drop database if exists ${admin.escapeIdentifier(dbName)}`)
  } finally {
    await admin.end()
  }
}

const setup = spawnSync(process.execPath, [setupPath], {
  env: { ...process.env, TEST_DB_NAME: dbName, SCHEMA_MAX_NUMBER: '49' },
  encoding: 'utf8',
})
if (setup.stdout) process.stdout.write(setup.stdout)
if (setup.stderr) process.stderr.write(setup.stderr)
if (setup.status !== 0) process.exit(setup.status ?? 1)

const client = new Client({ connectionString: dbUrl(adminUrl, dbName) })

async function rows(table, excludeCategoryId = false) {
  const projection = excludeCategoryId ? `to_jsonb(t)-'category_id'` : 'to_jsonb(t)'
  return (await client.query(`select ctid::text as ctid, ${projection} as row from public.${table} t order by ctid`)).rows
}

async function policies(existingOnly = true) {
  const where = existingOnly
    ? `and tablename not like 'category_reconciliation_%'`
    : ''
  return (await client.query(`select schemaname,tablename,policyname,permissive,roles::text,cmd,
      coalesce(qual,'') qual,coalesce(with_check,'') with_check
    from pg_policies where schemaname='public' ${where} order by tablename,policyname`)).rows
}

async function canonical() {
  return (await client.query(`select
    (select jsonb_agg(to_jsonb(v) order by id) from public.v_canonical_ledger_aed v) ledger,
    (select to_jsonb(x) from public.canonical_period_metrics('2026-01-01','2026-12-31','household') x) period,
    (select to_jsonb(x) from public.canonical_balance_sheet('household') x) balance`)).rows[0]
}

try {
  await client.connect()
  const { rows: account } = await client.query(`insert into public.accounts(name,owner,type,value)
    values('SHR197 upgrade account','Fixture','cash',100) returning id`)
  const { rows: categories } = await client.query(`insert into public.categories(name,"group") values
    ('SHR197 Upgrade Transfer','Wants'),
    ('SHR197 Upgrade Savings','Savings'),
    ('SHR197 Upgrade Ordinary','Wants') returning id,name`)
  const byName = Object.fromEntries(categories.map((row) => [row.name, row.id]))
  await client.query(`insert into public.transactions(date,amount,account_id,category,deleted_at) values
    ('2026-08-01',10,$1,'SHR197 Upgrade Transfer',null),
    ('2026-08-02',20,$1,'SHR197 Upgrade Savings','2026-08-03'),
    ('2026-08-04',30,$1,'SHR197 Upgrade Ordinary',null),
    ('2026-08-05',40,$1,'SHR197 Upgrade Unknown',null),
    ('2026-08-06',50,$1,null,null)`, [account[0].id])
  await client.query(`insert into public.category_rules(pattern,category)
    values('upgrade ordinary','SHR197 Upgrade Ordinary')`)

  const before = {
    categories: await rows('categories'),
    transactions: await rows('transactions'),
    rules: await rows('category_rules'),
    policies: await policies(),
    canonical: await canonical(),
  }

  await client.query(migration)

  assert.deepEqual(await rows('categories'), before.categories)
  assert.deepEqual(await rows('transactions', true), before.transactions)
  assert.deepEqual(await rows('category_rules', true), before.rules)
  assert.deepEqual(await policies(), before.policies, 'existing RLS policies stay byte-identical')
  assert.deepEqual(await canonical(), before.canonical, 'V1 canonical output stays byte-identical')

  const inert = (await client.query(`select
    (select count(*)::int from public.categories where system_code is not null) codes,
    (select count(*)::int from public.transactions where category_id is not null) tx_refs,
    (select count(*)::int from public.category_rules where category_id is not null) rule_refs,
    (select count(*)::int from public.category_reconciliation_runs) runs`)).rows[0]
  assert.deepEqual(inert, { codes: 0, tx_refs: 0, rule_refs: 0, runs: 0 })

  const columnsAfterFirst = (await client.query(`select table_name,column_name,data_type,is_nullable
    from information_schema.columns where table_schema='public' order by table_name,ordinal_position`)).rows
  const policiesAfterFirst = await policies(false)
  await client.query(migration)
  assert.deepEqual((await client.query(`select table_name,column_name,data_type,is_nullable
    from information_schema.columns where table_schema='public' order by table_name,ordinal_position`)).rows, columnsAfterFirst)
  assert.deepEqual(await policies(false), policiesAfterFirst)
  assert.deepEqual((await client.query(`select count(*)::int n from public.category_reconciliation_runs`)).rows[0], { n: 0 })

  const pre = (await client.query(`select * from private.category_reconciliation_preflight_v1()`)).rows[0]
  const system = [
    { system_code: 'transfer', category_id: byName['SHR197 Upgrade Transfer'] },
    { system_code: 'savings_investment', category_id: byName['SHR197 Upgrade Savings'] },
  ]
  const classifications = [
    { legacy_label: 'SHR197 Upgrade Ordinary', resolution: 'mapped', category_id: byName['SHR197 Upgrade Ordinary'] },
    { legacy_label: 'SHR197 Upgrade Savings', resolution: 'mapped', category_id: byName['SHR197 Upgrade Savings'] },
    { legacy_label: 'SHR197 Upgrade Transfer', resolution: 'mapped', category_id: byName['SHR197 Upgrade Transfer'] },
    { legacy_label: 'SHR197 Upgrade Unknown', resolution: 'unresolved_unknown' },
  ]
  const args = [
    'SHR197-upgrade-controlled-manifest', pre.source_state_digest, pre.category_count,
    pre.transaction_count, pre.category_rule_count, pre.null_transaction_category_count,
    pre.soft_deleted_transaction_count, pre.distinct_legacy_label_count,
    pre.unknown_label_count, pre.reconciliation_run_count,
    JSON.stringify(system), JSON.stringify(classifications), null,
  ]
  const sql = `select private.reconcile_category_references_v1(
    $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb,$13) result`
  const first = (await client.query(sql, args)).rows[0].result
  assert.equal(first.replayed, false)
  const committed = (await client.query(`select
    (select count(*)::int from public.category_reconciliation_runs) runs,
    (select count(*)::int from public.category_reconciliation_row_evidence) evidence,
    (select count(*)::int from public.transactions where category_id is not null) tx_refs,
    (select count(*)::int from public.transactions where category is null and category_id is null) nulls`)).rows[0]

  await client.query(migration)
  assert.deepEqual((await client.query(`select
    (select count(*)::int from public.category_reconciliation_runs) runs,
    (select count(*)::int from public.category_reconciliation_row_evidence) evidence,
    (select count(*)::int from public.transactions where category_id is not null) tx_refs,
    (select count(*)::int from public.transactions where category is null and category_id is null) nulls`)).rows[0], committed)

  const replay = (await client.query(sql, args)).rows[0].result
  assert.equal(replay.replayed, true)
  assert.equal(replay.run_id, first.run_id)
  assert.match(replay.replay_id, /^[0-9a-f-]{36}$/)
  assert.equal((await client.query(`select count(*)::int n from public.category_reconciliation_replay_evidence where run_id=$1`, [first.run_id])).rows[0].n, 1)
  assert.deepEqual((await client.query(`select * from private.category_reconciliation_mismatch_report_v1($1)`, [first.run_id])).rows, [])
  assert.deepEqual(await canonical(), before.canonical)

  console.log('SHR-197 through-049 upgrade, rerun, committed restart and replay path passed.')
} finally {
  await client.end().catch(() => {})
  await dropDatabase()
}
