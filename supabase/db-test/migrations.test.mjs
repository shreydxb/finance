// setup-db.mjs applying every schema file from empty (npm run test:db:setup)
// is the primary assertion here — it throws and exits non-zero on the first
// statement that fails against a clean database. This file checks the
// objects the rest of the suite depends on actually landed, so a partial
// apply that swallowed an error somewhere fails loudly here too.

import assert from 'node:assert/strict'
import test from 'node:test'
import { withTx } from './helpers.mjs'

test('every public RPC the app calls exists after a clean apply', async () => {
  await withTx(async (client) => {
    const { rows } = await client.query(`
      select proname from pg_proc
      where pronamespace = 'public'::regnamespace
      and proname in (
        'replace_category_split', 'create_goal_contribution', 'create_transfer',
        'create_bulk_transactions', 'apply_pending_income', 'claim_media_group',
        'save_telegram_settings', 'create_pending_action', 'bind_pending_action_prompt',
        'claim_pending_action', 'apply_pending_action', 'cancel_pending_action',
        'expire_pending_action', 'canonical_period_metrics', 'canonical_balance_sheet',
        'canonical_investment_metrics', 'canonical_budget_actuals'
      )
    `)
    const found = new Set(rows.map((r) => r.proname))
    for (const name of [
      'replace_category_split',
      'create_goal_contribution',
      'create_transfer',
      'create_bulk_transactions',
      'apply_pending_income',
      'claim_media_group',
      'save_telegram_settings',
      'create_pending_action',
      'bind_pending_action_prompt',
      'claim_pending_action',
      'apply_pending_action',
      'cancel_pending_action',
      'expire_pending_action',
      'canonical_period_metrics',
      'canonical_balance_sheet',
      'canonical_investment_metrics',
      'canonical_budget_actuals',
    ]) {
      assert.ok(found.has(name), `${name} should exist after applying all schema files`)
    }
  })
})

test('039 moves the RLS helper out of public with minimum execution privileges', async () => {
  await withTx(async (client) => {
    const { rows } = await client.query(`
      select
        n.nspname as schema_name,
        p.prosecdef,
        p.provolatile,
        p.proconfig @> array['search_path=""']::text[] as search_path_is_empty,
        has_function_privilege('authenticated', p.oid, 'execute') as authenticated_execute,
        has_function_privilege('anon', p.oid, 'execute') as anon_execute,
        has_function_privilege('service_role', p.oid, 'execute') as service_role_execute
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where p.proname = 'is_household_member'
    `)

    assert.equal(rows.length, 1, 'there must be exactly one membership helper')
    assert.equal(rows[0].schema_name, 'private', 'the helper must not be RPC-visible in public')
    assert.equal(rows[0].prosecdef, true, 'SECURITY DEFINER is required to avoid RLS recursion')
    assert.equal(rows[0].provolatile, 's', 'the membership predicate must remain STABLE')
    assert.equal(rows[0].search_path_is_empty, true, 'the definer helper must have an empty search_path')
    assert.equal(rows[0].authenticated_execute, true, 'authenticated needs EXECUTE for RLS')
    assert.equal(rows[0].anon_execute, false, 'anon must not execute the definer helper')
    assert.equal(rows[0].service_role_execute, false, 'service_role bypasses RLS and needs no helper grant')

    const { rows: schemas } = await client.query(`
      select
        has_schema_privilege('authenticated', 'private', 'usage') as authenticated_usage,
        has_schema_privilege('anon', 'private', 'usage') as anon_usage,
        has_schema_privilege('service_role', 'private', 'usage') as service_role_usage
    `)
    assert.equal(schemas[0].authenticated_usage, true)
    assert.equal(schemas[0].anon_usage, false)
    assert.equal(schemas[0].service_role_usage, false)

    assert.equal(
      await client.query(`select to_regprocedure('public.is_household_member()') is null as absent`)
        .then(({ rows: publicFn }) => publicFn[0].absent),
      true,
      'public.is_household_member() must not exist as a PostgREST RPC target'
    )

    const { rows: policies } = await client.query(`
      select tablename, policyname, qual, with_check
      from pg_policies
      where coalesce(qual, '') like '%is_household_member%'
         or coalesce(with_check, '') like '%is_household_member%'
    `)
    assert.ok(policies.length > 0, 'membership policies must still exist after moving the function')
    for (const policy of policies) {
      assert.match(
        `${policy.qual ?? ''} ${policy.with_check ?? ''}`,
        /private\.is_household_member\(\)/,
        `${policy.tablename}.${policy.policyname} must follow the moved helper dependency`
      )
    }
  })
})

test('039 makes the money view security invoker with read-only household grants', async () => {
  await withTx(async (client) => {
    const { rows } = await client.query(`
      select
        c.reloptions @> array['security_invoker=true']::text[] as security_invoker,
        has_table_privilege('authenticated', c.oid, 'select') as authenticated_select,
        has_table_privilege('authenticated', c.oid, 'insert,update,delete') as authenticated_write,
        has_table_privilege('anon', c.oid, 'select') as anon_select,
        has_table_privilege('service_role', c.oid, 'select') as service_role_select
      from pg_class c
      where c.oid = 'public.v_transactions_aed'::regclass
    `)

    assert.equal(rows[0].security_invoker, true)
    assert.equal(rows[0].authenticated_select, true)
    assert.equal(rows[0].authenticated_write, false)
    assert.equal(rows[0].anon_select, false)
    assert.equal(rows[0].service_role_select, true)
  })
})

test('no policy is still the pre-023 permissive using(true)/check(true)', async () => {
  await withTx(async (client) => {
    const { rows } = await client.query(`
      select tablename, policyname from pg_policies
      where schemaname = 'public' and (qual = 'true' or with_check = 'true')
    `)
    assert.deepEqual(rows, [], 'SEC-02 regressed: a permissive policy is back')
  })
})

test('the idempotency index is a single, non-partial unique index', async () => {
  await withTx(async (client) => {
    const { rows } = await client.query(`
      select indexname, indexdef from pg_indexes
      where tablename = 'transactions' and indexname like '%idempotency%'
    `)
    assert.equal(rows.length, 1, 'expected exactly one idempotency index (033 drops the 027 one)')
    assert.doesNotMatch(
      rows[0].indexdef,
      /where/i,
      'a partial index here is what caused 42P10 on the PostgREST upsert — see 033'
    )
  })
})

test('every household-client data-writing RPC is SECURITY INVOKER, not DEFINER', async () => {
  // A SECURITY DEFINER data-writing RPC would hand every caller a route
  // around the membership RLS that 023 added. is_household_member() is the
  // one deliberate RLS exception. SHR-110's pending-action functions are a
  // separate, service-only SECURITY DEFINER surface and are catalog-tested in
  // pending_actions.test.mjs, so they are intentionally excluded here.
  await withTx(async (client) => {
    const { rows } = await client.query(`
      select proname, prosecdef from pg_proc
      where pronamespace = 'public'::regnamespace
      and proname in (
        'replace_category_split', 'create_goal_contribution', 'create_transfer',
        'create_bulk_transactions', 'apply_pending_income', 'claim_media_group',
        'save_telegram_settings'
      )
    `)
    assert.ok(rows.length > 0)
    for (const row of rows) {
      assert.equal(row.prosecdef, false, `${row.proname} must not be SECURITY DEFINER`)
    }
  })
})
