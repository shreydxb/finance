// SHR-154 — account ownership stable references.
//
// SHR-193 proved that an authorization actor is not an economic party, and
// SHR-194 proved that a mapping decision is made rather than inferred. This
// file proves the claim that puts a stable reference on a financial fact:
//
//     AN ACCOUNT'S OWNER IS A REVIEWED ECONOMIC FACT, NOT A LABEL —
//     AND A SHARED ACCOUNT IS ONE FACT, COUNTED ONCE.
//
// Everything here serves that. The legacy `owner` text ('Shrey', 'Tarika',
// 'Joint') must never become identity; a personal account must name exactly one
// party by UUID; a shared account must be one row with no party and no
// allocation of any kind; the unknown state must stay explicitly unknown; and
// none of it may grant, widen or remove a single byte of authorization, change
// a financial value, or reach an existing consumer that has not been cut over.
//
// Tests needing committed rows — the production-shaped upgrade, cross-transaction
// replay, restart safety and the policy diff — live in
// account-ownership-upgrade-path.mjs, which builds its own scratch database.

import assert from 'node:assert/strict'
import test from 'node:test'
import { actAs, expectReject, OUTSIDER_ID, SHREY_ID, TARIKA_ID, withTx } from './helpers.mjs'
import { BACKUP_TABLES, buildBackup } from '../functions/backup/dump.ts'

const NEW_TABLES = ['account_ownership_history', 'account_ownership_reconciliation_runs']

/** Back to the migration/operator authority after a role-scoped assertion. */
async function asOwner(client) {
  await client.query('reset role')
}

/**
 * Real accounts, created exactly the way the app creates them: no ownership
 * column is supplied, so every one arrives unreconciled.
 */
async function seedAccounts(client, rows) {
  // Lock ordering, not a fixture step. Tests in this file write ownership, and
  // the guard resolves the party — so these transactions touch both accounts
  // and economic_parties while SHR-193's `truncate economic_parties` test holds
  // that table exclusively. Taking the (ACCESS SHARE) read first gives every
  // transaction here the same lock order as that truncate, so the two block
  // each other rather than deadlocking on the shared database.
  await client.query('select 1 from public.economic_parties limit 1')

  const ids = []
  for (const row of rows) {
    const { rows: inserted } = await client.query(
      `insert into public.accounts (name, owner, type, is_liability, currency, value)
       values ($1, $2, $3, $4, $5, $6) returning id`,
      [
        row.name,
        row.owner,
        row.type ?? 'cash',
        row.is_liability ?? false,
        row.currency ?? 'AED',
        row.value ?? 0,
      ]
    )
    ids.push(inserted[0].id)
  }
  return ids
}

/** An economic household and N parties, created only through SHR-194's writer. */
async function seedEconomic(client, partyNames = ['Party One', 'Party Two']) {
  const { rows: household } = await client.query(
    `insert into public.economic_households (display_name)
     values ('SHR154 test household') returning household_id`
  )
  const householdId = household[0].household_id
  const parties = []
  for (const name of partyNames) {
    const { rows } = await client.query(
      `select (private.create_economic_party_v1($1, $2)).party_id as party_id`,
      [householdId, name]
    )
    parties.push(rows[0].party_id)
  }
  return { householdId, parties }
}

async function preflight(client) {
  const { rows } = await client.query('select * from private.account_ownership_preflight_v1()')
  return rows[0]
}

/**
 * Applies a manifest exactly as the release path would: the preflight evidence
 * is read from the database and handed straight back, so no test hardcodes a
 * digest that would rot.
 */
async function reconcile(client, { manifestRef, householdId, assignments, expected = {}, actingUserId = null }) {
  const pre = await preflight(client)
  const { rows } = await client.query(
    `select private.reconcile_account_ownership_v1($1, $2, $3, $4, $5, $6, $7::jsonb, $8) as result`,
    [
      manifestRef,
      expected.accountCount ?? pre.account_count,
      expected.stateDigest ?? pre.account_state_digest,
      expected.unreconciledCount ?? pre.unreconciled_account_count,
      expected.runCount ?? pre.reconciliation_run_count,
      householdId,
      JSON.stringify(assignments),
      actingUserId,
    ]
  )
  return rows[0].result
}

async function accountRow(client, id) {
  const { rows } = await client.query('select * from public.accounts where id = $1', [id])
  return rows[0]
}

async function counts(client) {
  const { rows } = await client.query(`
    select
      (select count(*)::integer from public.account_ownership_history) as history,
      (select count(*)::integer from public.account_ownership_reconciliation_runs) as runs,
      (select count(*)::integer from public.audit_events) as audit,
      (select count(*)::integer from public.accounts where ownership_kind <> 'unreconciled') as reconciled
  `)
  return rows[0]
}

// ── A. Identity shape ──────────────────────────────────────────────────────

test('an account arrives unreconciled, and its legacy owner label decides nothing', async () => {
  await withTx(async (client) => {
    const [shreyish, jointish] = await seedAccounts(client, [
      { name: 'Looks personal', owner: 'Shrey' },
      { name: 'Looks joint', owner: 'Joint' },
    ])

    for (const id of [shreyish, jointish]) {
      const row = await accountRow(client, id)
      assert.equal(row.ownership_kind, 'unreconciled')
      assert.equal(row.owner_party_id, null)
    }

    // The label the household typed is still there, and still means nothing
    // economically. 'Joint' in particular is NOT read as ownership_kind
    // 'household' — that would be exactly the label-to-identity inference
    // SHR-194 established this system must never make.
    assert.equal((await accountRow(client, jointish)).owner, 'Joint')
    assert.equal((await counts(client)).reconciled, 0)
  })
})

test('a personal account names exactly one economic party, by UUID', async () => {
  await withTx(async (client) => {
    const [accountId] = await seedAccounts(client, [{ name: 'Personal', owner: 'Shrey' }])
    const { householdId, parties } = await seedEconomic(client)

    await reconcile(client, {
      manifestRef: 'SHR154-personal',
      householdId,
      assignments: [
        { account_id: accountId, ownership_kind: 'personal', owner_party_id: parties[0] },
      ],
    })

    const row = await accountRow(client, accountId)
    assert.equal(row.ownership_kind, 'personal')
    assert.equal(row.owner_party_id, parties[0])

    // One party, not a set: the shape constraint has no room for a second.
    const { rows } = await client.query(
      `select count(*)::integer as n from information_schema.columns
        where table_schema = 'public' and table_name = 'accounts'
          and column_name in ('owner_party_ids', 'ownership_share', 'ownership_percent',
                              'owner_split', 'ownership_weight', 'ownership_ratio')`
    )
    assert.equal(rows[0].n, 0, 'no fractional or multi-party ownership column exists')
  })
})

test('a shared account is one row with no party and no allocation', async () => {
  await withTx(async (client) => {
    const [accountId] = await seedAccounts(client, [{ name: 'Shared', owner: 'Joint' }])
    const { householdId } = await seedEconomic(client)

    await reconcile(client, {
      manifestRef: 'SHR154-shared',
      householdId,
      assignments: [{ account_id: accountId, ownership_kind: 'household' }],
    })

    const { rows } = await client.query('select * from public.accounts')
    assert.equal(rows.length, 1, 'shared ownership is not written once per party')
    assert.equal(rows[0].ownership_kind, 'household')
    assert.equal(rows[0].owner_party_id, null)

    const history = await client.query('select * from public.account_ownership_history')
    assert.equal(history.rows.length, 1, 'one decision, not one per party')
  })
})

test('a shared account cannot smuggle in an owning party', async () => {
  await withTx(async (client) => {
    const [accountId] = await seedAccounts(client, [{ name: 'Shared', owner: 'Joint' }])
    const { householdId, parties } = await seedEconomic(client)

    await expectReject(
      client,
      () =>
        reconcile(client, {
          manifestRef: 'SHR154-shared-with-party',
          householdId,
          assignments: [
            { account_id: accountId, ownership_kind: 'household', owner_party_id: parties[0] },
          ],
        }),
      /SHR154_HOUSEHOLD_OWNERSHIP_FORBIDS_PARTY/
    )
    assert.equal((await accountRow(client, accountId)).ownership_kind, 'unreconciled')
  })
})

test('a personal decision without a party is refused', async () => {
  await withTx(async (client) => {
    const [accountId] = await seedAccounts(client, [{ name: 'Personal', owner: 'Shrey' }])
    const { householdId } = await seedEconomic(client)

    await expectReject(
      client,
      () =>
        reconcile(client, {
          manifestRef: 'SHR154-personal-no-party',
          householdId,
          assignments: [{ account_id: accountId, ownership_kind: 'personal' }],
        }),
      /SHR154_PERSONAL_OWNERSHIP_REQUIRES_PARTY/
    )
  })
})

