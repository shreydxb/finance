// The idempotency contract, exercised the way both real callers issue it.
// Bug 2 (42P10) only reproduced under the PostgREST-shaped conflict target —
// raw SQL happily targeted the old partial index by repeating its predicate,
// which is exactly why it shipped with passing tests and failed live.

import assert from 'node:assert/strict'
import test from 'node:test'
import { actAs, SHREY_ID, withTx } from './helpers.mjs'

async function seedAccount(client) {
  const { rows } = await client.query(
    `insert into accounts (name, owner, type) values ('Cash', 'Shrey', 'cash') returning id`
  )
  return rows[0].id
}

test('on conflict (idempotency_key) do nothing — the exact form PostgREST issues — works with no predicate', async () => {
  await withTx(async (client) => {
    await actAs(client, 'authenticated', SHREY_ID)
    const accountId = await seedAccount(client)

    const insert = () =>
      client.query(
        `insert into transactions (date, amount, account_id, source, idempotency_key)
         values (current_date, 45, $1, 'telegram', 'tg:9:1:0')
         on conflict (idempotency_key) do nothing
         returning id`,
        [accountId]
      )

    const first = await insert()
    const replay = await insert()

    assert.equal(first.rows.length, 1)
    assert.equal(replay.rows.length, 0, 'a predicate-free on_conflict must collide on replay')
  })
})

test('manual rows with a null idempotency_key never collide with each other', async () => {
  await withTx(async (client) => {
    await actAs(client, 'authenticated', SHREY_ID)
    const accountId = await seedAccount(client)

    const insertNull = () =>
      client.query(
        `insert into transactions (date, amount, account_id, source)
         values (current_date, 10, $1, 'manual')
         on conflict (idempotency_key) do nothing
         returning id`,
        [accountId]
      )

    const a = await insertNull()
    const b = await insertNull()
    assert.equal(a.rows.length, 1)
    assert.equal(b.rows.length, 1, 'NULLs must be distinct in the unique index, or manual entry breaks')
  })
})

test('the index backing idempotency_key is unique across the whole column, not partial', async () => {
  await withTx(async (client) => {
    const { rows } = await client.query(
      `select indexdef from pg_indexes
       where tablename = 'transactions' and indexdef ilike '%idempotency_key%'`
    )
    assert.equal(rows.length, 1)
    assert.doesNotMatch(rows[0].indexdef, /where/i)
  })
})
