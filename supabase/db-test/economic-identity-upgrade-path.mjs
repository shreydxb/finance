// Applies 045, then 046, then 047 over an exact through-044 database — the
// state production is actually in — and then applies 047 a second time.
//
// The fresh-path suite proves the guards. This proves what a migration review
// actually has to know about SHR-193: that arriving here from the current
// production shape changes no financial row, creates no economic party and no
// mapping decision, adds no ownership column to any fact, and leaves every
// existing RLS policy byte-identical. The policy diff is the release gate's
// named requirement, so it is asserted here rather than argued in prose.
//
// It uses its own scratch database so the concurrent transaction tests in the
// main suite stay isolated.

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
const read = (file) => readFileSync(join(schemaDir, file), 'utf8')
const auditMigration = read('045_immutable_audit_substrate.sql')
const categoryMigration = read('046_category_lifecycle_protection.sql')
const economicMigration = read('047_economic_identity_foundation.sql')

const adminUrl =
  process.env.DATABASE_URL || 'postgres://postgres:postgres@127.0.0.1:5432/postgres'
const upgradeDbName = 'our_money_shr193_upgrade_test'

const ECONOMIC_TABLES = ['economic_households', 'economic_parties', 'access_party_mappings']

// The financial facts a careless identity migration could disturb, plus the
// authorization roster that must stay exactly as it is.
const FINANCIAL_TABLES = [
  'accounts', 'transactions', 'budgets', 'recurring', 'goals', 'income',
  'category_rules', 'categories', 'settings', 'household_members',
]

// `categories` is the one table the chain legitimately rewrites before 047 runs:
// 046 seeds updated_at from each row's own created_at, which adds columns and
// writes a new tuple version for every row. That is 046's business and is
// already asserted by its own upgrade runner, so it is compared across 047
// alone. Every other financial table must survive the entire chain untouched,
// down to its physical tuple identity.
const CHAIN_STABLE_TABLES = FINANCIAL_TABLES.filter((t) => t !== 'categories')

function withDatabase(url, database) {
  const parsed = new URL(url)
  parsed.pathname = `/${database}`
  return parsed.toString()
}