test('the unreconciled state stays explicit and is never a silent household default', async () => {
  await withTx(async (client) => {
    const [known, unknown] = await seedAccounts(client, [
      { name: 'Known', owner: 'Shrey' },
      { name: 'Unknown', owner: 'Shrey' },
    ])
    const { householdId, parties } = await seedEconomic(client)

    // Both accounts are covered by the manifest — coverage is exhaustive — but
    // only because a human decided both. There is no way to ask for
    // 'unreconciled' as an outcome.
    await expectReject(
      client,
      () =>
        reconcile(client, {
          manifestRef: 'SHR154-explicit-unknown',
          householdId,
          assignments: [
            { account_id: known, ownership_kind: 'personal', owner_party_id: parties[0] },
            { account_id: unknown, ownership_kind: 'unreconciled' },
          ],
        }),
      /SHR154_OWNERSHIP_KIND_NOT_ALLOWED/
    )

    const rows = await client.query('select ownership_kind from public.accounts')
    assert.deepEqual(
      rows.rows.map((r) => r.ownership_kind).sort(),
      ['unreconciled', 'unreconciled'],
      'a rejected manifest leaves both accounts exactly as they were'
    )
  })
})

test('a display name is never an ownership key: renaming a party changes no ownership fact', async () => {
  await withTx(async (client) => {
    const [accountId] = await seedAccounts(client, [{ name: 'Personal', owner: 'Shrey' }])
    const { householdId, parties } = await seedEconomic(client)
    await reconcile(client, {
      manifestRef: 'SHR154-rename',
      householdId,
      assignments: [
        { account_id: accountId, ownership_kind: 'personal', owner_party_id: parties[0] },
      ],
    })

    await client.query(
      `update public.economic_parties set display_name = 'Renamed Entirely' where party_id = $1`,
      [parties[0]]
    )

    const row = await accountRow(client, accountId)
    assert.equal(row.owner_party_id, parties[0], 'the stable UUID is the identity')
    assert.equal(row.ownership_kind, 'personal')

    const { rows } = await client.query(
      `select owner_party_display_name, owner_party_id
         from public.v_account_ownership_v2 where account_id = $1`,
      [accountId]
    )
    assert.equal(rows[0].owner_party_display_name, 'Renamed Entirely', 'presentation follows')
    assert.equal(rows[0].owner_party_id, parties[0], 'identity does not')
  })
})

test('a three-party household is representable, with no pair assumption anywhere', async () => {
  await withTx(async (client) => {
    const ids = await seedAccounts(client, [
      { name: 'A', owner: 'Shrey', value: 100 },
      { name: 'B', owner: 'Tarika', value: 200 },
      { name: 'C', owner: 'Third', value: 300 },
      { name: 'D shared', owner: 'Joint', value: 400 },
    ])
    const { householdId, parties } = await seedEconomic(client, ['One', 'Two', 'Three'])

    await reconcile(client, {
      manifestRef: 'SHR154-three-party',
      householdId,
      assignments: [
        { account_id: ids[0], ownership_kind: 'personal', owner_party_id: parties[0] },
        { account_id: ids[1], ownership_kind: 'personal', owner_party_id: parties[1] },
        { account_id: ids[2], ownership_kind: 'personal', owner_party_id: parties[2] },
        { account_id: ids[3], ownership_kind: 'household' },
      ],
    })

    for (const [index, partyId] of parties.entries()) {
      const { rows } = await client.query(
        `select assets_aed, scoped_account_count
           from public.canonical_balance_sheet_v2('party', $1)`,
        [partyId]
      )
      assert.equal(Number(rows[0].assets_aed), (index + 1) * 100)
      assert.equal(Number(rows[0].scoped_account_count), 1)
    }
  })
})

test('an archived party keeps its accounts resolvable but accepts no new ownership', async () => {
  await withTx(async (client) => {
    const ids = await seedAccounts(client, [
      { name: 'Already owned', owner: 'Shrey' },
      { name: 'Later', owner: 'Shrey' },
    ])
    const { householdId, parties } = await seedEconomic(client)

    await reconcile(client, {
      manifestRef: 'SHR154-before-archive',
      householdId,
      assignments: [
        { account_id: ids[0], ownership_kind: 'personal', owner_party_id: parties[0] },
        { account_id: ids[1], ownership_kind: 'household' },
      ],
    })

    await client.query(
      `update public.economic_parties set archived_at = now() where party_id = $1`,
      [parties[0]]
    )

    // Historical stability: the existing ownership is untouched and still fully
    // readable, archived party and all.
    const row = await accountRow(client, ids[0])
    assert.equal(row.owner_party_id, parties[0])
    const { rows: view } = await client.query(
      `select owner_party_display_name, owner_party_archived_at
         from public.v_account_ownership_v2 where account_id = $1`,
      [ids[0]]
    )
    assert.equal(view[0].owner_party_display_name, 'Party One')
    assert.ok(view[0].owner_party_archived_at, 'the archive state is visible, not hidden')

    // A new decision fails closed.
    await expectReject(
      client,
      () =>
        client.query(
          `select private.set_account_ownership_v1($1, 'personal', $2, $3, 'x', null)`,
          [ids[1], parties[0], householdId]
        ),
      /SHR154_OWNERSHIP_TO_ARCHIVED_PARTY_FORBIDDEN/
    )
  })
})

test('an account cannot be owned by a party in another economic household', async () => {
  await withTx(async (client) => {
    const ids = await seedAccounts(client, [
      { name: 'First', owner: 'Shrey' },
      { name: 'Second', owner: 'Tarika' },
    ])
    const first = await seedEconomic(client, ['Only'])
    const { rows: other } = await client.query(
      `insert into public.economic_households (display_name)
       values ('A different economic household') returning household_id`
    )
    const { rows: foreign } = await client.query(
      `select (private.create_economic_party_v1($1, 'Foreign Party')).party_id as party_id`,
      [other[0].household_id]
    )

    await client.query(`select private.set_account_ownership_v1($1, 'personal', $2, $3, 'x', null)`, [
      ids[0],
      first.parties[0],
      first.householdId,
    ])

    // Named against the wrong household in the manifest: caught before any write.
    await expectReject(
      client,
      () =>
        client.query(
          `select private.set_account_ownership_v1($1, 'personal', $2, $3, 'x', null)`,
          [ids[1], foreign[0].party_id, first.householdId]
        ),
      /SHR154_OWNERSHIP_CROSS_HOUSEHOLD_FORBIDDEN/
    )

    // And named consistently with its own household: still refused, because the
    // household's accounts would then straddle two economic namespaces.
    await expectReject(
      client,
      () =>
        client.query(
          `select private.set_account_ownership_v1($1, 'personal', $2, $3, 'x', null)`,
          [ids[1], foreign[0].party_id, other[0].household_id]
        ),
      /SHR154_OWNERSHIP_CROSS_HOUSEHOLD_FORBIDDEN/
    )

    assert.equal((await accountRow(client, ids[1])).ownership_kind, 'unreconciled')
  })
})

test('a reviewed ownership decision can never regress to unreconciled', async () => {
  await withTx(async (client) => {
    const [accountId] = await seedAccounts(client, [{ name: 'Owned', owner: 'Shrey' }])
    const { householdId, parties } = await seedEconomic(client)
    await client.query(`select private.set_account_ownership_v1($1, 'personal', $2, $3, 'x', null)`, [
      accountId,
      parties[0],
      householdId,
    ])

    // Not through the writer — it has no such vocabulary.
    await expectReject(
      client,
      () =>
        client.query(
          `select private.set_account_ownership_v1($1, 'unreconciled', null, $2, 'x', null)`,
          [accountId, householdId]
        ),
      /SHR154_OWNERSHIP_KIND_NOT_ALLOWED/
    )

    // And not by raw DML either, operator included.
    await expectReject(
      client,
      () =>
        client.query(
          `update public.accounts
              set ownership_kind = 'unreconciled', owner_party_id = null
            where id = $1`,
          [accountId]
        ),
      /SHR154_OWNERSHIP_CANNOT_BE_UNRECONCILED/
    )
  })
})

test('the shape constraint refuses every impossible ownership combination', async () => {
  await withTx(async (client) => {
    const [accountId] = await seedAccounts(client, [{ name: 'X', owner: 'Shrey' }])
    const { householdId, parties } = await seedEconomic(client)
    await client.query(`select private.set_account_ownership_v1($1, 'personal', $2, $3, 'x', null)`, [
      accountId,
      parties[0],
      householdId,
    ])

    await expectReject(
      client,
      () =>
        client.query(`update public.accounts set owner_party_id = null where id = $1`, [accountId]),
      /accounts_ownership_shape_check/
    )
    await expectReject(
      client,
      () =>
        client.query(
          `update public.accounts set ownership_kind = 'household' where id = $1`,
          [accountId]
        ),
      /accounts_ownership_shape_check/
    )
    await expectReject(
      client,
      () =>
        client.query(
          `update public.accounts set ownership_kind = 'fractional' where id = $1`,
          [accountId]
        ),
      /accounts_ownership_kind_check/
    )
  })
})

// ── B. Compatibility ───────────────────────────────────────────────────────

