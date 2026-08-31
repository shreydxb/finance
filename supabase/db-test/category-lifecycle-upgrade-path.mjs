// Applies 045 and then 046 over an exact through-044 database — the state
// production is actually in — and then applies 046 a second time.
//
// The fresh-path suite proves the guards. This proves the thing a migration
// review really has to know: that arriving here from the current production
// shape changes no existing category row, seeds no system code, fabricates no
// history, and is safe to re-run. It uses its own scratch database so the
// concurrent transaction tests in the main suite stay isolated.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import pg from 'pg'

const { Client } = pg
const here = dirname(fileURLToPath(import.meta.url))
const setupPath = join(here, 'setup-db.mjs')
const schemaDir = join(here, '..', 'schema')
const auditMigration = readFileSync(join(schemaDir, '045_immutable_audit_substrate.sql'), 'utf8')
const categoryMigration = readFileSync(
  join(schemaDir, '046_category_lifecycle_protection.sql'),
  'utf8'
)
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
  env: { ...process.env, TEST_DB_NAME: upgradeDbName, SCHEMA_MAX_NUMBER: '44' },
  encoding: 'utf8',
})
if (setup.stdout) process.stdout.write(setup.stdout)
if (setup.stderr) process.stderr.write(setup.stderr)
if (setup.status !== 0) process.exit(setup.status ?? 1)

const client = new Client({ connectionString: withDatabase(adminUrl, upgradeDbName) })

/**
 * The pre-SHR-196 columns only, so the comparison stays meaningful after 046.
 *
 * ctid is deliberately excluded here and asserted on transactions instead. 046
 * seeds updated_at from each row's own created_at, and that one backfill writes
 * a new MVCC tuple version for every category — a physical rewrite, not a
 * logical change. What must hold is that every value a consumer can observe is
 * identical, which is exactly what this projection compares.
 */
const CATEGORY_IDENTITY = `
  select
    c.id, c.name, c."group", c.icon, c.created_at
  from public.categories c
  order by c.id
`

