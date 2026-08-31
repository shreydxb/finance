// Applies 045, 046, 047 and then 048 over an exact through-044 database — the
// state production is actually in — and then applies 048 twice more.
//
// The fresh-path suite proves the guards. This proves what a migration review
// actually has to know about SHR-194:
//
//   * arriving here from the current production shape changes no financial row,
//     not even its physical tuple, and creates no economic party, no mapping
//     decision and no audit event. Applying the migration is not the same act as
//     applying a manifest, and only the second one puts rows anywhere;
//   * every pre-existing RLS policy is byte-identical, which is the release
//     gate's named requirement and is asserted here rather than argued in prose;
//   * re-running the migration is a no-op, so a restart or a re-apply is safe.
//
// It then does what the fresh-path suite deliberately cannot, because that one
// shares a database with SHR-193's "the substrate is empty" assertions: it
// commits real decisions and proves the concurrency and cross-transaction
// replay behaviour against them.

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
const reconciliationMigration = read('048_access_party_reconciliation.sql')

const adminUrl =
  process.env.DATABASE_URL || 'postgres://postgres:postgres@127.0.0.1:5432/postgres'
const upgradeDbName = 'our_money_shr194_upgrade_test'

const SHR194_TABLES = ['access_party_mapping_history', 'access_party_reconciliation_runs']
const ECONOMIC_TABLES = ['economic_households', 'economic_parties', 'access_party_mappings']

const FINANCIAL_TABLES = [
  'accounts', 'transactions', 'budgets', 'recurring', 'goals', 'income',
  'category_rules', 'categories', 'settings', 'household_members',
]

function withDatabase(url, database) {
  const parsed = new URL(url)
  parsed.pathname = `/${database}`
  return parsed.toString()
}