test('an ordinary account write is untouched, including edits to the legacy owner text', async () => {
  await withTx(async (client) => {
    await actAs(client, 'authenticated', SHREY_ID)
    const { rows: created } = await client.query(
      `insert into public.accounts (name, owner, type, currency, value)
       values ('App created', 'Shrey', 'cash', 'AED', 10) returning *`
    )
    assert.equal(created[0].ownership_kind, 'unreconciled')
    assert.equal(created[0].owner_party_id, null)

    const { rows: updated } = await client.query(
      `update public.accounts set owner = 'Tarika', value = 99, updated_at = now()
        where id = $1 returning *`,
      [created[0].id]
    )
    assert.equal(updated[0].owner, 'Tarika', 'the legacy label is still freely mutable')
    assert.equal(Number(updated[0].value), 99)
    assert.equal(updated[0].ownership_kind, 'unreconciled')

    const { rows: deleted } = await client.query(
      `delete from public.accounts where id = $1 returning id`,
      [created[0].id]
    )
    assert.equal(deleted.length, 1, 'account deletion still works exactly as before')
    await asOwner(client)
  })
})

test('an ownership decision changes no value and does not touch updated_at', async () => {
  await withTx(async (client) => {
    const [accountId] = await seedAccounts(client, [
      { name: 'Valued', owner: 'Shrey', value: 1234.56, currency: 'USD' },
    ])
    const before = await accountRow(client, accountId)
    const { householdId, parties } = await seedEconomic(client)

    await reconcile(client, {
      manifestRef: 'SHR154-no-value-change',
      householdId,
      assignments: [
        { account_id: accountId, ownership_kind: 'personal', owner_party_id: parties[0] },
      ],
    })

    const after = await accountRow(client, accountId)
    for (const column of Object.keys(before)) {
      if (column === 'ownership_kind' || column === 'owner_party_id') continue
      assert.deepEqual(
        after[column],
        before[column],
        `${column} must be untouched by an ownership decision`
      )
    }
    // updated_at in particular: v_canonical_accounts_aed derives valuation
    // freshness from it, so bumping it would silently restate valuation age.
    assert.deepEqual(after.updated_at, before.updated_at)
  })
})

test('canonical_balance_sheet is unchanged by the substrate and by a reconciliation', async () => {
  await withTx(async (client) => {
    const ids = await seedAccounts(client, [
      { name: 'Cash', owner: 'Shrey', value: 1000 },
      { name: 'Card', owner: 'Tarika', type: 'credit_card', is_liability: true, value: 250 },
      { name: 'Shared', owner: 'Joint', value: 500 },
    ])
    const { rows: before } = await client.query(
      `select * from public.canonical_balance_sheet('household')`
    )

    const { householdId, parties } = await seedEconomic(client)
    await reconcile(client, {
      manifestRef: 'SHR154-v1-untouched',
      householdId,
      assignments: [
        { account_id: ids[0], ownership_kind: 'personal', owner_party_id: parties[0] },
        { account_id: ids[1], ownership_kind: 'personal', owner_party_id: parties[1] },
        { account_id: ids[2], ownership_kind: 'household' },
      ],
    })

    const { rows: after } = await client.query(
      `select * from public.canonical_balance_sheet('household')`
    )
    assert.deepEqual(after, before, 'the v1 wealth contract does not move')

    // The legacy person scope also still reads the legacy text, unchanged.
    const { rows: legacy } = await client.query(
      `select assets_aed from public.canonical_balance_sheet('person', 'Shrey')`
    )
    assert.equal(Number(legacy[0].assets_aed), 1000)
  })
})

test('the V2 household scope equals the V1 household scope exactly', async () => {
  await withTx(async (client) => {
    const ids = await seedAccounts(client, [
      { name: 'Cash', owner: 'Shrey', value: 1000 },
      { name: 'USD holding', owner: 'Tarika', value: 100, currency: 'USD' },
      { name: 'Card', owner: 'Joint', type: 'credit_card', is_liability: true, value: 250 },
    ])
    const { householdId, parties } = await seedEconomic(client)
    await reconcile(client, {
      manifestRef: 'SHR154-parity',
      householdId,
      assignments: [
        { account_id: ids[0], ownership_kind: 'personal', owner_party_id: parties[0] },
        { account_id: ids[1], ownership_kind: 'personal', owner_party_id: parties[1] },
        { account_id: ids[2], ownership_kind: 'household' },
      ],
    })

    const { rows: v1 } = await client.query(
      `select * from public.canonical_balance_sheet('household')`
    )
    const { rows: v2 } = await client.query(`select * from public.canonical_balance_sheet_v2()`)

    for (const field of [
      'assets_aed',
      'liabilities_aed',
      'net_worth_aed',
      'quality_status',
      'incomplete_account_count',
      'provisional_account_count',
      'missing_fx_count',
    ]) {
      assert.deepEqual(v2[0][field], v1[0][field], `${field} must be identical across v1 and v2`)
    }
    assert.equal(Number(v2[0].scoped_account_count), 3, 'each account counted exactly once')
    assert.equal(v2[0].quality_metadata.classification_version, 'shr-111-phase-a-v1')
  })
})

test('no existing consumer reads the stable reference yet', async () => {
  await withTx(async (client) => {
    // The reference migration installs the substrate; the cutovers are SHR-173,
    // SHR-153, SHR-172 and SHR-158. If a v1 contract started reading the new
    // columns, this test is the thing that should fail first.
    const { rows } = await client.query(`
      select p.proname
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname in ('canonical_balance_sheet', 'canonical_period_metrics',
                          'canonical_investment_metrics', 'canonical_budget_actuals',
                          'record_net_worth_snapshot')
        and (pg_get_functiondef(p.oid) ilike '%ownership_kind%'
             or pg_get_functiondef(p.oid) ilike '%owner_party_id%')
    `)
    assert.deepEqual(rows, [], 'no v1 canonical contract consumes stable ownership')

    const { rows: views } = await client.query(`
      select viewname from pg_views
      where schemaname = 'public'
        and viewname <> 'v_account_ownership_v2'
        and (definition ilike '%ownership_kind%' or definition ilike '%owner_party_id%')
    `)
    assert.deepEqual(views, [], 'no existing view consumes stable ownership')
  })
})

// ── C. Authorization ───────────────────────────────────────────────────────

test('no RLS policy anywhere consults account ownership', async () => {
  await withTx(async (client) => {
    const { rows } = await client.query(`
      select tablename, policyname
      from pg_policies
      where schemaname = 'public'
        and (coalesce(qual, '') || ' ' || coalesce(with_check, '')) ~*
            '(ownership_kind|owner_party_id|account_ownership)'
    `)
    assert.deepEqual(rows, [], 'ownership is a financial fact, never an authorization predicate')
  })
})

test('ownership grants nothing and revokes nothing — the accounts policy is untouched', async () => {
  await withTx(async (client) => {
    const ids = await seedAccounts(client, [
      { name: 'Shrey personal', owner: 'Shrey', value: 10 },
      { name: 'Tarika personal', owner: 'Tarika', value: 20 },
    ])
    const { householdId, parties } = await seedEconomic(client)
    await reconcile(client, {
      manifestRef: 'SHR154-access-unchanged',
      householdId,
      assignments: [
        { account_id: ids[0], ownership_kind: 'personal', owner_party_id: parties[0] },
        { account_id: ids[1], ownership_kind: 'personal', owner_party_id: parties[1] },
      ],
    })

    // Tarika's access identity is mapped to no party at all here, and owns
    // nothing. She still reads and writes every account, exactly as before.
    await actAs(client, 'authenticated', TARIKA_ID)
    const { rows: readable } = await client.query('select id from public.accounts order by name')
    assert.equal(readable.length, 2, 'ownership takes no read access away')
    const { rows: written } = await client.query(
      `update public.accounts set value = 11 where id = $1 returning value`,
      [ids[0]]
    )
    assert.equal(Number(written[0].value), 11, 'ownership takes no write access away')
    await asOwner(client)

    // And an outsider still gets nothing, ownership or no ownership.
    await actAs(client, 'authenticated', OUTSIDER_ID)
    const { rows: outsider } = await client.query('select id from public.accounts')
    assert.deepEqual(outsider, [], 'ownership grants no access to a non-member')
    await asOwner(client)
  })
})

test('no API role can assign ownership, despite holding table-level UPDATE on accounts', async () => {
  await withTx(async (client) => {
    const [accountId] = await seedAccounts(client, [{ name: 'Target', owner: 'Shrey' }])
    const { parties } = await seedEconomic(client)

    for (const role of ['authenticated', 'service_role']) {
      await actAs(client, role, role === 'authenticated' ? SHREY_ID : null)
      await expectReject(
        client,
        () =>
          client.query(
            `update public.accounts set ownership_kind = 'personal', owner_party_id = $2
              where id = $1`,
            [accountId, parties[0]]
          ),
        /SHR154_OWNERSHIP_WRITE_FORBIDDEN/
      )
      await expectReject(
        client,
        () =>
          client.query(
            `update public.accounts set ownership_kind = 'household' where id = $1`,
            [accountId]
          ),
        /SHR154_OWNERSHIP_WRITE_FORBIDDEN/
      )
      await expectReject(
        client,
        () =>
          client.query(
            `insert into public.accounts (name, owner, type, currency, value, ownership_kind)
             values ('Smuggled', 'Shrey', 'cash', 'AED', 0, 'household')`
          ),
        /SHR154_OWNERSHIP_WRITE_FORBIDDEN/
      )
      await asOwner(client)
    }

    assert.equal((await accountRow(client, accountId)).ownership_kind, 'unreconciled')
  })
})