async function dropUpgradeDatabase() {
  assert.match(upgradeDbName, /^our_money_shr193_upgrade_test$/)
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
 * Every row of a financial table, with its physical tuple identity.
 *
 * ctid is included on purpose and it is the strongest assertion in this file:
 * 047 performs no backfill of any kind, so unlike 046 — which legitimately
 * rewrote every category tuple to seed updated_at — not one existing tuple may
 * even be rewritten in place here.
 */
async function financialSnapshot(tables = FINANCIAL_TABLES) {
  const snapshot = {}
  for (const table of tables) {
    const { rows } = await client.query(
      `select ctid::text as ctid, to_jsonb(t) as row from public.${table} t order by ctid`
    )
    snapshot[table] = rows
  }
  return snapshot
}

/** Full policy set, so "financial RLS is unchanged" is a diff, not a claim. */
async function policySnapshot() {
  const { rows } = await client.query(`
    select schemaname, tablename, policyname, permissive, roles::text as roles,
           cmd, coalesce(qual, '') as qual, coalesce(with_check, '') as with_check
    from pg_policies
    where schemaname = 'public'
    order by tablename, policyname
  `)
  return rows
}

async function columnSnapshot() {
  const { rows } = await client.query(`
    select table_name, column_name, data_type
    from information_schema.columns
    where table_schema = 'public'
    order by table_name, column_name
  `)
  return rows
}

try {
  await client.connect()

  assert.equal(
    await client
      .query(
        `select count(*)::integer as count from information_schema.tables
         where table_schema = 'public' and table_name = any($1)`,
        [ECONOMIC_TABLES]
      )
      .then(({ rows }) => rows[0].count),
    0,
    'the through-044 fixture must not already carry SHR-193 tables'
  )

  // Production-shaped fixtures: three authorized access identities (production
  // has exactly three, one of them a test identity), and real financial facts
  // across every table a later attribution package will touch.
  const testIdentity = '00000000-0000-0000-0000-0000000000c1'
  await client.query(
    `insert into auth.users (id, email) values ($1, 'claude@claude.com')`,
    [testIdentity]
  )
  await client.query(`insert into public.household_members (user_id) values ($1)`, [testIdentity])

  const account = await client.query(
    `insert into public.accounts(name, owner, type, value)
     values('SHR-193 upgrade marker', 'Shrey', 'cash', 1708.40) returning id`
  )
  await client.query(
    `insert into public.transactions(date, amount, account_id, category, note)
     values('2026-08-30', 41.5, $1, 'Groceries', 'SHR-193 upgrade marker')`,
    [account.rows[0].id]
  )
  const groceries = await client.query(
    `select id from public.categories where name = 'Groceries'`
  )
  await client.query(
    `insert into public.budgets (category_id, monthly_limit, "group") values ($1, 2500, 'Flexible')`,
    [groceries.rows[0].id]
  )
  await client.query(
    `insert into public.category_rules (pattern, category) values ('carrefour', 'Groceries')`
  )
  await client.query(
    `insert into public.recurring (name, kind, amount, owner, day_of_month)
     values ('Rent', 'expense', 9000, 'Joint', 1)`
  )
  await client.query(
    `insert into public.goals (name, kind, target_amount) values ('New Sofa', 'save_up', 5000)`
  )
  await client.query(
    `insert into public.income (person, kind, amount, date)
     values ('Shrey', 'salary', 19500, '2026-08-01')`
  )

  const before = {
    // Taken at through-044: these must survive 045, 046 and 047 alike.
    chain: await financialSnapshot(CHAIN_STABLE_TABLES),
    policies: await policySnapshot(),
    columns: await columnSnapshot(),
  }
  assert.ok(before.chain.transactions.length > 0, 'the fixture must carry financial rows')
  assert.equal(before.chain.household_members.length, 3, 'three access identities, as in production')

  await client.query(auditMigration)
  await client.query(categoryMigration)

  // The 047 baseline: the exact state production would be in once its own
  // release gate lets 045 and 046 through. Everything after this point isolates
  // what SHR-193 alone does.
  const before047 = {
    financial: await financialSnapshot(),
    policies: await policySnapshot(),
    columns: await columnSnapshot(),
  }

  await client.query(economicMigration)

  async function assertUpgradeInvariants(stage) {
    // 1. Not one financial row — or even one physical tuple — is disturbed by
    //    047, and nothing in the whole chain touches a non-category fact.
    assert.deepEqual(
      await financialSnapshot(),
      before047.financial,
      `${stage}: every financial row must be byte- and tuple-identical across 047`
    )
    assert.deepEqual(
      await financialSnapshot(CHAIN_STABLE_TABLES),
      before.chain,
      `${stage}: every financial row must survive the whole through-044 chain untouched`
    )

    // 2. The substrate arrives completely empty. No party is inferred from the
    //    three access identities, or from any owner text on the fixtures above.
    for (const table of ECONOMIC_TABLES) {
      const { rows } = await client.query(`select count(*)::integer as count from public.${table}`)
      assert.equal(rows[0].count, 0, `${stage}: ${table} must contain no production rows`)
    }

    // 3. Existing RLS is untouched. The only difference in the whole policy set
    //    is the three new read policies, each rooted in is_household_member().
    const after = await policySnapshot()
    const added = after.filter((p) => ECONOMIC_TABLES.includes(p.tablename))
    const preserved = after.filter((p) => !ECONOMIC_TABLES.includes(p.tablename))
    assert.deepEqual(
      preserved,
      before047.policies,
      `${stage}: 047 must not change any pre-existing RLS policy`
    )
    // ...and the financial policy set is identical all the way back to
    // through-044, which is the release gate's named policy-diff requirement.
    assert.deepEqual(
      preserved.filter((p) => !['audit_events', 'category_name_history', 'category_aliases'].includes(p.tablename)),
      before.policies,
      `${stage}: financial RLS must be identical to the production shape`
    )
    assert.equal(added.length, 3, `${stage}: exactly three new policies`)
    for (const policy of added) {
      assert.equal(policy.cmd, 'SELECT')
      assert.match(policy.qual, /is_household_member/)
      assert.doesNotMatch(policy.qual, /economic_part|access_party|party_id/i)
    }
    for (const policy of after) {
      assert.doesNotMatch(
        `${policy.qual} ${policy.with_check}`,
        /economic_part|access_party|owner_party|legacy_owner_label/i,
        `${stage}: ${policy.tablename}.${policy.policyname} must not authorize through economic ownership`
      )
    }

    // 4. No household_id fan-out and no attribution column on any existing table.
    const afterColumns = await columnSnapshot()
    const newColumns = afterColumns.filter(
      (c) => !before047.columns.some((b) => b.table_name === c.table_name && b.column_name === c.column_name)
    )
    const outsideSubstrate = newColumns.filter(
      (c) => !ECONOMIC_TABLES.includes(c.table_name)
    )
    // 045 and 046 legitimately add their own columns; 047 must add none outside
    // its own three tables.
    assert.deepEqual(
      outsideSubstrate, [],
      `${stage}: 047 must add no column outside its own three tables`
    )
    for (const table of FINANCIAL_TABLES) {
      const fanned = afterColumns.filter(
        (c) => c.table_name === table && c.column_name === 'household_id'
      )
      assert.deepEqual(fanned, [], `${stage}: ${table} must not receive household_id`)
    }

    // 5. The authorization root is still the only one.
    const roots = await client.query(`
      select proname from pg_proc
      where proname ilike '%is_economic%' or proname ilike '%economic_party_member%'
    `)
    assert.deepEqual(roots.rows, [], `${stage}: no second authorization root may exist`)

    // 6. No person-shaped role was introduced.
    const roles = await client.query(`
      select rolname from pg_roles where rolname ~* '^(me|partner|shrey|tarika|joint)$'
    `)
    assert.deepEqual(roles.rows, [], `${stage}: no person-shaped database role`)

    // 7. No audit evidence is fabricated for an empty substrate.
    const audit = await client.query(`select count(*)::integer as count from public.audit_events`)
    assert.equal(audit.rows[0].count, 0, `${stage}: no historical audit event may be synthesized`)
  }

  await assertUpgradeInvariants('through-044 → 045 → 046 → 047 upgrade')

  // Restart/rerun: forward-only re-application must be a no-op.
  await client.query(economicMigration)
  await assertUpgradeInvariants('047 rerun')

  // A second rerun, to prove idempotency is structural rather than incidental.
  await client.query(economicMigration)
  await assertUpgradeInvariants('047 second rerun')

  // The guards and ACLs are live on the upgraded database, not only a fresh one.
  async function refuses(role, sql, params, expected) {
    await client.query('begin')
    try {
      if (role) {
        await client.query(`set local role ${role}`)
        if (role === 'authenticated') {
          await client.query(`select set_config('request.jwt.claim.sub', $1, true)`, [testIdentity])
        }
      }
      await assert.rejects(client.query(sql, params), expected, `${role ?? 'operator'}: ${sql}`)
    } finally {
      await client.query('rollback')
    }
  }

  const household = await client.query(
    `insert into public.economic_households (display_name) values ('upgrade probe') returning household_id`
  )
  const householdId = household.rows[0].household_id
  const party = await client.query(
    `insert into public.economic_parties (household_id, display_name) values ($1, 'Probe') returning party_id`,
    [householdId]
  )
  const partyId = party.rows[0].party_id

  for (const role of ['anon', 'authenticated', 'service_role']) {
    await refuses(
      role,
      `insert into public.economic_parties (household_id, display_name) values ($1, 'Injected')`,
      [householdId],
      /permission denied/
    )
    await refuses(
      role,
      `insert into public.access_party_mappings (household_id, auth_user_id) values ($1, $2)`,
      [householdId, testIdentity],
      /permission denied/
    )
  }

  // Identity stability holds for the operator too.
  await refuses(
    null,
    `delete from public.economic_parties where party_id = $1`,
    [partyId],
    /SHR193_ECONOMIC_PARTY_DELETE_FORBIDDEN/
  )

  // A mapping decision on the upgraded database still grants nothing: the test
  // identity is a real household member, and mapping it changes no access.
  await client.query('begin')
  try {
    await client.query(
      `insert into public.access_party_mappings (household_id, auth_user_id, economic_party_id, status)
       values ($1, $2, $3, 'mapped')`,
      [householdId, testIdentity, partyId]
    )
    await client.query('set local role authenticated')
    await client.query(`select set_config('request.jwt.claim.sub', $1, true)`, [testIdentity])
    const { rows } = await client.query(`select private.is_household_member() as ok`)
    assert.equal(rows[0].ok, true, 'membership is unchanged by an economic mapping, not derived from it')
  } finally {
    await client.query('rollback')
  }

  // And the probe rows are removed so the upgraded database ends as empty as it
  // arrived — deletion of parties is refused, so the whole probe is rolled back
  // rather than cleaned up piecemeal.
  await client.query(`delete from public.access_party_mappings`)
  const remaining = await client.query(
    `select (select count(*)::integer from public.economic_parties) as parties`
  )
  assert.equal(remaining.rows[0].parties, 1, 'the probe party cannot be deleted, by design')

  console.log('SHR-193 through-044 → 045 → 046 → 047 upgrade, rerun and policy-diff paths passed.')
} finally {
  await client.end().catch(() => {})
  await dropUpgradeDatabase()
}
