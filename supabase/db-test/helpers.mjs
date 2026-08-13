// Shared connection + isolation helpers for the db-test suite. Every test
// gets its own client and its own transaction, rolled back on close — so
// tests can run concurrently against the one database setup-db.mjs built.

import pg from 'pg'

const { Client } = pg

const adminUrl =
  process.env.DATABASE_URL || 'postgres://postgres:postgres@127.0.0.1:5432/postgres'
const dbName = process.env.TEST_DB_NAME || 'our_money_test'

function withDatabase(url, database) {
  const u = new URL(url)
  u.pathname = `/${database}`
  return u.toString()
}

export const TEST_DATABASE_URL = withDatabase(adminUrl, dbName)

export const SHREY_ID = '00000000-0000-0000-0000-000000000001'
export const TARIKA_ID = '00000000-0000-0000-0000-000000000002'
// Deliberately not seeded into auth.users or household_members.
export const OUTSIDER_ID = '00000000-0000-0000-0000-00000000dead'

/**
 * Runs `fn(client)` inside `BEGIN; ... ROLLBACK;`. Nothing the callback
 * writes survives, so tests never need their own cleanup and can run in
 * parallel against a shared database.
 */
export async function withTx(fn) {
  const client = new Client({ connectionString: TEST_DATABASE_URL })
  await client.connect()
  try {
    await client.query('begin')
    return await fn(client)
  } finally {
    await client.query('rollback').catch(() => {})
    await client.end()
  }
}

/**
 * Switches the current transaction to `role`, and — for 'authenticated' —
 * sets the JWT-subject GUC PostgREST would set, so auth.uid() and every
 * `is_household_member()` policy behave exactly as they do in production.
 */
export async function actAs(client, role, userId) {
  await client.query(`set local role ${role}`)
  if (userId) {
    await client.query('select set_config($1, $2, true)', ['request.jwt.claim.sub', userId])
  }
}

let savepointCounter = 0

/**
 * Runs `fn()` (expected to reject) inside its own SAVEPOINT and rolls back
 * to it afterwards, so a Postgres error — which otherwise aborts the whole
 * transaction — doesn't poison later queries in the same test.
 */
export async function expectReject(client, fn, errorMatcher) {
  const savepoint = `sp_${savepointCounter++}`
  await client.query(`savepoint ${savepoint}`)
  try {
    const assert = await import('node:assert/strict')
    await assert.default.rejects(fn(), errorMatcher)
  } finally {
    await client.query(`rollback to savepoint ${savepoint}`)
  }
}