test('no API role can reach an ownership writer, preflight or roster by calling it directly', async () => {
  await withTx(async (client) => {
    const calls = [
      `select private.account_ownership_preflight_v1()`,
      `select private.account_ownership_roster_v1()`,
      `select private.account_ownership_digest_v1()`,
      `select private.begin_account_ownership_restore_v1('00000000-0000-0000-0000-000000000009')`,
      `select private.set_account_ownership_v1('00000000-0000-0000-0000-000000000009', 'household',
         null, '00000000-0000-0000-0000-000000000009', null, null)`,
      `select private.reconcile_account_ownership_v1('x', 0, 'sha256:0', 0, 0,
         '00000000-0000-0000-0000-000000000009', '[]'::jsonb, null)`,
    ]
    for (const role of ['anon', 'authenticated', 'service_role']) {
      await actAs(client, role, role === 'authenticated' ? SHREY_ID : null)
      for (const sql of calls) {
        await expectReject(client, () => client.query(sql), /permission denied/i)
      }
      await asOwner(client)
    }
  })
})

test('no API role can write ownership history or a run record directly', async () => {
  await withTx(async (client) => {
    for (const role of ['anon', 'authenticated', 'service_role']) {
      await actAs(client, role, role === 'authenticated' ? SHREY_ID : null)
      for (const table of NEW_TABLES) {
        for (const sql of [
          `insert into public.${table} default values`,
          `update public.${table} set schema_version = 1`,
          `delete from public.${table}`,
        ]) {
          await expectReject(client, () => client.query(sql), /permission denied|violates|SHR154/i)
        }
      }
      await asOwner(client)
    }
  })
})

test('ownership history reads authorize through the existing membership root only', async () => {
  await withTx(async (client) => {
    const [accountId] = await seedAccounts(client, [{ name: 'Owned', owner: 'Shrey' }])
    const { householdId, parties } = await seedEconomic(client)
    await reconcile(client, {
      manifestRef: 'SHR154-history-read',
      householdId,
      assignments: [
        { account_id: accountId, ownership_kind: 'personal', owner_party_id: parties[0] },
      ],
    })

    await actAs(client, 'authenticated', SHREY_ID)
    const { rows: member } = await client.query('select * from public.account_ownership_history')
    assert.equal(member.length, 1, 'a household member reads ownership history')
    // Run records are release evidence, not household record: no API read at
    // all, the same posture audit_events and SHR-194's run records take.
    await expectReject(
      client,
      () => client.query('select * from public.account_ownership_reconciliation_runs'),
      /permission denied/i
    )
    await asOwner(client)

    await actAs(client, 'authenticated', OUTSIDER_ID)
    const { rows: outsider } = await client.query('select * from public.account_ownership_history')
    assert.deepEqual(outsider, [], 'a non-member reads nothing')
    await asOwner(client)

    await actAs(client, 'anon')
    await expectReject(
      client,
      () => client.query('select * from public.account_ownership_history'),
      /permission denied/i
    )
    await asOwner(client)
  })
})

test('the exact SHR-154 privilege matrix', async () => {
  await withTx(async (client) => {
    const { rows: tables } = await client.query(
      `select c.relname as table_name, r.rolname as role,
              has_table_privilege(r.rolname, c.oid, 'select') as sel,
              has_table_privilege(r.rolname, c.oid, 'insert') as ins,
              has_table_privilege(r.rolname, c.oid, 'update') as upd,
              has_table_privilege(r.rolname, c.oid, 'delete') as del
         from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
         cross join (select unnest(array['anon','authenticated','service_role']) as rolname) r
        where n.nspname = 'public'
          and c.relname in ('account_ownership_history',
                            'account_ownership_reconciliation_runs',
                            'v_account_ownership_v2')
        order by c.relname, r.rolname`
    )
    const matrix = Object.fromEntries(
      tables.map((row) => [`${row.table_name}:${row.role}`, [row.sel, row.ins, row.upd, row.del]])
    )
    assert.deepEqual(matrix, {
      'account_ownership_history:anon': [false, false, false, false],
      'account_ownership_history:authenticated': [true, false, false, false],
      'account_ownership_history:service_role': [true, false, false, false],
      'account_ownership_reconciliation_runs:anon': [false, false, false, false],
      'account_ownership_reconciliation_runs:authenticated': [false, false, false, false],
      'account_ownership_reconciliation_runs:service_role': [true, false, false, false],
      'v_account_ownership_v2:anon': [false, false, false, false],
      'v_account_ownership_v2:authenticated': [true, false, false, false],
      'v_account_ownership_v2:service_role': [true, false, false, false],
    })

    const { rows: functions } = await client.query(
      `select p.proname, r.rolname as role,
              has_function_privilege(r.rolname, p.oid, 'execute') as can_execute
         from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
         cross join (select unnest(array['anon','authenticated','service_role']) as rolname) r
        where (n.nspname = 'private' and p.proname like '%account_ownership%')
           or (n.nspname = 'public' and p.proname = 'canonical_balance_sheet_v2')
        order by p.proname, r.rolname`
    )
    for (const row of functions) {
      if (row.proname === 'canonical_balance_sheet_v2') {
        assert.equal(
          row.can_execute,
          row.role !== 'anon',
          'the read adapter matches canonical_balance_sheet exactly'
        )
      } else {
        assert.equal(row.can_execute, false, `${row.proname} must be unreachable by ${row.role}`)
      }
    }
  })
})

test('the inlined operator predicate is exactly SHR-193\'s, and reaches no further', async () => {
  await withTx(async (client) => {
    // The accounts guard inlines the operator expression instead of calling
    // private.economic_identity_operator_authority(), because it is reached by
    // unprivileged roles. Inlining is only safe while the two agree, so this
    // pins that they do — for the operator and for every API role.
    const { rows: owner } = await client.query(`
      select private.economic_identity_operator_authority() as shared,
             pg_catalog.pg_has_role(
               current_user,
               (select c.relowner from pg_catalog.pg_class c
                  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
                 where n.nspname = 'public' and c.relname = 'economic_parties'),
               'USAGE') as inlined
    `)
    assert.equal(owner[0].shared, true)
    assert.equal(owner[0].inlined, owner[0].shared)

    for (const role of ['anon', 'authenticated', 'service_role']) {
      await actAs(client, role, role === 'authenticated' ? SHREY_ID : null)
      const { rows } = await client.query(`
        select pg_catalog.pg_has_role(
                 current_user,
                 (select c.relowner from pg_catalog.pg_class c
                    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
                   where n.nspname = 'public' and c.relname = 'economic_parties'),
                 'USAGE') as inlined
      `)
      assert.equal(rows[0].inlined, false, `${role} is not the operator authority`)
      await asOwner(client)
    }
  })
})

test('the authorization root is untouched and SHR-154 invents no role', async () => {
  await withTx(async (client) => {
    const { rows: roots } = await client.query(`
      select p.proname
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'private' and p.proname = 'is_household_member'
    `)
    assert.equal(roots.length, 1, 'the one authorization predicate still exists, alone')

    const { rows: invented } = await client.query(`
      select rolname from pg_roles
      where rolname ~* '(owner|party|ownership|economic|taxonomy|admin)'
        and rolname not like 'pg\\_%'
    `)
    assert.deepEqual(invented, [], 'no ownership or party role exists')

    const { rows: accountsPolicies } = await client.query(`
      select policyname, cmd, roles::text, coalesce(qual, '') as qual
      from pg_policies where schemaname = 'public' and tablename = 'accounts'
      order by policyname
    `)
    assert.deepEqual(accountsPolicies, [
      {
        policyname: 'household_all',
        cmd: 'ALL',
        roles: '{authenticated}',
        qual: 'private.is_household_member()',
      },
    ])
  })
})

// ── D. Reconciliation ──────────────────────────────────────────────────────

