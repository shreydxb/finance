// Applies 045, 046, 047, 048 and then 049 over an exact through-044 database —
// the state production is actually in — and then applies 049 twice more.
//
// The fresh-path suite proves the contract. This proves what a migration review
// actually has to know about SHR-154:
//
//   * arriving here from the current production shape changes no financial
//     value and no financial tuple. accounts legitimately gains two columns, so
//     it is compared on every pre-existing column plus its physical tuple
//     identity — the fast-default path must not rewrite the table;
//   * applying the migration creates no ownership decision. Every account
//     arrives unreconciled, and its legacy owner label ('Shrey', 'Tarika',
//     'Joint' — the exact production vocabulary) decides nothing;
//   * canonical_balance_sheet and the other v1 contracts return byte-identical
//     results before and after, because no consumer is cut over here;
//   * every pre-existing RLS policy is byte-identical, which is the release
//     gate's named requirement and is asserted rather than argued;
//   * re-running the migration is a no-op, so a restart or a re-apply is safe.
//
// It then does what the fresh-path suite cannot, because that one shares a
// database: it commits a real manifest and proves cross-transaction replay,
// restart behaviour and concurrency against it.

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
const ownershipMigration = read('049_account_ownership_stable_refs.sql')

const adminUrl =
  process.env.DATABASE_URL || 'postgres://postgres:postgres@127.0.0.1:5432/postgres'
const upgradeDbName = 'our_money_shr154_upgrade_test'

const SHR154_TABLES = [
  'account_ownership_history',
  'account_ownership_reconciliation_runs',
]
const SUBSTRATE_TABLES = [
  'audit_events',
  'category_name_history',
  'category_aliases',
  'economic_households',
  'economic_parties',
  'access_party_mappings',
  'access_party_mapping_history',
  'access_party_reconciliation_runs',
  ...SHR154_TABLES,
]

const FINANCIAL_TABLES = [
  'accounts', 'transactions', 'budgets', 'recurring', 'goals', 'income',
  'category_rules', 'categories', 'settings', 'household_members',
]

// accounts legitimately gains two columns in 049, so it is compared on its
// pre-existing columns plus its tuple identity rather than on to_jsonb(t).
const VALUE_STABLE_TABLES = FINANCIAL_TABLES.filter((t) => t !== 'accounts')

function withDatabase(url, database) {
  const parsed = new URL(url)
  parsed.pathname = `/${database}`
  return parsed.toString()
}