async function dropUpgradeDatabase() {
  assert.match(upgradeDbName, /^our_money_shr194_upgrade_test$/)
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

const upgradeUrl = withDatabase(adminUrl, upgradeDbName)
const client = new Client({ connectionString: upgradeUrl })

/** Every row of a financial table, with its physical tuple identity. */
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

async function counts() {
  const { rows } = await client.query(`
    select
      (select count(*)::integer from public.economic_households) as households,
      (select count(*)::integer from public.economic_parties) as parties,
      (select count(*)::integer from public.access_party_mappings) as mappings,
      (select count(*)::integer from public.access_party_mapping_history) as history,
      (select count(*)::integer from public.access_party_reconciliation_runs) as runs,
      (select count(*)::integer from public.audit_events) as audit
  `)
  return rows[0]
}

try {
  await client.connect()

  assert.equal(
    await client
      .query(
        `select count(*)::integer as count from information_schema.tables
         where table_schema = 'public' and table_name = any($1)`,
        [SHR194_TABLES]
      )
      .then(({ rows }) => rows[0].count),
    0,
    'the through-044 fixture must not already carry SHR-194 tables'
  )

  // Production-shaped fixtures: three authorized access identities, exactly as
  // production has — two humans and one test identity — plus real financial
  // facts across every table a later attribution package will touch.
  const shrey = '00000000-0000-0000-0000-000000000001'
  const tarika = '00000000-0000-0000-0000-000000000002'
  const testIdentity = '00000000-0000-0000-0000-0000000000c1'
  await client.query(`insert into auth.users (id, email) values ($1, 'claude@claude.com')`, [
    testIdentity,
  ])
  await client.query(`insert into public.household_members (user_id) values ($1)`, [testIdentity])

  const account = await client.query(
    `insert into public.accounts(name, owner, type, value)
     values('SHR-194 upgrade marker', 'Shrey', 'cash', 1708.40) returning id`
  )
  await client.query(
    `insert into public.transactions(date, amount, account_id, category, note)
     values('2026-08-30', 41.5, $1, 'Groceries', 'SHR-194 upgrade marker')`,
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

  const throughO44 = {
    financial: await financialSnapshot(),
    policies: await policySnapshot(),
  }
  assert.equal(
    throughO44.financial.household_members.length,
    3,
    'three access identities, exactly as production has'
  )

  await client.query(auditMigration)
  await client.query(categoryMigration)
  await client.query(economicMigration)

  // The 048 baseline: the exact state production would be in once its own
  // release gate lets 045, 046 and 047 through. Everything after this point
  // isolates what SHR-194 alone does.
  const before = {
    financial: await financialSnapshot(),
    policies: await policySnapshot(),
    columns: await columnSnapshot(),
  }

  await client.query(reconciliationMigration)

  async function assertUpgradeInvariants(stage) {
    // 1. Not one financial row — or even one physical tuple — is disturbed by
    //    048, and nothing in the whole chain rewrites a non-category fact.
    assert.deepEqual(
      await financialSnapshot(),
      before.financial,
      `${stage}: every financial row must be byte- and tuple-identical across 048`
    )
    assert.deepEqual(
      await financialSnapshot(FINANCIAL_TABLES.filter((t) => t !== 'categories')),
      Object.fromEntries(
        Object.entries(throughO44.financial).filter(([table]) => table !== 'categories')
      ),
      `${stage}: every financial row must survive the whole through-044 chain untouched`
    )

    // 2. Applying the migration is not applying a manifest. It creates no
    //    household, no party, no decision, no history and no audit evidence —
    //    and infers nothing from the three access identities that exist.
    assert.deepEqual(
      await counts(),
      { households: 0, parties: 0, mappings: 0, history: 0, runs: 0, audit: 0 },
      `${stage}: 048 must create no economic or audit row of any kind`
    )

    // 3. Existing RLS is untouched. The only difference in the whole policy set
    //    is the two new ones on SHR-194's own tables.
    const after = await policySnapshot()
    const added = after.filter((p) => SHR194_TABLES.includes(p.tablename))
    const preserved = after.filter((p) => !SHR194_TABLES.includes(p.tablename))
    assert.deepEqual(
      preserved,
      before.policies,
      `${stage}: 048 must not change any pre-existing RLS policy`
    )
    // ...and the financial policy set is identical all the way back to
    // through-044, which is the release gate's named policy-diff requirement.
    const substrateTables = [
      ...ECONOMIC_TABLES, ...SHR194_TABLES,
      'audit_events', 'category_name_history', 'category_aliases',
    ]
    assert.deepEqual(
      preserved.filter((p) => !substrateTables.includes(p.tablename)),
      throughO44.policies,
      `${stage}: financial RLS must be identical to the production shape`
    )
    assert.equal(added.length, 2, `${stage}: exactly two new policies`)
    for (const policy of after) {
      assert.doesNotMatch(
        `${policy.qual} ${policy.with_check}`,
        /economic_part|access_party|owner_party|legacy_owner_label/i,
        `${stage}: ${policy.tablename}.${policy.policyname} must not authorize through economic identity`
      )
    }

    // 4. No household_id fan-out and no attribution column on any existing table.
    const afterColumns = await columnSnapshot()
    const newColumns = afterColumns.filter(
      (c) =>
        !before.columns.some(
          (b) => b.table_name === c.table_name && b.column_name === c.column_name
        )
    )
    assert.deepEqual(
      newColumns.filter((c) => !SHR194_TABLES.includes(c.table_name)),
      [],
      `${stage}: 048 must add no column outside its own two tables`
    )
    for (const table of FINANCIAL_TABLES) {
      assert.deepEqual(
        afterColumns.filter(
          (c) =>
            c.table_name === table &&
            (c.column_name === 'household_id' ||
              c.column_name.includes('party') ||
              c.column_name.includes('economic'))
        ),
        [],
        `${stage}: ${table} must receive no ownership or attribution column`
      )
    }

    // 5. The authorization root is still the only one, and no role was invented.
    assert.deepEqual(
      (
        await client.query(`
          select proname from pg_proc
          where proname ilike '%is_economic%' or proname ilike '%economic_party_member%'
        `)
      ).rows,
      [],
      `${stage}: no second authorization root may exist`
    )
    assert.deepEqual(
      (
        await client.query(`
          select rolname from pg_roles
          where rolname not like 'pg\\_%'
            and rolname not in ('postgres', 'anon', 'authenticated', 'service_role')
        `)
      ).rows,
      [],
      `${stage}: SHR-194 invents no role and no household RBAC`
    )

    // 6. The SHR-193 restore boundary is intact: same function, same trigger.
    const guard = await client.query(`
      select t.tgname, t.tgenabled from pg_trigger t
       where t.tgrelid = 'public.access_party_mappings'::regclass and not t.tgisinternal
       order by t.tgname
    `)
    assert.deepEqual(
      guard.rows,
      [
        { tgname: 'access_party_mappings_lifecycle_guard', tgenabled: 'O' },
        { tgname: 'access_party_mappings_no_truncate', tgenabled: 'O' },
      ],
      `${stage}: the SHR-193 lifecycle trigger must be neither disabled nor replaced`
    )
    assert.equal(
      (
        await client.query(`
          select count(*)::integer as count from pg_proc p
            join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'private' and p.proname = 'restore_access_party_mapping_v1'
        `)
      ).rows[0].count,
      1,
      `${stage}: the SHR-193 restore function must still exist, unduplicated`
    )
  }

  await assertUpgradeInvariants('through-044 → 045 → 046 → 047 → 048 upgrade')

  // Restart/rerun: forward-only re-application must be a no-op.
  await client.query(reconciliationMigration)
  await assertUpgradeInvariants('048 rerun')

  // A second rerun, to prove idempotency is structural rather than incidental.
  await client.query(reconciliationMigration)
  await assertUpgradeInvariants('048 second rerun')

  // ── The production-shaped manifest, applied for real ────────────────────
  //
  // One household, two humans, three access decisions — the exact shape SHR-194
  // describes — with the test identity remaining access_only. The values here
  // are this scratch database's fixtures, not production's: no real manifest is
  // approved yet, and inventing one is explicitly out of scope.

  const preflight = await client.query(`select * from private.access_party_preflight_v1()`)
  const pre = preflight.rows[0]
  assert.equal(pre.access_member_count, 3)
  assert.equal(pre.economic_household_count, 0)

  const manifest = {
    ref: 'SHR194-upgrade-fixture-manifest',
    parties: [
      { party_key: 'human_one', display_name: 'Human One' },
      { party_key: 'human_two', display_name: 'Human Two' },
    ],
    decisions: [
      { auth_user_id: shrey, status: 'mapped', party_key: 'human_one' },
      { auth_user_id: tarika, status: 'mapped', party_key: 'human_two' },
      { auth_user_id: testIdentity, status: 'access_only' },
    ],
  }

  const applyManifest = (connection, overrides = {}) =>
    connection.query(
      `select private.reconcile_access_parties_v1(
         $1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, null) as result`,
      [
        overrides.ref ?? manifest.ref,
        overrides.memberCount ?? pre.access_member_count,
        overrides.rosterDigest ?? pre.access_roster_digest,
        overrides.householdCount ?? 0,
        overrides.partyCount ?? 0,
        overrides.mappingCount ?? 0,
        'Upgrade fixture household',
        JSON.stringify(manifest.parties),
        JSON.stringify(overrides.decisions ?? manifest.decisions),
      ]
    )

  // A stale preflight aborts before DML, on the upgraded database too.
  await client.query('begin')
  await assert.rejects(
    applyManifest(client, { memberCount: 2 }),
    /SHR194_PREFLIGHT_ACCESS_COUNT_STALE/
  )
  await client.query('rollback')
  assert.deepEqual(
    await counts(),
    { households: 0, parties: 0, mappings: 0, history: 0, runs: 0, audit: 0 },
    'a failed preflight leaves the upgraded database untouched'
  )

  const applied = (await applyManifest(client)).rows[0].result
  assert.equal(applied.replayed, false)
  assert.equal(applied.party_count, 2)
  assert.equal(applied.decision_count, 3)

  const afterApply = await counts()
  assert.deepEqual(afterApply, {
    households: 1, parties: 2, mappings: 3, history: 3, runs: 1, audit: 3,
  })

  // The test access identity is access_only and stays that way.
  const testMapping = await client.query(
    `select status, economic_party_id from public.access_party_mappings where auth_user_id = $1`,
    [testIdentity]
  )
  assert.equal(testMapping.rows[0].status, 'access_only')
  assert.equal(testMapping.rows[0].economic_party_id, null)

  // ...and its authorization is untouched by the decision.
  await client.query('begin')
  await client.query(`set local role authenticated`)
  await client.query(`select set_config('request.jwt.claim.sub', $1, true)`, [testIdentity])
  assert.equal(
    (await client.query(`select private.is_household_member() as member`)).rows[0].member,
    true,
    'an access_only decision removes no authorization'
  )
  const context = await client.query(`select * from public.access_scope_context_v1()`)
  assert.equal(context.rows[0].access_state, 'access_only')
  assert.equal(context.rows[0].is_economic_party, false)
  assert.equal(context.rows[0].active_party_count, 2)
  await client.query('rollback')

  // Applying the same approved manifest again, in a brand-new transaction on a
  // brand-new connection — the process-restart case — is a replay that writes
  // nothing. Applying it with different content under the same reference is a
  // hard conflict rather than a silent second application.
  const restarted = new Client({ connectionString: upgradeUrl })
  await restarted.connect()
  try {
    const replay = (await applyManifest(restarted)).rows[0].result
    assert.equal(replay.replayed, true, 'a re-applied manifest is a replay after a restart')
    assert.equal(replay.economic_household_id, applied.economic_household_id)
    assert.deepEqual(await counts(), afterApply, 'a replay writes nothing at all')

    await assert.rejects(
      applyManifest(restarted, {
        decisions: [
          { auth_user_id: shrey, status: 'access_only' },
          { auth_user_id: tarika, status: 'mapped', party_key: 'human_two' },
          { auth_user_id: testIdentity, status: 'access_only' },
        ],
      }),
      /SHR194_MANIFEST_CONFLICT/,
      'the same manifest reference with different content must be refused'
    )
    assert.deepEqual(await counts(), afterApply, 'a refused conflict writes nothing either')
  } finally {
    await restarted.end()
  }

  // ── Concurrency ────────────────────────────────────────────────────────
  //
  // Two competing lifecycle changes on the exact same decision subject. The
  // invariant is not that both succeed or that one fails — it is that the
  // current state can never become ambiguous and no audit evidence is lost.

  const householdId = applied.economic_household_id
  const parties = await client.query(
    `select party_id, display_name from public.economic_parties
      where household_id = $1 order by display_name`,
    [householdId]
  )
  const [partyOne, partyTwo] = parties.rows

  const a = new Client({ connectionString: upgradeUrl })
  const b = new Client({ connectionString: upgradeUrl })
  await a.connect()
  await b.connect()
  try {
    await a.query('begin')
    await b.query('begin')
    // tarika currently maps to partyTwo, so both competing writers ask for a
    // state that genuinely differs from the one in force and from each other.
    // Anything less and one of them would legitimately no-op, which would prove
    // nothing about the serialization.
    assert.notEqual(partyOne.party_id, partyTwo.party_id)
    const call = (connection, status, partyId) =>
      connection.query(
        `select * from private.set_access_party_mapping_v1($1, $2, $3, $4, 'concurrent')`,
        [householdId, tarika, status, partyId]
      )

    const pending = [
      call(a, 'mapped', partyOne.party_id).then((result) => ({ who: a, result })),
      call(b, 'access_only', null).then((result) => ({ who: b, result })),
    ]
    // Whichever writer wins the advisory lock finishes first; committing it is
    // what lets the other one observe the decision it has to change.
    const first = await Promise.race(pending)
    await first.who.query('commit')
    const second = await Promise.all(pending)
    await (first.who === a ? b : a).query('commit')

    const versions = second.map(({ result }) => result.rows[0].decision_version).sort()
    assert.deepEqual(
      versions,
      [2, 3],
      'the two competing changes take consecutive decision versions, never the same one'
    )

    // Exactly one current decision for the subject — never two, never ambiguous.
    const current = await client.query(
      `select mapping_id, status, economic_party_id from public.access_party_mappings
        where household_id = $1 and auth_user_id = $2`,
      [householdId, tarika]
    )
    assert.equal(current.rows.length, 1, 'the current mapping stays single-valued')

    // The history chain is contiguous and complete: no version is skipped and
    // no decision is lost, so both writers' evidence survives.
    const history = await client.query(
      `select decision_version, previous_status, new_status,
              previous_economic_party_id, new_economic_party_id
         from public.access_party_mapping_history
        where mapping_id = $1 order by decision_version`,
      [current.rows[0].mapping_id]
    )
    assert.deepEqual(
      history.rows.map((row) => row.decision_version),
      [1, 2, 3],
      'every decision version is present exactly once'
    )
    for (let i = 1; i < history.rows.length; i += 1) {
      assert.equal(
        history.rows[i].previous_economic_party_id,
        history.rows[i - 1].new_economic_party_id,
        'each decision changes from the state the previous one left behind'
      )
    }
    assert.equal(
      history.rows.at(-1).new_economic_party_id,
      current.rows[0].economic_party_id,
      'the last recorded decision is the one actually in force'
    )

    // One audit event per recorded decision — none dropped, none duplicated.
    const audit = await client.query(
      `select target_version_after from public.audit_events
        where target_id = $1 order by target_version_after`,
      [current.rows[0].mapping_id]
    )
    assert.deepEqual(
      audit.rows.map((row) => row.target_version_after),
      [1, 2, 3],
      'every decision, including both concurrent ones, has its own audit evidence'
    )
  } finally {
    await a.end()
    await b.end()
  }

  // Re-running the migration over a database that now holds real decisions must
  // still be a no-op: a restart mid-release must not disturb applied evidence.
  const liveCounts = await counts()
  const liveHistory = await client.query(
    `select to_jsonb(h) as row from public.access_party_mapping_history h
      order by mapping_id, decision_version`
  )
  await client.query(reconciliationMigration)
  assert.deepEqual(await counts(), liveCounts, 'a migration rerun disturbs no applied decision')
  assert.deepEqual(
    (
      await client.query(
        `select to_jsonb(h) as row from public.access_party_mapping_history h
          order by mapping_id, decision_version`
      )
    ).rows,
    liveHistory.rows,
    'a migration rerun rewrites no mapping history'
  )

  console.log(
    'SHR-194 upgrade path: through-044 → 045 → 046 → 047 → 048, rerun-safe, ' +
      'no financial or RLS policy diff, evidence-gated manifest, concurrency invariant held.'
  )
} finally {
  await client.end().catch(() => {})
  await dropUpgradeDatabase()
}