test('the preflight proves the exact current ownership state and writes nothing', async () => {
  await withTx(async (client) => {
    const ids = await seedAccounts(client, [
      { name: 'A', owner: 'Shrey' },
      { name: 'B', owner: 'Joint' },
    ])
    const { householdId, parties } = await seedEconomic(client)

    const before = await preflight(client)
    assert.equal(before.account_count, 2)
    assert.equal(before.unreconciled_account_count, 2)
    assert.equal(before.personal_account_count, 0)
    assert.equal(before.household_account_count, 0)
    assert.equal(before.economic_party_count, 2)
    assert.equal(before.reconciliation_run_count, 0)
    assert.match(before.account_state_digest, /^sha256:[0-9a-f]{64}$/)
    assert.deepEqual(await counts(client), { history: 0, runs: 0, audit: 0, reconciled: 0 })

    await reconcile(client, {
      manifestRef: 'SHR154-preflight',
      householdId,
      assignments: [
        { account_id: ids[0], ownership_kind: 'personal', owner_party_id: parties[0] },
        { account_id: ids[1], ownership_kind: 'household' },
      ],
    })

    const after = await preflight(client)
    assert.equal(after.unreconciled_account_count, 0)
    assert.equal(after.personal_account_count, 1)
    assert.equal(after.household_account_count, 1)
    assert.equal(after.ownership_decision_count, 2)
    assert.equal(after.reconciliation_run_count, 1)
    assert.notEqual(after.account_state_digest, before.account_state_digest)
  })
})

test('the digest moves when an account is added, removed or relabelled', async () => {
  await withTx(async (client) => {
    const ids = await seedAccounts(client, [{ name: 'A', owner: 'Shrey' }])
    const base = (await preflight(client)).account_state_digest

    await client.query(`update public.accounts set owner = 'Tarika' where id = $1`, [ids[0]])
    const relabelled = (await preflight(client)).account_state_digest
    assert.notEqual(relabelled, base, 'the label a reviewer read is part of the evidence')

    await seedAccounts(client, [{ name: 'B', owner: 'Joint' }])
    const added = (await preflight(client)).account_state_digest
    assert.notEqual(added, relabelled)

    await client.query('delete from public.accounts where id = $1', [ids[0]])
    const removed = (await preflight(client)).account_state_digest
    assert.notEqual(removed, added)
  })
})

test('a stale account count aborts the release before any DML', async () => {
  await withTx(async (client) => {
    const [accountId] = await seedAccounts(client, [{ name: 'A', owner: 'Shrey' }])
    const { householdId } = await seedEconomic(client)
    await expectReject(
      client,
      () =>
        reconcile(client, {
          manifestRef: 'SHR154-stale-count',
          householdId,
          assignments: [{ account_id: accountId, ownership_kind: 'household' }],
          expected: { accountCount: 9 },
        }),
      /SHR154_PREFLIGHT_ACCOUNT_COUNT_STALE/
    )
    assert.deepEqual(await counts(client), { history: 0, runs: 0, audit: 0, reconciled: 0 })
  })
})

test('stale ownership evidence aborts the release before any DML', async () => {
  await withTx(async (client) => {
    const [accountId] = await seedAccounts(client, [{ name: 'A', owner: 'Shrey' }])
    const { householdId } = await seedEconomic(client)
    await expectReject(
      client,
      () =>
        reconcile(client, {
          manifestRef: 'SHR154-stale-digest',
          householdId,
          assignments: [{ account_id: accountId, ownership_kind: 'household' }],
          expected: { stateDigest: `sha256:${'0'.repeat(64)}` },
        }),
      /SHR154_PREFLIGHT_OWNERSHIP_STALE/
    )
    assert.deepEqual(await counts(client), { history: 0, runs: 0, audit: 0, reconciled: 0 })
  })
})

test('an unexpected reconciliation state aborts the release before any DML', async () => {
  await withTx(async (client) => {
    const [accountId] = await seedAccounts(client, [{ name: 'A', owner: 'Shrey' }])
    const { householdId } = await seedEconomic(client)
    await expectReject(
      client,
      () =>
        reconcile(client, {
          manifestRef: 'SHR154-stale-state',
          householdId,
          assignments: [{ account_id: accountId, ownership_kind: 'household' }],
          expected: { runCount: 3 },
        }),
      /SHR154_PREFLIGHT_RECONCILIATION_STATE_STALE/
    )
    await expectReject(
      client,
      () =>
        reconcile(client, {
          manifestRef: 'SHR154-stale-state-2',
          householdId,
          assignments: [{ account_id: accountId, ownership_kind: 'household' }],
          expected: { unreconciledCount: 0 },
        }),
      /SHR154_PREFLIGHT_RECONCILIATION_STATE_STALE/
    )
    assert.deepEqual(await counts(client), { history: 0, runs: 0, audit: 0, reconciled: 0 })
  })
})

test('every account needs an explicit decision — none is left implicitly unreconciled', async () => {
  await withTx(async (client) => {
    const ids = await seedAccounts(client, [
      { name: 'A', owner: 'Shrey' },
      { name: 'B', owner: 'Tarika' },
    ])
    const { householdId, parties } = await seedEconomic(client)

    await expectReject(
      client,
      () =>
        reconcile(client, {
          manifestRef: 'SHR154-partial',
          householdId,
          assignments: [
            { account_id: ids[0], ownership_kind: 'personal', owner_party_id: parties[0] },
          ],
        }),
      /SHR154_MANIFEST_ASSIGNMENTS_DO_NOT_COVER_ACCOUNTS/
    )
    assert.deepEqual(await counts(client), { history: 0, runs: 0, audit: 0, reconciled: 0 })
  })
})

test('a duplicated or unknown account in the manifest fails closed', async () => {
  await withTx(async (client) => {
    const ids = await seedAccounts(client, [
      { name: 'A', owner: 'Shrey' },
      { name: 'B', owner: 'Tarika' },
    ])
    const { householdId, parties } = await seedEconomic(client)

    await expectReject(
      client,
      () =>
        reconcile(client, {
          manifestRef: 'SHR154-dup',
          householdId,
          assignments: [
            { account_id: ids[0], ownership_kind: 'personal', owner_party_id: parties[0] },
            { account_id: ids[0], ownership_kind: 'household' },
          ],
        }),
      /SHR154_MANIFEST_DUPLICATE_ACCOUNT/
    )

    await expectReject(
      client,
      () =>
        reconcile(client, {
          manifestRef: 'SHR154-unknown',
          householdId,
          assignments: [
            { account_id: ids[0], ownership_kind: 'personal', owner_party_id: parties[0] },
            { account_id: '00000000-0000-0000-0000-0000000000ff', ownership_kind: 'household' },
          ],
        }),
      /SHR154_MANIFEST_ASSIGNMENTS_DO_NOT_COVER_ACCOUNTS/
    )
    assert.deepEqual(await counts(client), { history: 0, runs: 0, audit: 0, reconciled: 0 })
  })
})

test('a manifest naming an unknown economic household is refused', async () => {
  await withTx(async (client) => {
    const [accountId] = await seedAccounts(client, [{ name: 'A', owner: 'Shrey' }])
    await expectReject(
      client,
      () =>
        reconcile(client, {
          manifestRef: 'SHR154-no-household',
          householdId: '00000000-0000-0000-0000-0000000000aa',
          assignments: [{ account_id: accountId, ownership_kind: 'household' }],
        }),
      /SHR154_MANIFEST_HOUSEHOLD_UNKNOWN/
    )
  })
})

test('a failed manifest writes nothing at all — not one account, decision or run', async () => {
  await withTx(async (client) => {
    const ids = await seedAccounts(client, [
      { name: 'A', owner: 'Shrey' },
      { name: 'B', owner: 'Tarika' },
      { name: 'C', owner: 'Joint' },
    ])
    const { householdId, parties } = await seedEconomic(client)

    // The third assignment is invalid, and it is reached only after the first
    // two have already been written inside the same transaction.
    await expectReject(
      client,
      () =>
        reconcile(client, {
          manifestRef: 'SHR154-atomic',
          householdId,
          assignments: [
            { account_id: ids[0], ownership_kind: 'personal', owner_party_id: parties[0] },
            { account_id: ids[1], ownership_kind: 'household' },
            { account_id: ids[2], ownership_kind: 'personal' },
          ],
        }),
      /SHR154_PERSONAL_OWNERSHIP_REQUIRES_PARTY/
    )
    assert.deepEqual(await counts(client), { history: 0, runs: 0, audit: 0, reconciled: 0 })
  })
})

test('re-applying the same approved manifest is a replay that writes nothing new', async () => {
  await withTx(async (client) => {
    const [accountId] = await seedAccounts(client, [{ name: 'A', owner: 'Shrey' }])
    const { householdId, parties } = await seedEconomic(client)
    const assignments = [
      { account_id: accountId, ownership_kind: 'personal', owner_party_id: parties[0] },
    ]

    const first = await reconcile(client, {
      manifestRef: 'SHR154-replay',
      householdId,
      assignments,
    })
    assert.equal(first.replayed, false)
    const afterFirst = await counts(client)

    const second = await reconcile(client, {
      manifestRef: 'SHR154-replay',
      householdId,
      assignments,
      // Deliberately stale expectations: a replay short-circuits before the
      // preflight, because it is proving "already applied", not "still valid".
      expected: { accountCount: 999, stateDigest: `sha256:${'1'.repeat(64)}` },
    })
    assert.equal(second.replayed, true)
    assert.deepEqual(await counts(client), afterFirst, 'a replay performs no DML')
  })
})

