// 036_money_view.sql — v_transactions_aed, the single source every bot money
// query (Taskiv #48) sums through. FakeStore can't express this at all: it
// has no view and no jsonb ->> operator, so this is only testable against a
// real Postgres.

import assert from 'node:assert/strict'
import test from 'node:test'
import { actAs, OUTSIDER_ID, SHREY_ID, withTx } from './helpers.mjs'

async function asMember(client) {
  await actAs(client, 'authenticated', SHREY_ID)
}

async function seedAccount(client, currency = 'AED') {
  const { rows } = await client.query(
    `insert into accounts (name, owner, type, currency) values ('Cash', 'Shrey', 'cash', $1) returning id`,
    [currency]
  )
  return rows[0].id
}

async function seedViewRowAsService(client) {
  await actAs(client, 'service_role')
  const accountId = await seedAccount(client, 'AED')
  const { rows } = await client.query(
    `insert into transactions (date, amount, currency, account_id)
     values (current_date, 84, 'AED', $1) returning id`,
    [accountId]
  )
  return rows[0].id
}

test('039: an authenticated household member can read the security-invoker view', async () => {
  await withTx(async (client) => {
    const transactionId = await seedViewRowAsService(client)
    await asMember(client)
    const { rows } = await client.query(
      `select amount_aed from v_transactions_aed where id = $1`,
      [transactionId]
    )
    assert.equal(rows.length, 1)
    assert.equal(Number(rows[0].amount_aed), 84)
  })
})

test('039: an authenticated non-member cannot read through the security-invoker view', async () => {
  await withTx(async (client) => {
    const transactionId = await seedViewRowAsService(client)
    await actAs(client, 'authenticated', OUTSIDER_ID)
    const { rows } = await client.query(
      `select amount_aed from v_transactions_aed where id = $1`,
      [transactionId]
    )
    assert.deepEqual(rows, [])
  })
})

test('039: an anonymous caller has no access to the financial view', async () => {
  await withTx(async (client) => {
    await seedViewRowAsService(client)
    await actAs(client, 'anon')
    await assert.rejects(() => client.query(`select * from v_transactions_aed`), /permission denied/i)
  })
})

test('039: trusted service-role reporting retains read access', async () => {
  await withTx(async (client) => {
    const transactionId = await seedViewRowAsService(client)
    const { rows } = await client.query(
      `select amount_aed from v_transactions_aed where id = $1`,
      [transactionId]
    )
    assert.equal(rows.length, 1)
    assert.equal(Number(rows[0].amount_aed), 84)
  })
})

test('036: AED converts to itself (fx_rates seeds AED: 1)', async () => {
  await withTx(async (client) => {
    await asMember(client)
    const accountId = await seedAccount(client, 'AED')
    const { rows } = await client.query(
      `insert into transactions (date, amount, currency, account_id) values (current_date, 84, 'AED', $1) returning id`,
      [accountId]
    )

    const { rows: view } = await client.query(`select amount_aed from v_transactions_aed where id = $1`, [rows[0].id])
    assert.equal(Number(view[0].amount_aed), 84)
  })
})

test('036: a USD row converts using the live fx_rates setting', async () => {
  await withTx(async (client) => {
    await asMember(client)
    const accountId = await seedAccount(client, 'USD')
    const { rows } = await client.query(
      `insert into transactions (date, amount, currency, account_id) values (current_date, 100, 'USD', $1) returning id`,
      [accountId]
    )
    const { rows: fx } = await client.query(`select value ->> 'USD' as rate from settings where key = 'fx_rates'`)
    const rate = Number(fx[0].rate)

    const { rows: view } = await client.query(`select amount_aed from v_transactions_aed where id = $1`, [rows[0].id])
    assert.equal(Number(view[0].amount_aed), 100 * rate)
  })
})

test('036: a currency fx_rates has no rate for propagates NULL, never a 1:1 fallback', async () => {
  await withTx(async (client) => {
    await asMember(client)
    // GBP is a valid ISO currency string but nothing 001_init.sql, 005 or the
    // app constrains transactions.currency to a fixed set, so this is a real
    // shape a mistyped or future entry could take.
    const accountId = await seedAccount(client, 'AED')
    const { rows } = await client.query(
      `insert into transactions (date, amount, currency, account_id) values (current_date, 50, 'GBP', $1) returning id`,
      [accountId]
    )

    const { rows: view } = await client.query(`select amount_aed from v_transactions_aed where id = $1`, [rows[0].id])
    assert.equal(view[0].amount_aed, null, 'no silent 1:1 AED assumption for an unrated currency')
  })
})

test('036: sum() silently skips a NULL amount_aed — a caller must check for it separately, not trust the total', async () => {
  await withTx(async (client) => {
    await asMember(client)
    const accountId = await seedAccount(client, 'AED')
    await client.query(
      `insert into transactions (date, amount, currency, account_id) values (current_date, 50, 'AED', $1)`,
      [accountId]
    )
    await client.query(
      `insert into transactions (date, amount, currency, account_id) values (current_date, 20, 'GBP', $1)`,
      [accountId]
    )

    // Unlike client-side NaN, Postgres's sum() ignores NULL inputs rather than
    // propagating them — it does NOT flag the unconverted GBP row on its own.
    // This is exactly the trap the Taskiv #48 correction warns the query
    // toolbox about: a caller that only reads sum(amount_aed) sees a
    // plausible, silently-too-low total, not an error.
    const { rows: summed } = await client.query(
      `select sum(amount_aed) as total from v_transactions_aed where account_id = $1`,
      [accountId]
    )
    assert.equal(Number(summed[0].total), 50, 'sum() alone hides the unconverted row rather than surfacing it')

    // The toolbox is expected to pair every sum with a check like this one —
    // that's what actually catches the unconverted row.
    const { rows: unconverted } = await client.query(
      `select count(*) as n from v_transactions_aed where account_id = $1 and amount_aed is null`,
      [accountId]
    )
    assert.equal(Number(unconverted[0].n), 1)
  })
})

test('036: a soft-deleted row is absent from the view', async () => {
  await withTx(async (client) => {
    await asMember(client)
    const accountId = await seedAccount(client, 'AED')
    const { rows } = await client.query(
      `insert into transactions (date, amount, currency, account_id, deleted_at) values (current_date, 84, 'AED', $1, now()) returning id`,
      [accountId]
    )

    const { rows: view } = await client.query(`select 1 from v_transactions_aed where id = $1`, [rows[0].id])
    assert.equal(view.length, 0)
  })
})

test('036: the view carries the account name/type/is_liability the row belongs to', async () => {
  await withTx(async (client) => {
    await asMember(client)
    const accountId = await seedAccount(client, 'AED')
    const { rows } = await client.query(
      `insert into transactions (date, amount, currency, account_id) values (current_date, 84, 'AED', $1) returning id`,
      [accountId]
    )

    const { rows: view } = await client.query(
      `select account_name, account_type, is_liability from v_transactions_aed where id = $1`,
      [rows[0].id]
    )
    assert.equal(view[0].account_name, 'Cash')
    assert.equal(view[0].account_type, 'cash')
    assert.equal(view[0].is_liability, false)
  })
})