try {
  await client.connect()

  assert.equal(
    await client
      .query(
        `select count(*)::integer as count from information_schema.columns
         where table_schema = 'public' and table_name = 'categories'
           and column_name in ('system_code', 'archived_at', 'updated_at')`
      )
      .then(({ rows }) => rows[0].count),
    0,
    'the through-044 fixture must not already carry SHR-196 columns'
  )

  // Production-shaped references that a careless migration could disturb.
  const budgetCategory = await client.query(
    `select id from public.categories where name = 'Groceries'`
  )
  await client.query(
    `insert into public.budgets (category_id, monthly_limit, "group") values ($1, 2500, 'Flexible')`,
    [budgetCategory.rows[0].id]
  )
  await client.query(
    `insert into public.category_rules (pattern, category) values ('carrefour', 'Groceries')`
  )
  const account = await client.query(
    `insert into public.accounts(name, owner, type)
     values('SHR-196 upgrade marker', 'Shrey', 'cash') returning id`
  )
  const transaction = await client.query(
    `insert into public.transactions(date, amount, account_id, category, note)
     values('2026-08-30', 41.5, $1, 'Transfer', 'SHR-196 upgrade marker') returning id`,
    [account.rows[0].id]
  )

  const before = {
    categories: (await client.query(CATEGORY_IDENTITY)).rows,
    transaction: (
      await client.query(`select ctid::text as ctid, to_jsonb(t) as row from public.transactions t where id = $1`, [
        transaction.rows[0].id,
      ])
    ).rows,
    budgets: (await client.query(`select to_jsonb(b) as row from public.budgets b order by b.id`)).rows,
    rules: (
      await client.query(`select to_jsonb(r) as row from public.category_rules r order by r.id`)
    ).rows,
  }
  assert.ok(before.categories.length > 0, 'the fixture must carry the seeded taxonomy')

  await client.query(auditMigration)
  await client.query(categoryMigration)

  async function assertUpgradeInvariants(stage) {
    const after = (await client.query(CATEGORY_IDENTITY)).rows
    assert.deepEqual(
      after,
      before.categories,
      `${stage}: category ids, names, groups, icons and created_at must be unchanged`
    )

    const lifecycle = await client.query(`
      select
        count(*)::integer as categories,
        count(system_code)::integer as coded,
        count(archived_at)::integer as archived,
        count(*) filter (where updated_at <> created_at)::integer as restamped
      from public.categories
    `)
    assert.equal(lifecycle.rows[0].categories, before.categories.length, `${stage}: no category added or lost`)
    assert.equal(lifecycle.rows[0].coded, 0, `${stage}: no system code may be seeded`)
    assert.equal(lifecycle.rows[0].archived, 0, `${stage}: nothing may be archived`)
    assert.equal(lifecycle.rows[0].restamped, 0, `${stage}: updated_at must stay equal to created_at`)

    const evidence = await client.query(`
      select
        (select count(*)::integer from public.category_name_history) as history_rows,
        (select count(*)::integer from public.category_aliases) as alias_rows,
        (select count(*)::integer from public.audit_events) as audit_rows
    `)
    assert.equal(evidence.rows[0].history_rows, 0, `${stage}: no rename history may be synthesized`)
    assert.equal(evidence.rows[0].alias_rows, 0, `${stage}: no alias may be pre-registered`)
    assert.equal(evidence.rows[0].audit_rows, 0, `${stage}: no audit evidence may be fabricated`)

    // Consumers of category text are untouched, including the legacy Transfer
    // row this package deliberately does not reinterpret.
    assert.deepEqual(
      (
        await client.query(
          `select ctid::text as ctid, to_jsonb(t) as row from public.transactions t where id = $1`,
          [transaction.rows[0].id]
        )
      ).rows,
      before.transaction,
      `${stage}: transactions must be byte-identical`
    )
    assert.deepEqual(
      (await client.query(`select to_jsonb(b) as row from public.budgets b order by b.id`)).rows,
      before.budgets,
      `${stage}: budgets must be unchanged`
    )
    assert.deepEqual(
      (await client.query(`select to_jsonb(r) as row from public.category_rules r order by r.id`)).rows,
      before.rules,
      `${stage}: category rules must be unchanged`
    )
  }

  await assertUpgradeInvariants('through-044 upgrade')

  // Restart/rerun: forward-only re-application must be a no-op.
  await client.query(categoryMigration)
  await assertUpgradeInvariants('046 rerun')

  // And the guards are live on the upgraded database, not only on a fresh one.
  // Each probe runs in its own aborted transaction so nothing persists.
  async function refuses(role, sql, expected) {
    await client.query('begin')
    try {
      if (role) {
        await client.query(`set local role ${role}`)
        if (role === 'authenticated') {
          await client.query(`select set_config('request.jwt.claim.sub', $1, true)`, [
            '00000000-0000-0000-0000-000000000001',
          ])
        }
      }
      await assert.rejects(client.query(sql), expected, `${role ?? 'operator'}: ${sql}`)
    } finally {
      await client.query('rollback')
    }
  }

  for (const role of ['authenticated', 'service_role', null]) {
    // Rename is fail-closed for the application, the service path and the
    // database owner's ordinary DML alike.
    await refuses(
      role,
      `update public.categories set name = 'Renamed' where name = 'Other'`,
      /SHR196_CATEGORY_RENAME_NOT_ENABLED/
    )
    // ...as are archive and reactivation, with no eligibility predicate
    // consulted for either.
    await refuses(
      role,
      `update public.categories set archived_at = now() where name = 'Other'`,
      /SHR196_CATEGORY_ARCHIVE_NOT_ENABLED/
    )
    await refuses(
      role,
      `delete from public.categories where name = 'Other'`,
      /SHR196_CATEGORY_DELETE_FORBIDDEN/
    )
  }

  await refuses(
    'authenticated',
    `update public.categories set system_code = 'transfer' where name = 'Transfer'`,
    /SHR196_SYSTEM_CODE_ASSIGNMENT_FORBIDDEN/
  )

  // Reactivation needs an archived row, which only the restore INSERT can
  // produce — and that row is then just as frozen as every other.
  await client.query('begin')
  try {
    const restored = await client.query(
      `insert into public.categories (name, "group", archived_at)
       values ('SHR-196 upgrade archived marker', 'Wants', now()) returning id`
    )
    await assert.rejects(
      client.query(`update public.categories set archived_at = null where id = $1`, [
        restored.rows[0].id,
      ]),
      /SHR196_CATEGORY_REACTIVATION_NOT_ENABLED/
    )
  } finally {
    await client.query('rollback')
  }

  // The presentation edits the contract still approves keep working.
  await client.query('begin')
  try {
    await client.query('set local role authenticated')
    await client.query(`select set_config('request.jwt.claim.sub', $1, true)`, [
      '00000000-0000-0000-0000-000000000001',
    ])
    const edited = await client.query(
      `update public.categories set icon = '🧾' where name = 'Other' returning name, icon`
    )
    assert.equal(edited.rows[0].name, 'Other')
    assert.equal(edited.rows[0].icon, '🧾')
  } finally {
    await client.query('rollback')
  }

  console.log('SHR-196 through-044 → 045 → 046 upgrade and restart paths passed.')
} finally {
  await client.end().catch(() => {})
  await dropUpgradeDatabase()
}