test('the same manifest reference carrying different content is a hard conflict', async () => {
  await withTx(async (client) => {
    const [accountId] = await seedAccounts(client, [{ name: 'A', owner: 'Shrey' }])
    const { householdId, parties } = await seedEconomic(client)
    await reconcile(client, {
      manifestRef: 'SHR154-conflict',
      householdId,
      assignments: [
        { account_id: accountId, ownership_kind: 'personal', owner_party_id: parties[0] },
      ],
    })

    await expectReject(
      client,
      () =>
        reconcile(client, {
          manifestRef: 'SHR154-conflict',
          householdId,
          assignments: [
            { account_id: accountId, ownership_kind: 'personal', owner_party_id: parties[1] },
          ],
        }),
      /SHR154_MANIFEST_CONFLICT/
    )
    assert.equal((await accountRow(client, accountId)).owner_party_id, parties[0])
  })
})

test('re-applying a decision already exactly in force is an explicit no-op', async () => {
  await withTx(async (client) => {
    const [accountId] = await seedAccounts(client, [{ name: 'A', owner: 'Shrey' }])
    const { householdId, parties } = await seedEconomic(client)
    await client.query(`select private.set_account_ownership_v1($1, 'personal', $2, $3, 'x', null)`, [
      accountId,
      parties[0],
      householdId,
    ])

    const { rows } = await client.query(
      `select * from private.set_account_ownership_v1($1, 'personal', $2, $3, 'x', null)`,
      [accountId, parties[0], householdId]
    )
    assert.equal(rows[0].changed, false)
    assert.equal(rows[0].action_code, 'account.ownership.unchanged')
    assert.equal(rows[0].decision_version, 1)
    const { rows: history } = await client.query(
      'select count(*)::integer as n from public.account_ownership_history'
    )
    assert.equal(history[0].n, 1, 'a no-op appends no history')
  })
})

test('nothing is inferred from the legacy label: identical labels can be different parties', async () => {
  await withTx(async (client) => {
    const ids = await seedAccounts(client, [
      { name: 'One', owner: 'Shrey' },
      { name: 'Two', owner: 'Shrey' },
      { name: 'Three', owner: 'Shrey' },
    ])
    const { householdId, parties } = await seedEconomic(client)

    // Three accounts with the identical legacy label reach three different
    // economic outcomes, because a human said so and the label said nothing.
    await reconcile(client, {
      manifestRef: 'SHR154-labels-mean-nothing',
      householdId,
      assignments: [
        { account_id: ids[0], ownership_kind: 'personal', owner_party_id: parties[0] },
        { account_id: ids[1], ownership_kind: 'personal', owner_party_id: parties[1] },
        { account_id: ids[2], ownership_kind: 'household' },
      ],
    })

    assert.equal((await accountRow(client, ids[0])).owner_party_id, parties[0])
    assert.equal((await accountRow(client, ids[1])).owner_party_id, parties[1])
    assert.equal((await accountRow(client, ids[2])).ownership_kind, 'household')
  })
})

test('no SHR-154 function reads a legacy owner label or any financial history to decide ownership', async () => {
  await withTx(async (client) => {
    const { rows } = await client.query(`
      select p.proname, pg_get_functiondef(p.oid) as def
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'private'
        and p.proname in ('set_account_ownership_v1', 'reconcile_account_ownership_v1',
                          'guard_account_ownership_reference')
    `)
    assert.equal(rows.length, 3)
    for (const fn of rows) {
      for (const forbidden of [
        /\bfrom public\.transactions\b/,
        /\bfrom public\.income\b/,
        /\bfrom public\.goals\b/,
        /\bfrom public\.recurring\b/,
        /\bfrom public\.settings\b/,
        /income_split/,
        /\ba\.owner\b/,
      ]) {
        assert.ok(
          !forbidden.test(fn.def),
          `${fn.proname} must not consult ${forbidden} to decide ownership`
        )
      }
    }
  })
})

// ── E. Shared semantics ────────────────────────────────────────────────────

test('a shared account is counted once and never allocated to a party', async () => {
  await withTx(async (client) => {
    const ids = await seedAccounts(client, [
      { name: 'Shrey personal', owner: 'Shrey', value: 300 },
      { name: 'Tarika personal', owner: 'Tarika', value: 100 },
      { name: 'Shared', owner: 'Joint', value: 1000 },
    ])
    const { householdId, parties } = await seedEconomic(client)
    await reconcile(client, {
      manifestRef: 'SHR154-shared-once',
      householdId,
      assignments: [
        { account_id: ids[0], ownership_kind: 'personal', owner_party_id: parties[0] },
        { account_id: ids[1], ownership_kind: 'personal', owner_party_id: parties[1] },
        { account_id: ids[2], ownership_kind: 'household' },
      ],
    })

    const household = (await client.query(`select * from public.canonical_balance_sheet_v2()`))
      .rows[0]
    assert.equal(Number(household.assets_aed), 1400, 'the shared account is counted exactly once')
    assert.equal(Number(household.scoped_account_count), 3)
    assert.equal(Number(household.shared_account_count), 1)

    const first = (
      await client.query(`select * from public.canonical_balance_sheet_v2('party', $1)`, [parties[0]])
    ).rows[0]
    const second = (
      await client.query(`select * from public.canonical_balance_sheet_v2('party', $1)`, [parties[1]])
    ).rows[0]

    assert.equal(Number(first.assets_aed), 300)
    assert.equal(Number(second.assets_aed), 100)

    // No 50/50 and no 69/31: party scopes deliberately do NOT reconstruct the
    // household total, because the shared account belongs to neither of them.
    assert.equal(
      Number(first.assets_aed) + Number(second.assets_aed),
      400,
      'party scopes sum to the personal facts only, never to the household total'
    )
    assert.notEqual(Number(first.assets_aed), 1400 * 0.69)
    assert.notEqual(Number(first.assets_aed), 700)
  })
})

test('an unreconciled account is never guessed into a party scope, and is reported', async () => {
  await withTx(async (client) => {
    const ids = await seedAccounts(client, [
      { name: 'Known', owner: 'Shrey', value: 500 },
      { name: 'Unknown', owner: 'Shrey', value: 900 },
    ])
    const { householdId, parties } = await seedEconomic(client)
    await client.query(`select private.set_account_ownership_v1($1, 'personal', $2, $3, 'x', null)`, [
      ids[0],
      parties[0],
      householdId,
    ])

    const party = (
      await client.query(`select * from public.canonical_balance_sheet_v2('party', $1)`, [parties[0]])
    ).rows[0]
    assert.equal(Number(party.assets_aed), 500, 'only the explicit personal fact')
    assert.equal(Number(party.unreconciled_account_count), 1)
    assert.equal(party.ownership_coverage_status, 'unreconciled_accounts_present')

    const household = (await client.query(`select * from public.canonical_balance_sheet_v2()`))
      .rows[0]
    assert.equal(Number(household.assets_aed), 1400, 'the household total is still complete')
    assert.equal(household.ownership_coverage_status, 'unreconciled_accounts_present')
    assert.equal(ids.length, 2)
  })
})

test('the wealth adapter refuses a malformed scope rather than guessing one', async () => {
  await withTx(async (client) => {
    await seedAccounts(client, [{ name: 'A', owner: 'Shrey', value: 10 }])
    const { parties } = await seedEconomic(client)

    for (const [scope, party] of [
      ['party', null],
      ['household', parties[0]],
      ['person', null],
      ['everyone', null],
    ]) {
      const { rows } = await client.query(
        `select * from public.canonical_balance_sheet_v2($1, $2)`,
        [scope, party]
      )
      assert.deepEqual(rows, [], `scope ${scope} with party ${party} returns nothing`)
    }
  })
})

// ── F. Evidence and history ────────────────────────────────────────────────

test('a full ownership lifecycle keeps every decision version, in order, forever', async () => {
  await withTx(async (client) => {
    const [accountId] = await seedAccounts(client, [{ name: 'Moves around', owner: 'Shrey' }])
    const { householdId, parties } = await seedEconomic(client)

    await client.query(`select private.set_account_ownership_v1($1, 'personal', $2, $3, 'v1', null)`, [
      accountId,
      parties[0],
      householdId,
    ])
    await client.query(`select private.set_account_ownership_v1($1, 'personal', $2, $3, 'v2', null)`, [
      accountId,
      parties[1],
      householdId,
    ])
    await client.query(`select private.set_account_ownership_v1($1, 'household', null, $2, 'v3', null)`, [
      accountId,
      householdId,
    ])

    const { rows } = await client.query(
      `select decision_version, action_code, previous_ownership_kind, new_ownership_kind,
              previous_owner_party_id, new_owner_party_id, decision_evidence_ref
         from public.account_ownership_history
        where account_id = $1 order by decision_version`,
      [accountId]
    )
    assert.deepEqual(
      rows.map((r) => [
        r.decision_version,
        r.action_code,
        r.previous_ownership_kind,
        r.new_ownership_kind,
        r.previous_owner_party_id,
        r.new_owner_party_id,
        r.decision_evidence_ref,
      ]),
      [
        [1, 'account.ownership.assigned', 'unreconciled', 'personal', null, parties[0], 'v1'],
        [2, 'account.ownership.changed', 'personal', 'personal', parties[0], parties[1], 'v2'],
        [3, 'account.ownership.changed', 'personal', 'household', parties[1], null, 'v3'],
      ]
    )
  })
})

