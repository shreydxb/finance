// Constraint behaviour that FakeStore cannot express at all: 031's
// zero-amount invariant and 025's group-kind pairing.

import assert from 'node:assert/strict'
import test from 'node:test'
import { actAs, expectReject, SHREY_ID, withTx } from './helpers.mjs'

async function seedAccount(client) {
  const { rows } = await client.query(
    `insert into accounts (name, owner, type) values ('Cash', 'Shrey', 'cash') returning id`
  )
  return rows[0].id
}

async function asMember(client) {
  await actAs(client, 'authenticated', SHREY_ID)
}

test('031: a zero amount is allowed only while needs_review is set', async () => {
  await withTx(async (client) => {
    await asMember(client)
    const accountId = await seedAccount(client)

    await client.query(
      `insert into transactions (date, amount, account_id, needs_review) values (current_date, 0, $1, true)`,
      [accountId]
    )

    await assert.rejects(
      () =>
        client.query(
          `insert into transactions (date, amount, account_id, needs_review) values (current_date, 0, $1, false)`,
          [accountId]
        ),
      /transactions_zero_amount_flagged/
    )
  })
})

test('031: a placeholder cannot be marked reviewed while still zero', async () => {
  await withTx(async (client) => {
    await asMember(client)
    const accountId = await seedAccount(client)
    const { rows } = await client.query(
      `insert into transactions (date, amount, account_id, needs_review) values (current_date, 0, $1, true) returning id`,
      [accountId]
    )

    await assert.rejects(
      () =>
        client.query(`update transactions set reviewed_at = now() where id = $1`, [rows[0].id]),
      /transactions_reviewed_not_zero/
    )
  })
})

test('031: a non-zero amount can be reviewed freely', async () => {
  await withTx(async (client) => {
    await asMember(client)
    const accountId = await seedAccount(client)
    const { rows } = await client.query(
      `insert into transactions (date, amount, account_id) values (current_date, 25, $1) returning id`,
      [accountId]
    )
    await client.query(`update transactions set reviewed_at = now() where id = $1`, [rows[0].id])
  })
})

test('025: a transaction_group_id without a group_kind is rejected', async () => {
  await withTx(async (client) => {
    await asMember(client)
    const accountId = await seedAccount(client)
    await assert.rejects(
      () =>
        client.query(
          `insert into transactions (date, amount, account_id, transaction_group_id)
           values (current_date, 10, $1, gen_random_uuid())`,
          [accountId]
        ),
      /transactions_group_pairing/
    )
  })
})

test('025: transfer_direction is required on a transfer and forbidden elsewhere', async () => {
  await withTx(async (client) => {
    await asMember(client)
    const accountId = await seedAccount(client)

    await expectReject(
      client,
      () =>
        client.query(
          `insert into transactions (date, amount, account_id, transaction_group_id, group_kind)
           values (current_date, 10, $1, gen_random_uuid(), 'transfer')`,
          [accountId]
        ),
      /transactions_transfer_direction_valid/
    )

    await expectReject(
      client,
      () =>
        client.query(
          `insert into transactions
             (date, amount, account_id, transaction_group_id, group_kind, transfer_direction)
           values (current_date, 10, $1, gen_random_uuid(), 'category_split', 'out')`,
          [accountId]
        ),
      /transactions_transfer_direction_valid/
    )
  })
})

test('an account type outside the check list is rejected', async () => {
  await withTx(async (client) => {
    await asMember(client)
    await assert.rejects(
      () =>
        client.query(
          `insert into accounts (name, owner, type) values ('Bad', 'Shrey', 'crypto_wallet')`
        ),
      /accounts_type_check|check constraint/i
    )
  })
})

// 035: statement-cycle fields. The columns are nullable and only meaningful for
// credit cards, so the constraints have to reject nonsense without ever firing
// on the 40+ rows that legitimately leave them null.
//
// Rejections go through expectReject so each one runs inside its own savepoint
// -- a bare failed statement aborts the surrounding transaction and every
// later assertion in the test then fails for the wrong reason.

async function seedCard(client) {
  const { rows } = await client.query(
    `insert into accounts (name, owner, type, is_liability)
     values ('Card', 'Shrey', 'credit_card', true) returning id`
  )
  return rows[0].id
}

test('035: statement_day and due_day accept 1-31 and reject anything outside it', async () => {
  await withTx(async (client) => {
    await asMember(client)
    const id = await seedCard(client)

    await client.query(`update accounts set statement_day = 1, due_day = 31 where id = $1`, [id])
    await client.query(`update accounts set statement_day = 17, due_day = 5 where id = $1`, [id])

    await expectReject(
      client,
      () => client.query(`update accounts set statement_day = 0 where id = $1`, [id]),
      /accounts_statement_day_check/
    )
    await expectReject(
      client,
      () => client.query(`update accounts set statement_day = 32 where id = $1`, [id]),
      /accounts_statement_day_check/
    )
    await expectReject(
      client,
      () => client.query(`update accounts set due_day = 0 where id = $1`, [id]),
      /accounts_due_day_check/
    )
    await expectReject(
      client,
      () => client.query(`update accounts set due_day = 32 where id = $1`, [id]),
      /accounts_due_day_check/
    )
  })
})

test('035: credit_limit must be positive, so "unknown" stays distinct from "zero"', async () => {
  await withTx(async (client) => {
    await asMember(client)
    const id = await seedCard(client)

    await client.query(`update accounts set credit_limit = 20000 where id = $1`, [id])
    // Null is the "not entered yet" state and must remain allowed.
    await client.query(`update accounts set credit_limit = null where id = $1`, [id])

    await expectReject(
      client,
      () => client.query(`update accounts set credit_limit = 0 where id = $1`, [id]),
      /accounts_credit_limit_check/
    )
    await expectReject(
      client,
      () => client.query(`update accounts set credit_limit = -1 where id = $1`, [id]),
      /accounts_credit_limit_check/
    )
  })
})

test('035: the cycle columns never fire on non-card rows that leave them null', async () => {
  await withTx(async (client) => {
    await asMember(client)
    // The constraints are deliberately not conditional on type. A plain cash
    // account must insert cleanly with all three columns untouched.
    const { rows } = await client.query(
      `insert into accounts (name, owner, type) values ('Bank', 'Shrey', 'cash')
       returning statement_day, due_day, credit_limit`
    )
    assert.equal(rows[0].statement_day, null)
    assert.equal(rows[0].due_day, null)
    assert.equal(rows[0].credit_limit, null)
  })
})
