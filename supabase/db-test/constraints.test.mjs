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