test('ownership history and run records are immutable and undeletable for every role', async () => {
  await withTx(async (client) => {
    const [accountId] = await seedAccounts(client, [{ name: 'A', owner: 'Shrey' }])
    const { householdId, parties } = await seedEconomic(client)
    await reconcile(client, {
      manifestRef: 'SHR154-immutable',
      householdId,
      assignments: [
        { account_id: accountId, ownership_kind: 'personal', owner_party_id: parties[0] },
      ],
    })

    // The operator authority itself is refused, not merely the API roles.
    await expectReject(
      client,
      () =>
        client.query(
          `update public.account_ownership_history set new_ownership_kind = 'household'`
        ),
      /SHR154_OWNERSHIP_EVIDENCE_IMMUTABLE/
    )
    await expectReject(
      client,
      () => client.query('delete from public.account_ownership_history'),
      /SHR154_OWNERSHIP_EVIDENCE_DELETE_FORBIDDEN/
    )
    await expectReject(
      client,
      () =>
        client.query(
          `update public.account_ownership_reconciliation_runs set manifest_ref = 'other'`
        ),
      /SHR154_OWNERSHIP_EVIDENCE_IMMUTABLE/
    )
    await expectReject(
      client,
      () => client.query('delete from public.account_ownership_reconciliation_runs'),
      /SHR154_OWNERSHIP_EVIDENCE_DELETE_FORBIDDEN/
    )
    await expectReject(
      client,
      () => client.query('truncate public.account_ownership_history'),
      /SHR154_OWNERSHIP_EVIDENCE_TRUNCATE_FORBIDDEN/
    )
  })
})

test('history cannot describe a state the accounts table itself would refuse', async () => {
  await withTx(async (client) => {
    const [accountId] = await seedAccounts(client, [{ name: 'A', owner: 'Shrey' }])
    const { householdId, parties } = await seedEconomic(client)

    // A personal decision with no party, a shared decision with one, and a
    // regression to unreconciled are all structurally impossible in history.
    const cases = [
      // A personal decision naming no party.
      {
        values: [accountId, 1, 'account.ownership.assigned', 'unreconciled', 'personal', null, null, householdId],
        matcher: /account_ownership_history_shape_check/,
      },
      // A shared decision naming one.
      {
        values: [accountId, 1, 'account.ownership.assigned', 'unreconciled', 'household', null, parties[0], householdId],
        matcher: /account_ownership_history_shape_check/,
      },
      // A decision un-making itself back to unknown.
      {
        values: [accountId, 1, 'account.ownership.changed', 'personal', 'unreconciled', parties[0], null, householdId],
        matcher: /account_ownership_history_progress_check/,
      },
      // A first assignment claiming it followed an earlier decision.
      {
        values: [accountId, 2, 'account.ownership.assigned', 'personal', 'household', parties[0], null, householdId],
        matcher: /account_ownership_history_progress_check/,
      },
    ]
    for (const { values, matcher } of cases) {
      await expectReject(
        client,
        () =>
          client.query(
            `insert into public.account_ownership_history
               (account_id, decision_version, action_code, previous_ownership_kind,
                new_ownership_kind, previous_owner_party_id, new_owner_party_id,
                economic_household_id)
             values ($1, $2, $3, $4, $5, $6, $7, $8)`,
            values
          ),
        matcher
      )
    }
  })
})

test('SHR-154 writes no audit event and changes no SHR-191/194 audit contract', async () => {
  await withTx(async (client) => {
    const { rows: before } = await client.query(
      `select conname, pg_get_constraintdef(oid) as def from pg_constraint
        where conrelid = 'public.audit_events'::regclass order by conname`
    )

    const [accountId] = await seedAccounts(client, [{ name: 'A', owner: 'Shrey' }])
    const { householdId, parties } = await seedEconomic(client)
    await reconcile(client, {
      manifestRef: 'SHR154-no-audit',
      householdId,
      assignments: [
        { account_id: accountId, ownership_kind: 'personal', owner_party_id: parties[0] },
      ],
    })

    assert.equal((await counts(client)).audit, 0, 'no audit event is written')

    const { rows: after } = await client.query(
      `select conname, pg_get_constraintdef(oid) as def from pg_constraint
        where conrelid = 'public.audit_events'::regclass order by conname`
    )
    assert.deepEqual(after, before, 'audit_events constraints are untouched by SHR-154')

    // And no parallel audit table has been invented in its place.
    const { rows: parallel } = await client.query(`
      select tablename from pg_tables
      where schemaname = 'public' and tablename ~* 'audit' and tablename <> 'audit_events'
    `)
    assert.deepEqual(parallel, [], 'there is exactly one audit table and SHR-154 did not add one')
  })
})

// ── G. Backup and restore ──────────────────────────────────────────────────

test('the encrypted backup covers the new ownership evidence and a restore preserves it', async () => {
  await withTx(async (client) => {
    const ids = await seedAccounts(client, [
      { name: 'Personal', owner: 'Shrey', value: 10 },
      { name: 'Shared', owner: 'Joint', value: 20 },
    ])
    const { householdId, parties } = await seedEconomic(client)
    await reconcile(client, {
      manifestRef: 'SHR154-backup',
      householdId,
      assignments: [
        { account_id: ids[0], ownership_kind: 'personal', owner_party_id: parties[0] },
        { account_id: ids[1], ownership_kind: 'household' },
      ],
    })
    // A second decision, so the restore has real history to lose.
    await client.query(`select private.set_account_ownership_v1($1, 'personal', $2, $3, 'moved', null)`, [
      ids[0],
      parties[1],
      householdId,
    ])

    const names = BACKUP_TABLES.map((table) => table.name)
    assert.ok(names.includes('account_ownership_history'))
    assert.ok(names.includes('account_ownership_reconciliation_runs'))
    assert.ok(
      names.indexOf('economic_parties') < names.indexOf('accounts'),
      'accounts restore after the parties a reconciled account references'
    )

    const doc = await buildBackup(
      async (table) => {
        const { rows } = await client.query(`select * from public.${table}`)
        return rows
      },
      null,
      () => new Date().toISOString()
    )
    assert.equal(doc.tables.account_ownership_history.length, 3)
    assert.equal(doc.tables.account_ownership_reconciliation_runs.length, 1)
    assert.equal(doc.meta.row_counts.account_ownership_history, 3)

    // Restore the evidence into a clean table carrying the production
    // constraints, in the manifest's order, and compare exactly.
    await client.query(`
      create temporary table restored_history
        (like public.account_ownership_history including all) on commit drop
    `)
    for (const row of doc.tables.account_ownership_history) {
      await client.query(
        `insert into restored_history select * from jsonb_populate_record(
           null::public.account_ownership_history, $1::jsonb)`,
        [JSON.stringify(row)]
      )
    }
    const { rows: restored } = await client.query(
      `select account_id, decision_version, action_code, previous_ownership_kind,
              new_ownership_kind, previous_owner_party_id, new_owner_party_id, decided_at
         from restored_history order by account_id, decision_version`
    )
    const { rows: original } = await client.query(
      `select account_id, decision_version, action_code, previous_ownership_kind,
              new_ownership_kind, previous_owner_party_id, new_owner_party_id, decided_at
         from public.account_ownership_history order by account_id, decision_version`
    )
    assert.deepEqual(restored, original, 'every decision version survives, in order')

    // A restore that lost the middle decision would produce a plausible but
    // false history; the shape rules still refuse one.
    await expectReject(
      client,
      () =>
        client.query(
          `insert into restored_history
             (account_id, decision_version, action_code, previous_ownership_kind,
              new_ownership_kind, previous_owner_party_id, new_owner_party_id,
              economic_household_id)
           values ($1, 9, 'account.ownership.assigned', 'personal', 'household', $2, null, $3)`,
          [ids[0], parties[0], householdId]
        ),
      /account_ownership_history_progress_check/
    )
  })
})