async function dropUpgradeDatabase() {
  assert.match(upgradeDbName, /^our_money_shr154_upgrade_test$/)
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
async function financialSnapshot(tables = VALUE_STABLE_TABLES) {
  const snapshot = {}
  for (const table of tables) {
    const { rows } = await client.query(
      `select ctid::text as ctid, to_jsonb(t) as row from public.${table} t order by ctid`
    )
    snapshot[table] = rows
  }
  return snapshot
}

/**
 * accounts, projected onto exactly the columns that existed before 049, plus
 * ctid. If 049 rewrote the table or touched a value, this moves.
 */
async function accountsSnapshot(columns) {
  const projection = columns.map((c) => `t.${c}`).join(', ')
  const { rows } = await client.query(
    `select ctid::text as ctid, ${projection} from public.accounts t order by ctid`
  )
  return rows
}

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
      (select count(*)::integer from public.accounts where ownership_kind <> 'unreconciled') as owned,
      (select count(*)::integer from public.account_ownership_history) as history,
      (select count(*)::integer from public.account_ownership_reconciliation_runs) as runs,
      (select count(*)::integer from public.audit_events) as audit,
      (select count(*)::integer from public.economic_parties) as parties
  `)
  return rows[0]
}

async function canonicalContracts() {
  const { rows: balance } = await client.query(
    `select * from public.canonical_balance_sheet('household')`
  )
  const { rows: person } = await client.query(
    `select * from public.canonical_balance_sheet('person', 'Shrey')`
  )
  const { rows: investment } = await client.query(
    `select * from public.canonical_investment_metrics('household')`
  )
  const { rows: period } = await client.query(
    `select * from public.canonical_period_metrics('2026-08-01', '2026-08-31', 'household')`
  )
  const { rows: accounts } = await client.query(
    `select * from public.v_canonical_accounts_aed order by id`
  )
  return { balance, person, investment, period, accounts }
}

try {
  await client.connect()

  assert.equal(
    await client
      .query(
        `select count(*)::integer as count from information_schema.tables
         where table_schema = 'public' and table_name = any($1)`,
        [SHR154_TABLES]
      )
      .then(({ rows }) => rows[0].count),
    0,
    'the through-044 fixture must not already carry SHR-154 tables'
  )
  assert.equal(
    await client
      .query(
        `select count(*)::integer as count from information_schema.columns
         where table_schema = 'public' and table_name = 'accounts'
           and column_name in ('ownership_kind', 'owner_party_id')`
      )
      .then(({ rows }) => rows[0].count),
    0,
    'the through-044 fixture must not already carry the ownership columns'
  )

  // Production-shaped fixtures. The legacy owner vocabulary is exactly what
  // production carries today — 'Shrey' and 'Tarika', with 'Joint' available in
  // the app's own OWNERS list — precisely so this runner proves those labels
  // are still not read as identity.
  const shrey = '00000000-0000-0000-0000-000000000001'
  const tarika = '00000000-0000-0000-0000-000000000002'
  const testIdentity = '00000000-0000-0000-0000-0000000000c1'
  await client.query(`insert into auth.users (id, email) values ($1, 'claude@claude.com')`, [
    testIdentity,
  ])
  await client.query(`insert into public.household_members (user_id) values ($1)`, [testIdentity])

  const accountIds = []
  for (const [name, owner, type, isLiability, value] of [
    ['FAB Current', 'Shrey', 'cash', false, 1708.4],
    ['Wio Current', 'Tarika', 'cash', false, 4135.21],
    ['ENBD Noon CC', 'Shrey', 'credit_card', true, 5487.56],
    ['Household cash', 'Joint', 'cash', false, 2500],
  ]) {
    const { rows } = await client.query(
      `insert into public.accounts(name, owner, type, is_liability, value)
       values($1, $2, $3, $4, $5) returning id`,
      [name, owner, type, isLiability, value]
    )
    accountIds.push(rows[0].id)
  }
  await client.query(
    `insert into public.transactions(date, amount, account_id, category, note)
     values('2026-08-30', 41.5, $1, 'Groceries', 'SHR-154 upgrade marker')`,
    [accountIds[0]]
  )
  const groceries = await client.query(
    `select id from public.categories where name = 'Groceries'`
  )
  await client.query(
    `insert into public.budgets (category_id, monthly_limit, "group") values ($1, 2500, 'Flexible')`,
    [groceries.rows[0].id]
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

  const preExistingAccountColumns = (
    await client.query(`
      select column_name from information_schema.columns
      where table_schema = 'public' and table_name = 'accounts'
      order by column_name
    `)
  ).rows.map((r) => r.column_name)

  const throughO44 = {
    financial: await financialSnapshot(),
    accounts: await accountsSnapshot(preExistingAccountColumns),
    policies: await policySnapshot(),
    contracts: await canonicalContracts(),
  }
  assert.equal(throughO44.accounts.length, 4)
  assert.equal(
    throughO44.financial.household_members.length,
    3,
    'three access identities, exactly as production has'
  )

  await client.query(auditMigration)
  await client.query(categoryMigration)
  await client.query(economicMigration)
  await client.query(reconciliationMigration)

  // The 049 baseline: the exact state production would be in once the SHR-191
  // release gate lets 045–048 through. Everything after this isolates SHR-154.
  const before = {
    financial: await financialSnapshot(),
    accounts: await accountsSnapshot(preExistingAccountColumns),
    policies: await policySnapshot(),
    columns: await columnSnapshot(),
    contracts: await canonicalContracts(),
    auditConstraints: (
      await client.query(
        `select conname, pg_get_constraintdef(oid) as def from pg_constraint
          where conrelid = 'public.audit_events'::regclass order by conname`
      )
    ).rows,
  }

  await client.query(ownershipMigration)

  async function assertUpgradeInvariants(stage) {
    // 1. No financial row, and no physical tuple, is disturbed. accounts is
    //    checked on its pre-existing columns plus ctid — proving the two new
    //    columns took Postgres's fast-default path and rewrote nothing.
    assert.deepEqual(
      await financialSnapshot(),
      before.financial,
      `${stage}: every non-account financial row must be byte- and tuple-identical`
    )
    assert.deepEqual(
      await accountsSnapshot(preExistingAccountColumns),
      before.accounts,
      `${stage}: every pre-existing account column and tuple must be identical`
    )
    assert.deepEqual(
      await accountsSnapshot(preExistingAccountColumns),
      throughO44.accounts,
      `${stage}: accounts must survive the whole through-044 chain untouched`
    )

    // 2. Applying the migration is not applying a manifest. Every account is
    //    unreconciled, and no ownership decision, run or audit row exists.
    assert.deepEqual(
      await counts(),
      { owned: 0, history: 0, runs: 0, audit: 0, parties: 0 },
      `${stage}: 049 must create no ownership decision of any kind`
    )
    const kinds = await client.query(
      `select ownership_kind, owner_party_id, owner from public.accounts order by owner, name`
    )
    for (const row of kinds.rows) {
      assert.equal(row.ownership_kind, 'unreconciled', `${stage}: ${row.owner} is unreconciled`)
      assert.equal(row.owner_party_id, null)
    }
    // The exact point: 'Joint' did not become 'household', and 'Shrey' did not
    // become a party. The label is still there and still means nothing.
    assert.deepEqual(
      kinds.rows.map((r) => r.owner).sort(),
      ['Joint', 'Shrey', 'Shrey', 'Tarika'],
      `${stage}: the legacy labels are retained verbatim`
    )

    // 3. Every v1 financial contract returns exactly what it did before.
    const contracts = await canonicalContracts()
    assert.deepEqual(
      contracts,
      before.contracts,
      `${stage}: no v1 canonical contract may move when the substrate is installed`
    )
    assert.deepEqual(
      contracts,
      throughO44.contracts,
      `${stage}: no v1 canonical contract may move across the whole chain`
    )

    // 4. The V2 household scope agrees with the V1 household scope exactly.
    const v2 = (await client.query(`select * from public.canonical_balance_sheet_v2()`)).rows[0]
    const v1 = contracts.balance[0]
    for (const field of [
      'assets_aed', 'liabilities_aed', 'net_worth_aed', 'quality_status',
      'incomplete_account_count', 'provisional_account_count', 'missing_fx_count',
    ]) {
      assert.deepEqual(v2[field], v1[field], `${stage}: v2 household ${field} must equal v1`)
    }
    assert.equal(Number(v2.scoped_account_count), 4, `${stage}: each account counted once`)
    assert.equal(Number(v2.unreconciled_account_count), 4)
    assert.equal(v2.ownership_coverage_status, 'unreconciled_accounts_present')

    // 5. Existing RLS is untouched; the only new policies are on SHR-154's own
    //    two tables, and no policy anywhere authorizes through ownership.
    const after = await policySnapshot()
    const added = after.filter((p) => SHR154_TABLES.includes(p.tablename))
    const preserved = after.filter((p) => !SHR154_TABLES.includes(p.tablename))
    assert.deepEqual(
      preserved,
      before.policies,
      `${stage}: 049 must not change any pre-existing RLS policy`
    )
    assert.deepEqual(
      preserved.filter((p) => !SUBSTRATE_TABLES.includes(p.tablename)),
      throughO44.policies,
      `${stage}: financial RLS must be identical to the production shape`
    )
    assert.equal(added.length, 2, `${stage}: exactly two new policies`)
    for (const policy of after) {
      assert.doesNotMatch(
        `${policy.qual} ${policy.with_check}`,
        /ownership_kind|owner_party_id|account_ownership|economic_part/i,
        `${stage}: ${policy.tablename}.${policy.policyname} must not authorize through ownership`
      )
    }

    // 6. No column is added anywhere but accounts and SHR-154's own tables, and
    //    no household_id is fanned out across any financial fact.
    const afterColumns = await columnSnapshot()
    const newColumns = afterColumns.filter(
      (c) =>
        !before.columns.some(
          (b) => b.table_name === c.table_name && b.column_name === c.column_name
        )
    )
    assert.deepEqual(
      newColumns.filter(
        (c) =>
          !SHR154_TABLES.includes(c.table_name) &&
          c.table_name !== 'accounts' &&
          c.table_name !== 'v_account_ownership_v2'
      ),
      [],
      `${stage}: 049 must add no column outside accounts, its own tables and its own view`
    )
    assert.deepEqual(
      newColumns
        .filter((c) => c.table_name === 'accounts')
        .map((c) => c.column_name)
        .sort(),
      ['owner_party_id', 'ownership_kind'],
      `${stage}: accounts gains exactly the two contracted columns`
    )
    for (const table of FINANCIAL_TABLES) {
      assert.deepEqual(
        afterColumns.filter(
          (c) => c.table_name === table && c.column_name === 'household_id'
        ),
        [],
        `${stage}: ${table} must receive no household_id fan-out`
      )
    }
    // Fractional allocation is explicitly out of scope. Scoped to the objects
    // SHR-154 owns: `split_*` on the ledger views is transaction splitting,
    // which predates this package and is a different concept entirely.
    assert.deepEqual(
      afterColumns.filter(
        (c) =>
          (c.table_name === 'accounts' ||
            SHR154_TABLES.includes(c.table_name) ||
            c.table_name === 'v_account_ownership_v2') &&
          /share|percent|ratio|weight|split|fraction|allocation/i.test(c.column_name)
      ),
      [],
      `${stage}: no fractional ownership column exists on any SHR-154 object`
    )

    // 7. The SHR-191/193/194 contracts are untouched.
    assert.deepEqual(
      (
        await client.query(
          `select conname, pg_get_constraintdef(oid) as def from pg_constraint
            where conrelid = 'public.audit_events'::regclass order by conname`
        )
      ).rows,
      before.auditConstraints,
      `${stage}: 049 must not widen or alter the audit contract`
    )
    assert.deepEqual(
      (
        await client.query(`
          select t.tgname from pg_trigger t
           where t.tgrelid = 'public.access_party_mappings'::regclass and not t.tgisinternal
           order by t.tgname
        `)
      ).rows.map((r) => r.tgname),
      ['access_party_mappings_lifecycle_guard', 'access_party_mappings_no_truncate'],
      `${stage}: the SHR-193 lifecycle triggers are neither disabled nor replaced`
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
      `${stage}: SHR-154 invents no role`
    )
  }

  await assertUpgradeInvariants('through-044 → 045 → 046 → 047 → 048 → 049 upgrade')

  // Restart/rerun: forward-only re-application must be a no-op.
  await client.query(ownershipMigration)
  await assertUpgradeInvariants('049 rerun')
  await client.query(ownershipMigration)
  await assertUpgradeInvariants('049 second rerun')

  // ── The production-shaped manifest, applied for real ────────────────────
  //
  // Ownership can only reference parties that already exist, so the SHR-194
  // manifest runs first. The values here are this scratch database's fixtures,
  // not production's: no real manifest of either kind is approved, and
  // inventing one is explicitly out of scope.
  await client.query(
    `select private.reconcile_access_parties_v1(
       $1, $2, $3, 0, 0, 0, 'Upgrade fixture household', $4::jsonb, $5::jsonb, null)`,
    [
      'SHR154-upgrade-fixture-access-manifest',
      3,
      (await client.query(`select private.access_roster_digest_v1() as d`)).rows[0].d,
      JSON.stringify([
        { party_key: 'human_one', display_name: 'Human One' },
        { party_key: 'human_two', display_name: 'Human Two' },
      ]),
      JSON.stringify([
        { auth_user_id: shrey, status: 'mapped', party_key: 'human_one' },
        { auth_user_id: tarika, status: 'mapped', party_key: 'human_two' },
        { auth_user_id: testIdentity, status: 'access_only' },
      ]),
    ]
  )
  const economicHousehold = (
    await client.query(`select household_id from public.economic_households`)
  ).rows[0].household_id
  const partyRows = (
    await client.query(
      `select party_id, display_name from public.economic_parties order by display_name`
    )
  ).rows
  const [partyOne, partyTwo] = partyRows

  const ownershipPre = (
    await client.query(`select * from private.account_ownership_preflight_v1()`)
  ).rows[0]
  assert.equal(ownershipPre.account_count, 4)
  assert.equal(ownershipPre.unreconciled_account_count, 4)

  // The manifest is explicit for all four accounts. Note deliberately that the
  // account whose legacy label reads 'Joint' is the one a human decided is
  // shared — the decision, not the label, is what makes it so, and the two
  // 'Shrey'-labelled accounts land on two different economic outcomes.
  const ownershipManifest = [
    { account_id: accountIds[0], ownership_kind: 'personal', owner_party_id: partyOne.party_id },
    { account_id: accountIds[1], ownership_kind: 'personal', owner_party_id: partyTwo.party_id },
    { account_id: accountIds[2], ownership_kind: 'household' },
    { account_id: accountIds[3], ownership_kind: 'household' },
  ]

  const applyOwnership = (connection, overrides = {}) =>
    connection.query(
      `select private.reconcile_account_ownership_v1($1, $2, $3, $4, $5, $6, $7::jsonb, null) as result`,
      [
        overrides.ref ?? 'SHR154-upgrade-fixture-ownership-manifest',
        overrides.accountCount ?? ownershipPre.account_count,
        overrides.stateDigest ?? ownershipPre.account_state_digest,
        overrides.unreconciledCount ?? ownershipPre.unreconciled_account_count,
        overrides.runCount ?? ownershipPre.reconciliation_run_count,
        overrides.householdId ?? economicHousehold,
        JSON.stringify(overrides.assignments ?? ownershipManifest),
      ]
    )

  // A stale preflight aborts before DML, on the upgraded database too.
  await client.query('begin')
  await assert.rejects(
    applyOwnership(client, { accountCount: 3 }),
    /SHR154_PREFLIGHT_ACCOUNT_COUNT_STALE/
  )
  await client.query('rollback')
  assert.equal((await counts()).owned, 0, 'a failed preflight leaves ownership untouched')

  const balanceBeforeOwnership = await canonicalContracts()
  const applied = (await applyOwnership(client)).rows[0].result
  assert.equal(applied.replayed, false)
  assert.equal(applied.assignment_count, 4)

  const afterApply = await counts()
  assert.deepEqual(afterApply, { owned: 4, history: 4, runs: 1, audit: 3, parties: 2 })

  // Reconciling ownership moves no financial number at all.
  assert.deepEqual(
    await canonicalContracts(),
    balanceBeforeOwnership,
    'applying an ownership manifest changes no v1 financial contract'
  )

  // Shared is counted once, and party scopes hold only explicit personal facts.
  const householdV2 = (await client.query(`select * from public.canonical_balance_sheet_v2()`))
    .rows[0]
  assert.equal(Number(householdV2.assets_aed), 1708.4 + 4135.21 + 2500)
  assert.equal(Number(householdV2.liabilities_aed), 5487.56)
  assert.equal(Number(householdV2.shared_account_count), 2)
  assert.equal(Number(householdV2.unreconciled_account_count), 0)
  assert.equal(householdV2.ownership_coverage_status, 'complete')

  const scopeOne = (
    await client.query(`select * from public.canonical_balance_sheet_v2('party', $1)`, [
      partyOne.party_id,
    ])
  ).rows[0]
  const scopeTwo = (
    await client.query(`select * from public.canonical_balance_sheet_v2('party', $1)`, [
      partyTwo.party_id,
    ])
  ).rows[0]
  assert.equal(Number(scopeOne.assets_aed), 1708.4)
  assert.equal(Number(scopeTwo.assets_aed), 4135.21)
  assert.equal(
    Number(scopeOne.liabilities_aed) + Number(scopeTwo.liabilities_aed),
    0,
    'the shared credit card is allocated to neither party'
  )
  assert.notEqual(
    Number(scopeOne.assets_aed) + Number(scopeTwo.assets_aed),
    Number(householdV2.assets_aed),
    'party scopes deliberately do not reconstruct the household total'
  )

  // Ownership grants nothing: the access-only test identity still reads and
  // writes every account, and owns none of them.
  await client.query('begin')
  await client.query(`set local role authenticated`)
  await client.query(`select set_config('request.jwt.claim.sub', $1, true)`, [testIdentity])
  assert.equal(
    (await client.query(`select count(*)::integer as n from public.accounts`)).rows[0].n,
    4,
    'an access identity that owns nothing still reads every account'
  )
  await assert.rejects(
    client.query(`update public.accounts set ownership_kind = 'household' where id = $1`, [
      accountIds[0],
    ]),
    /SHR154_OWNERSHIP_WRITE_FORBIDDEN/,
    'and still cannot assign ownership'
  )
  await client.query('rollback')

  // Cross-transaction replay and conflict, on a brand-new connection — the
  // process-restart case.
  const restarted = new Client({ connectionString: upgradeUrl })
  await restarted.connect()
  try {
    const replay = (await applyOwnership(restarted)).rows[0].result
    assert.equal(replay.replayed, true, 'a re-applied manifest is a replay after a restart')
    assert.deepEqual(await counts(), afterApply, 'a replay writes nothing at all')

    await assert.rejects(
      applyOwnership(restarted, {
        assignments: [
          { account_id: accountIds[0], ownership_kind: 'household' },
          { account_id: accountIds[1], ownership_kind: 'personal', owner_party_id: partyTwo.party_id },
          { account_id: accountIds[2], ownership_kind: 'household' },
          { account_id: accountIds[3], ownership_kind: 'household' },
        ],
      }),
      /SHR154_MANIFEST_CONFLICT/,
      'the same manifest reference with different content must be refused'
    )
    assert.deepEqual(await counts(), afterApply, 'a refused conflict writes nothing either')
  } finally {
    await restarted.end()
  }

  // ── Concurrency ────────────────────────────────────────────────────────
  //
  // Two competing ownership changes on the same account. The invariant is not
  // that both succeed — it is that the current ownership can never become
  // ambiguous and no decision evidence is lost.
  const a = new Client({ connectionString: upgradeUrl })
  const b = new Client({ connectionString: upgradeUrl })
  await a.connect()
  await b.connect()
  try {
    await a.query('begin')
    await b.query('begin')
    const call = (connection, kind, partyId) =>
      connection.query(
        `select * from private.set_account_ownership_v1($1, $2, $3, $4, 'concurrent', null)`,
        [accountIds[0], kind, partyId, economicHousehold]
      )

    const pending = [
      call(a, 'personal', partyTwo.party_id).then((result) => ({ who: a, result })),
      call(b, 'household', null).then((result) => ({ who: b, result })),
    ]
    const first = await Promise.race(pending)
    await first.who.query('commit')
    const second = await Promise.all(pending)
    await (first.who === a ? b : a).query('commit')

    assert.deepEqual(
      second.map(({ result }) => result.rows[0].decision_version).sort(),
      [2, 3],
      'competing changes take consecutive decision versions, never the same one'
    )

    const history = (
      await client.query(
        `select decision_version, previous_ownership_kind, new_ownership_kind,
                previous_owner_party_id, new_owner_party_id
           from public.account_ownership_history
          where account_id = $1 order by decision_version`,
        [accountIds[0]]
      )
    ).rows
    assert.deepEqual(
      history.map((r) => r.decision_version),
      [1, 2, 3],
      'every decision version is present exactly once'
    )
    for (let i = 1; i < history.length; i += 1) {
      assert.equal(
        history[i].previous_ownership_kind,
        history[i - 1].new_ownership_kind,
        'each decision changes from the state the previous one left behind'
      )
      assert.equal(
        history[i].previous_owner_party_id,
        history[i - 1].new_owner_party_id,
        'and from the exact party the previous one left behind'
      )
    }
    const current = (
      await client.query(
        `select ownership_kind, owner_party_id from public.accounts where id = $1`,
        [accountIds[0]]
      )
    ).rows[0]
    assert.equal(history.at(-1).new_ownership_kind, current.ownership_kind)
    assert.equal(history.at(-1).new_owner_party_id, current.owner_party_id)
  } finally {
    await a.end()
    await b.end()
  }

  // Re-running the migration over a database that now holds real ownership
  // decisions must still be a no-op: a restart mid-release must not disturb
  // applied evidence.
  const liveCounts = await counts()
  const liveHistory = (
    await client.query(
      `select to_jsonb(h) as row from public.account_ownership_history h
        order by account_id, decision_version`
    )
  ).rows
  const liveAccounts = (
    await client.query(
      `select id, ownership_kind, owner_party_id from public.accounts order by id`
    )
  ).rows
  await client.query(ownershipMigration)
  assert.deepEqual(await counts(), liveCounts, 'a migration rerun disturbs no ownership decision')
  assert.deepEqual(
    (
      await client.query(
        `select to_jsonb(h) as row from public.account_ownership_history h
          order by account_id, decision_version`
      )
    ).rows,
    liveHistory,
    'a migration rerun rewrites no ownership history'
  )
  assert.deepEqual(
    (
      await client.query(
        `select id, ownership_kind, owner_party_id from public.accounts order by id`
      )
    ).rows,
    liveAccounts,
    'a migration rerun rewrites no ownership fact'
  )

  console.log(
    'SHR-154 upgrade path: through-044 → 045 → 046 → 047 → 048 → 049, rerun-safe, ' +
      'no financial value/tuple or RLS policy diff, v1 contracts byte-identical, ' +
      'evidence-gated manifest, shared counted once, concurrency invariant held.'
  )
} finally {
  await client.end().catch(() => {})
  await dropUpgradeDatabase()
}
