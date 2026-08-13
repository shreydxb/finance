// The access matrix from QA_QC_AUDIT_AND_REMEDIATION.md's SEC-02 section,
// replayed against a real, migrated schema instead of a probe run by hand
// against production. `service_role` is not tested here — it bypasses RLS by
// construction and every Edge Function already runs as it.

import assert from 'node:assert/strict'
import test from 'node:test'
import { actAs, OUTSIDER_ID, SHREY_ID, withTx } from './helpers.mjs'

async function seedOneTransaction(client) {
  await actAs(client, 'service_role') // bypasses RLS, so seeding never depends on the thing being tested
  const { rows: account } = await client.query(
    `insert into accounts (name, owner, type) values ('Cash', 'Shrey', 'cash') returning id`
  )
  await client.query(
    `insert into transactions (date, amount, account_id, category) values (current_date, 50, $1, 'Groceries')`,
    [account[0].id]
  )
}

test('a household member reads transactions', async () => {
  await withTx(async (client) => {
    await seedOneTransaction(client)
    await actAs(client, 'authenticated', SHREY_ID)
    const { rows } = await client.query('select * from transactions')
    assert.equal(rows.length, 1)
  })
})

test('an authenticated non-member reads nothing', async () => {
  await withTx(async (client) => {
    await seedOneTransaction(client)
    await actAs(client, 'authenticated', OUTSIDER_ID)
    const { rows } = await client.query('select * from transactions')
    assert.equal(rows.length, 0)
  })
})

test('a signed-out (anon) caller reads nothing', async () => {
  await withTx(async (client) => {
    await seedOneTransaction(client)
    await actAs(client, 'anon')
    const { rows } = await client.query('select * from transactions')
    assert.equal(rows.length, 0)
  })
})

test('a household member can insert; a non-member cannot', async () => {
  await withTx(async (client) => {
    await actAs(client, 'service_role')
    const { rows: account } = await client.query(
      `insert into accounts (name, owner, type) values ('Cash', 'Shrey', 'cash') returning id`
    )

    await actAs(client, 'authenticated', SHREY_ID)
    await client.query(
      `insert into transactions (date, amount, account_id, category) values (current_date, 10, $1, 'Coffee')`,
      [account[0].id]
    )

    await actAs(client, 'authenticated', OUTSIDER_ID)
    await assert.rejects(
      () =>
        client.query(
          `insert into transactions (date, amount, account_id, category) values (current_date, 10, $1, 'Coffee')`,
          [account[0].id]
        ),
      /row-level security/i
    )
  })
})

test('household_members itself is readable by members, not writable through the API', async () => {
  await withTx(async (client) => {
    await actAs(client, 'authenticated', SHREY_ID)
    const { rows } = await client.query('select * from household_members')
    assert.equal(rows.length, 2, 'both seeded auth.users rows should have been seeded as members by 023')

    await assert.rejects(
      () => client.query(`insert into household_members (user_id) values ($1)`, [OUTSIDER_ID]),
      /row-level security|permission denied/i
    )
  })
})

test('nw_daily: member can select/insert/update, but nobody can delete (no delete policy, by design)', async () => {
  await withTx(async (client) => {
    await actAs(client, 'authenticated', SHREY_ID)
    const { rows } = await client.query(
      `insert into nw_daily (day, total_aed) values (current_date, 100000) returning id`
    )
    assert.equal(rows.length, 1)

    await client.query(`update nw_daily set total_aed = 100001 where id = $1`, [rows[0].id])
    const { rows: after } = await client.query('select total_aed from nw_daily where id = $1', [
      rows[0].id,
    ])
    assert.equal(Number(after[0].total_aed), 100001)

    const del = await client.query('delete from nw_daily where id = $1', [rows[0].id])
    assert.equal(del.rowCount, 0, 'net-worth history must not be deletable through the API, ever')
  })
})

test('is_household_member() is not callable by anon (024)', async () => {
  await withTx(async (client) => {
    await actAs(client, 'anon')
    await assert.rejects(
      () => client.query('select is_household_member()'),
      /permission denied/i
    )
  })
})