test('a restore can re-import an account owned by an already-archived party, once', async () => {
  await withTx(async (client) => {
    const [accountId] = await seedAccounts(client, [{ name: 'Historic', owner: 'Shrey' }])
    const { householdId, parties } = await seedEconomic(client)
    await client.query(`select private.set_account_ownership_v1($1, 'personal', $2, $3, 'x', null)`, [
      accountId,
      parties[0],
      householdId,
    ])
    await client.query(
      `update public.economic_parties set archived_at = now() where party_id = $1`,
      [parties[0]]
    )

    const original = await accountRow(client, accountId)
    await client.query('delete from public.accounts where id = $1', [accountId])

    // Without the explicit boundary, re-importing it fails closed.
    await expectReject(
      client,
      () =>
        client.query(
          `insert into public.accounts (id, name, owner, type, currency, value,
                                        ownership_kind, owner_party_id)
           values ($1, $2, $3, 'cash', 'AED', 0, 'personal', $4)`,
          [original.id, original.name, original.owner, parties[0]]
        ),
      /SHR154_OWNERSHIP_TO_ARCHIVED_PARTY_FORBIDDEN/
    )

    await client.query('select private.begin_account_ownership_restore_v1($1)', [original.id])
    await client.query(
      `insert into public.accounts (id, name, owner, type, currency, value,
                                    ownership_kind, owner_party_id)
       values ($1, $2, $3, 'cash', 'AED', 0, 'personal', $4)`,
      [original.id, original.name, original.owner, parties[0]]
    )
    const restored = await accountRow(client, accountId)
    assert.equal(restored.owner_party_id, parties[0], 'the stable id survives the round trip')

    // The token is consumed: a second archived-party import is refused again.
    await expectReject(
      client,
      () =>
        client.query(
          `insert into public.accounts (name, owner, type, currency, value,
                                        ownership_kind, owner_party_id)
           values ('Second', 'Shrey', 'cash', 'AED', 0, 'personal', $1)`,
          [parties[0]]
        ),
      /SHR154_OWNERSHIP_TO_ARCHIVED_PARTY_FORBIDDEN/
    )
  })
})

test('a restore token is bound to one account and admits no other', async () => {
  await withTx(async (client) => {
    const { householdId, parties } = await seedEconomic(client)
    await client.query(
      `update public.economic_parties set archived_at = now() where party_id = $1`,
      [parties[0]]
    )
    assert.ok(householdId)

    await client.query('select private.begin_account_ownership_restore_v1($1)', [
      '00000000-0000-0000-0000-0000000000bb',
    ])
    await expectReject(
      client,
      () =>
        client.query(
          `insert into public.accounts (name, owner, type, currency, value,
                                        ownership_kind, owner_party_id)
           values ('Different row', 'Shrey', 'cash', 'AED', 0, 'personal', $1)`,
          [parties[0]]
        ),
      /SHR154_OWNERSHIP_TO_ARCHIVED_PARTY_FORBIDDEN/
    )
  })
})

test('the restore boundary never admits an UPDATE, only an INSERT', async () => {
  await withTx(async (client) => {
    const [accountId] = await seedAccounts(client, [{ name: 'A', owner: 'Shrey' }])
    const { parties } = await seedEconomic(client)
    await client.query(
      `update public.economic_parties set archived_at = now() where party_id = $1`,
      [parties[0]]
    )

    await client.query('select private.begin_account_ownership_restore_v1($1)', [accountId])
    await expectReject(
      client,
      () =>
        client.query(
          `update public.accounts set ownership_kind = 'personal', owner_party_id = $2 where id = $1`,
          [accountId, parties[0]]
        ),
      /SHR154_OWNERSHIP_TO_ARCHIVED_PARTY_FORBIDDEN/
    )
  })
})

test('an ordinary ownership decision is refused outright if the restore token is set', async () => {
  await withTx(async (client) => {
    const [accountId] = await seedAccounts(client, [{ name: 'A', owner: 'Shrey' }])
    const { householdId, parties } = await seedEconomic(client)

    await client.query('select private.begin_account_ownership_restore_v1($1)', [accountId])
    await expectReject(
      client,
      () =>
        client.query(
          `select private.set_account_ownership_v1($1, 'personal', $2, $3, 'x', null)`,
          [accountId, parties[0], householdId]
        ),
      /SHR154_RESTORE_TOKEN_SET_ON_ORDINARY_DECISION/
    )
  })
})

test('no SHR-154 writer calls the restore boundary or sets its token', async () => {
  await withTx(async (client) => {
    const { rows } = await client.query(`
      select p.proname, pg_get_functiondef(p.oid) as def
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'private'
        and p.proname in ('set_account_ownership_v1', 'reconcile_account_ownership_v1')
    `)
    assert.equal(rows.length, 2)
    for (const fn of rows) {
      assert.ok(
        !/begin_account_ownership_restore_v1/.test(fn.def),
        `${fn.proname} must not call the restore boundary`
      )
      assert.ok(
        !/set_config\s*\(\s*'shr154\.restore_account_id'/.test(fn.def),
        `${fn.proname} must not set the restore token`
      )
      assert.ok(
        !/restore_access_party_mapping_v1|shr193\.restore_mapping_id/.test(fn.def),
        `${fn.proname} must not reach SHR-193's restore boundary either`
      )
    }
  })
})

test('SHR-193 and SHR-194 objects are unchanged by SHR-154', async () => {
  await withTx(async (client) => {
    // A guard on the accounts table must not have disturbed the identity
    // substrate's own guards, its restore boundary, or its refusals.
    const { rows } = await client.query(`
      select p.proname
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'private'
        and p.proname in ('guard_economic_party_lifecycle',
                          'guard_access_party_mapping_lifecycle',
                          'restore_access_party_mapping_v1',
                          'reconcile_access_parties_v1',
                          'set_access_party_mapping_v1',
                          'economic_identity_operator_authority')
      order by p.proname
    `)
    assert.deepEqual(rows.map((r) => r.proname), [
      'economic_identity_operator_authority',
      'guard_access_party_mapping_lifecycle',
      'guard_economic_party_lifecycle',
      'reconcile_access_parties_v1',
      'restore_access_party_mapping_v1',
      'set_access_party_mapping_v1',
    ])

    const { householdId, parties } = await seedEconomic(client)
    // Party deletion is still refused, which is what makes an ownership
    // reference permanently resolvable.
    await expectReject(
      client,
      () => client.query('delete from public.economic_parties where party_id = $1', [parties[0]]),
      /SHR193_ECONOMIC_PARTY_DELETE_FORBIDDEN/
    )
    assert.ok(householdId)
  })
})

test('an owned account cannot be orphaned, and a bogus party is refused', async () => {
  await withTx(async (client) => {
    const [accountId] = await seedAccounts(client, [{ name: 'A', owner: 'Shrey' }])
    const { householdId, parties } = await seedEconomic(client)

    // Referential integrity without a foreign key: the guard resolves the party
    // itself, on the writer path and on a raw operator write alike.
    await expectReject(
      client,
      () =>
        client.query(
          `select private.set_account_ownership_v1($1, 'personal', $2, $3, 'x', null)`,
          [accountId, '00000000-0000-0000-0000-0000000000ee', householdId]
        ),
      /SHR154_OWNERSHIP_PARTY_UNKNOWN/
    )
    await expectReject(
      client,
      () =>
        client.query(
          `update public.accounts set ownership_kind = 'personal', owner_party_id = $2
            where id = $1`,
          [accountId, '00000000-0000-0000-0000-0000000000ee']
        ),
      /SHR154_OWNERSHIP_PARTY_UNKNOWN/
    )

    await client.query(`select private.set_account_ownership_v1($1, 'personal', $2, $3, 'x', null)`, [
      accountId,
      parties[0],
      householdId,
    ])

    // And the reference can never be orphaned afterwards, because SHR-193
    // refuses party deletion outright for every role.
    await expectReject(
      client,
      () => client.query('delete from public.economic_parties where party_id = $1', [parties[0]]),
      /SHR193_ECONOMIC_PARTY_DELETE_FORBIDDEN/
    )
  })
})

test('an ordinary account write is not coupled to the identity substrate', async () => {
  await withTx(async (client) => {
    // The reason owner_party_id is a typed logical reference rather than a
    // foreign key. A foreign key makes every write to accounts — every balance
    // update the app performs — take a lock on economic_parties, and makes any
    // exclusive statement on economic_parties reciprocally lock accounts. That
    // is a real deadlock surface between financial writes and identity
    // bookkeeping, and it is the failure this assertion exists to prevent
    // regressing.
    const { rows: fks } = await client.query(`
      select conname from pg_constraint
       where conrelid = 'public.accounts'::regclass
         and contype = 'f'
         and confrelid = 'public.economic_parties'::regclass
    `)
    assert.deepEqual(fks, [], 'accounts holds no foreign key into the identity substrate')

    await seedAccounts(client, [{ name: 'Ordinary', owner: 'Shrey' }])
    const { rows: locks } = await client.query(`
      select mode from pg_locks
       where pid = pg_backend_pid()
         and locktype = 'relation'
         and relation = 'public.economic_parties'::regclass
         and mode <> 'AccessShareLock'
    `)
    assert.deepEqual(locks, [], 'an ordinary account insert takes no write-blocking lock on economic_parties')
  })
})

test('the migration synthesizes no ownership decision through a column default', async () => {
  await withTx(async (client) => {
    const { rows } = await client.query(`
      select column_name, column_default, is_nullable
      from information_schema.columns
      where table_schema = 'public' and table_name = 'accounts'
        and column_name in ('ownership_kind', 'owner_party_id')
      order by column_name
    `)
    assert.deepEqual(rows, [
      { column_name: 'owner_party_id', column_default: null, is_nullable: 'YES' },
      {
        column_name: 'ownership_kind',
        column_default: "'unreconciled'::text",
        is_nullable: 'NO',
      },
    ])
  })
})
