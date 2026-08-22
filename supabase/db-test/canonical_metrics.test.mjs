import assert from 'node:assert/strict'
import test from 'node:test'
import { actAs, expectReject, OUTSIDER_ID, SHREY_ID, withTx } from './helpers.mjs'

const START = '2026-08-01'
const END = '2026-08-31'

async function asMember(client) {
  await actAs(client, 'authenticated', SHREY_ID)
}

async function account(client, overrides = {}) {
  const { rows } = await client.query(
    `insert into accounts (
       name, owner, type, is_liability, currency, value,
       ticker, quantity, avg_cost, last_price, price_updated_at, price_source
     ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     returning id`,
    [
      overrides.name ?? 'Cash',
      Object.hasOwn(overrides, 'owner') ? overrides.owner : 'Shrey',
      overrides.type ?? 'cash',
      overrides.isLiability ?? false,
      overrides.currency ?? 'AED',
      overrides.value ?? 0,
      overrides.ticker ?? null,
      overrides.quantity ?? null,
      overrides.avgCost ?? null,
      overrides.lastPrice ?? null,
      overrides.priceUpdatedAt ?? null,
      overrides.priceSource ?? null,
    ]
  )
  return rows[0].id
}

async function transaction(client, accountId, overrides = {}) {
  const { rows } = await client.query(
    `insert into transactions (
       date, amount, currency, account_id, category, owner, needs_review,
       deleted_at, transaction_group_id, group_kind, transfer_direction, goal_id,
       split_original_amount, split_original_currency
     ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     returning id`,
    [
      overrides.date ?? START,
      overrides.amount ?? 1,
      overrides.currency ?? 'AED',
      accountId,
      Object.hasOwn(overrides, 'category') ? overrides.category : 'Groceries',
      Object.hasOwn(overrides, 'owner') ? overrides.owner : 'Shrey',
      overrides.needsReview ?? false,
      overrides.deletedAt ?? null,
      overrides.groupId ?? null,
      overrides.groupKind ?? null,
      overrides.transferDirection ?? null,
      overrides.goalId ?? null,
      overrides.splitOriginalAmount ?? null,
      overrides.splitOriginalCurrency ?? null,
    ]
  )
  return rows[0].id
}

async function income(client, overrides = {}) {
  await client.query(
    `insert into income (person, source, kind, amount, currency, date)
     values ($1,$2,$3,$4,$5,$6)`,
    [
      Object.hasOwn(overrides, 'person') ? overrides.person : 'Shrey',
      overrides.source ?? 'Employer',
      overrides.kind ?? 'salary',
      overrides.amount ?? 100,
      overrides.currency ?? 'AED',
      overrides.date ?? START,
    ]
  )
}

async function period(client, start = START, end = END, scope = 'household', person = null) {
  const { rows } = await client.query(
    `select * from canonical_period_metrics($1,$2,$3,$4)`,
    [start, end, scope, person]
  )
  assert.equal(rows.length, 1)
  return rows[0]
}

test('041 golden period: transfers/card settlements are zero, refunds reduce consumption, and savings concepts remain distinct', async () => {
  await withTx(async (client) => {
    await asMember(client)
    const cash = await account(client)
    const card = await account(client, {
      name: 'Card', type: 'credit_card', isLiability: true, value: 400,
    })
    const balanceBeforeLedger = (await client.query(`select * from canonical_balance_sheet()`)).rows[0]
    await income(client, { amount: 10000 })
    await transaction(client, cash, { amount: 300, category: 'Groceries' })
    await transaction(client, cash, { amount: -50, category: 'Groceries' })
    await transaction(client, card, { amount: 400, category: 'Shopping' })
    await transaction(client, cash, { amount: 200, category: 'Savings & Investments' })
    await transaction(client, cash, {
      amount: 500, category: null, groupId: '11111111-1111-1111-1111-111111111111',
      groupKind: 'transfer', transferDirection: 'out',
    })
    await transaction(client, card, {
      amount: 500, category: null, groupId: '11111111-1111-1111-1111-111111111111',
      groupKind: 'transfer', transferDirection: 'in',
    })
    await transaction(client, card, { amount: 1000, category: 'Transfer' })
    await transaction(client, cash, { amount: 999, deletedAt: new Date().toISOString() })

    const row = await period(client)
    assert.equal(Number(row.posted_income_aed), 10000)
    assert.equal(Number(row.consumption_spend_aed), 650)
    assert.equal(Number(row.savings_movement_aed), 200)
    assert.equal(Number(row.cash_retained_aed), 9150)
    assert.equal(Number(row.cash_flow_aed), 9150)
    assert.equal(Number(row.savings_aed), 9350)
    assert.equal(Number(row.savings_rate_percent), 93.5)
    assert.equal(row.quality_status, 'complete')

    const balanceAfterLedger = (await client.query(`select * from canonical_balance_sheet()`)).rows[0]
    assert.equal(balanceAfterLedger.net_worth_aed, balanceBeforeLedger.net_worth_aed)

    const { rows: classes } = await client.query(
      `select economic_classification, classification_reason, count(*)::int as count
       from v_canonical_ledger_aed
       group by economic_classification, classification_reason`
    )
    assert.ok(classes.some((r) => r.classification_reason === 'typed_transfer' && r.count === 2))
    assert.ok(classes.some((r) => r.classification_reason === 'legacy_exact_transfer_category' && r.count === 1))
    assert.ok(classes.some((r) => r.economic_classification === 'savings_movement' && r.count === 1))
  })
})

test('041 parity fixture documents both intentional legacy spend deltas', async () => {
  await withTx(async (client) => {
    await asMember(client)
    const cash = await account(client)
    await transaction(client, cash, { amount: 100, category: 'Groceries' })
    await transaction(client, cash, { amount: 30, category: 'Savings & Investments' })
    await transaction(client, cash, { amount: 20, category: 'Transfer' })

    const { rows } = await client.query(`
      select
        sum(amount_aed) filter (where category is distinct from 'Transfer') as legacy_app_spend,
        sum(amount_aed) filter (where category is distinct from 'Savings & Investments') as legacy_telegram_total_spend,
        sum(amount_aed) filter (where economic_classification = 'consumption_spend') as canonical_consumption,
        sum(amount_aed) filter (where economic_classification = 'savings_movement') as canonical_savings_movement,
        sum(amount_aed) filter (where economic_classification = 'internal_transfer') as excluded_transfer_movement
      from v_canonical_ledger_aed
    `)
    assert.equal(Number(rows[0].legacy_app_spend), 130)
    assert.equal(Number(rows[0].legacy_telegram_total_spend), 120)
    assert.equal(Number(rows[0].canonical_consumption), 100)
    assert.equal(Number(rows[0].canonical_savings_movement), 30)
    assert.equal(Number(rows[0].excluded_transfer_movement), 20)
  })
})

test('041 posted cashback/reward income counts once while recurring expected income remains outside actuals', async () => {
  await withTx(async (client) => {
    await asMember(client)
    await income(client, { amount: 125, kind: 'other', source: 'Cashback' })
    await client.query(
      `insert into recurring (name,kind,amount,currency) values ('Expected salary','income',9999,'AED')`
    )
    const row = await period(client)
    assert.equal(Number(row.posted_income_aed), 125)
    assert.equal(Number(row.savings_aed), 125)
    assert.equal(Number(row.savings_rate_percent), 100)
  })
})

test('041 review quality includes nonzero review rows provisionally and fails closed for zero placeholders', async () => {
  await withTx(async (client) => {
    await asMember(client)
    const cash = await account(client)
    await transaction(client, cash, { amount: 75, needsReview: true })
    let row = await period(client)
    assert.equal(Number(row.consumption_spend_aed), 75)
    assert.equal(row.quality_status, 'provisional')
    assert.equal(Number(row.needs_review_count), 1)

    await transaction(client, cash, { amount: 0, needsReview: true, category: null })
    row = await period(client)
    assert.equal(row.consumption_spend_aed, null)
    assert.equal(row.savings_aed, null)
    assert.equal(row.cash_flow_aed, null)
    assert.equal(row.quality_status, 'incomplete')
    assert.equal(Number(row.zero_placeholder_count), 1)
  })
})

test('041 missing FX never yields a plausible complete period, balance, or investment total', async () => {
  await withTx(async (client) => {
    await asMember(client)
    const gbp = await account(client, { currency: 'GBP', value: 500 })
    await income(client, { amount: 100, currency: 'AED' })
    await transaction(client, gbp, { amount: 25, currency: 'GBP' })

    const p = await period(client)
    assert.equal(Number(p.posted_income_aed), 100)
    assert.equal(p.consumption_spend_aed, null)
    assert.equal(p.quality_status, 'incomplete')
    assert.equal(Number(p.missing_fx_count), 1)

    const { rows: balance } = await client.query(`select * from canonical_balance_sheet()`)
    assert.equal(balance[0].assets_aed, null)
    assert.equal(balance[0].net_worth_aed, null)
    assert.equal(balance[0].quality_status, 'incomplete')

    await income(client, { amount: 5, currency: 'GBP' })
    const withIncomeGap = await period(client)
    assert.equal(withIncomeGap.posted_income_aed, null)
    assert.equal(withIncomeGap.savings_rate_reason, 'incomplete_inputs')
    assert.equal(Number(withIncomeGap.missing_fx_count), 2)
  })
})

test('041 canonical balance sheet uses positive liability magnitudes and exact rounded net worth', async () => {
  await withTx(async (client) => {
    await asMember(client)
    await account(client, { name: 'Cash', value: 1000.005 })
    await account(client, { name: 'Loan', type: 'loan', isLiability: true, value: 250.004 })
    const { rows } = await client.query(`select * from canonical_balance_sheet()`)
    const b = rows[0]
    assert.equal(Number(b.assets_aed), 1000.01)
    assert.equal(Number(b.liabilities_aed), 250)
    assert.equal(Number(b.net_worth_aed), 750.01)
    assert.equal(Number(b.assets_aed) - Number(b.liabilities_aed), Number(b.net_worth_aed))
    assert.equal(b.quality_status, 'complete')
  })
})

test('041 negative values and liability/type mismatches are visible incomplete validation states', async () => {
  await withTx(async (client) => {
    await asMember(client)
    await account(client, { value: -10 })
    await account(client, { type: 'loan', isLiability: false, value: 100 })
    const { rows } = await client.query(`select * from canonical_balance_sheet()`)
    assert.equal(rows[0].net_worth_aed, null)
    assert.equal(rows[0].quality_status, 'incomplete')
    assert.equal(Number(rows[0].incomplete_account_count), 2)
    assert.equal(Number(rows[0].quality_metadata.negative_value_count), 1)
    assert.equal(Number(rows[0].quality_metadata.liability_type_mismatch_count), 1)
  })
})

test('041 investment value and unrealized all-time P&L reconcile to quantity, cost, price, FX, and freshness metadata', async () => {
  await withTx(async (client) => {
    await asMember(client)
    await account(client, {
      name: 'Quoted', type: 'investment', currency: 'USD', value: 70,
      quantity: 10, avgCost: 5, lastPrice: 7, ticker: 'TEST',
      priceUpdatedAt: '2026-08-20T00:00:00Z', priceSource: 'fixture',
    })
    await account(client, {
      name: 'Manual', type: 'investment', value: 50,
      quantity: 2, avgCost: 20,
    })

    const { rows } = await client.query(
      `select * from canonical_investment_metrics('household', null, '2026-08-21T00:00:00Z')`
    )
    const inv = rows[0]
    assert.equal(Number(inv.investment_value_aed), 307.08)
    assert.equal(Number(inv.cost_basis_aed), 223.63)
    assert.equal(Number(inv.unrealized_pnl_aed), 83.45)
    assert.equal(inv.quality_status, 'provisional')
    assert.equal(Number(inv.manual_value_count), 1)
    assert.equal(Number(inv.stale_value_count), 1)
    assert.equal(inv.quality_metadata.pnl_basis, 'unrealized_all_time')
  })
})

test('041 missing investment cost basis makes aggregate P&L incomplete rather than zero gain', async () => {
  await withTx(async (client) => {
    await asMember(client)
    await account(client, {
      type: 'investment', value: 70, quantity: 10, lastPrice: 7,
      priceUpdatedAt: '2026-08-20T00:00:00Z', priceSource: 'fixture',
    })
    const { rows } = await client.query(`select * from canonical_investment_metrics()`)
    assert.equal(Number(rows[0].investment_value_aed), 70)
    assert.equal(rows[0].cost_basis_aed, null)
    assert.equal(rows[0].unrealized_pnl_aed, null)
    assert.equal(rows[0].quality_status, 'incomplete')
    assert.equal(Number(rows[0].incomplete_pnl_count), 1)
  })
})

test('041 budget actual includes uncategorised/budgetless consumption and reconciles exactly to canonical consumption spend', async () => {
  await withTx(async (client) => {
    await asMember(client)
    const cash = await account(client)
    await transaction(client, cash, { amount: 70, category: 'Groceries' })
    await transaction(client, cash, { amount: 20, category: null })
    await transaction(client, cash, { amount: 10, category: 'No budget row' })
    await transaction(client, cash, { amount: 50, category: 'Savings & Investments' })
    await transaction(client, cash, { amount: 500, category: 'Transfer' })

    const { rows: actuals } = await client.query(`select * from canonical_budget_actuals($1,$2)`, [START, END])
    assert.deepEqual(actuals.map((r) => r.category), ['Groceries', 'No budget row', 'Uncategorised'])
    const actualTotal = actuals.reduce((sum, r) => sum + Number(r.actual_aed), 0)
    const p = await period(client)
    assert.equal(actualTotal, 100)
    assert.equal(actualTotal, Number(p.consumption_spend_aed))
  })
})

test('041 goal and debt progress use one authoritative basis and keep linked activity reconciliation-only', async () => {
  await withTx(async (client) => {
    await asMember(client)
    const savingsAccount = await account(client, { name: 'Goal savings', value: 800 })
    const liability = await account(client, {
      name: 'Loan', type: 'loan', isLiability: true, value: 1200,
    })
    const { rows: goals } = await client.query(`
      insert into goals (name, kind, target_amount, linked_account_id, starting_balance)
      values
        ('Linked save', 'save_up', 1000, $1, null),
        ('Unlinked save', 'save_up', 1000, null, null),
        ('Debt', 'pay_down', 1000, $2, 1000),
        ('Broken debt', 'pay_down', 500, null, 500)
      returning id, name
    `, [savingsAccount, liability])
    const byName = Object.fromEntries(goals.map((g) => [g.name, g.id]))
    await client.query(
      `insert into goal_contributions (goal_id, amount, date) values
       ($1,100,$4),($2,300,$4),($3,250,$4)`,
      [byName['Linked save'], byName['Unlinked save'], byName.Debt, START]
    )
    const cash = await account(client, { name: 'Other cash' })
    await transaction(client, cash, { amount: 999, goalId: byName['Unlinked save'] })

    const { rows } = await client.query(
      `select name, progress_basis, current_amount_aed, raw_progress_aed,
              raw_progress_percent, contribution_activity_aed, quality_status
       from v_canonical_goal_progress order by name`
    )
    const result = Object.fromEntries(rows.map((r) => [r.name, r]))
    assert.equal(Number(result['Linked save'].current_amount_aed), 800)
    assert.equal(Number(result['Linked save'].raw_progress_aed), 800)
    assert.equal(Number(result['Linked save'].contribution_activity_aed), 100)
    assert.equal(result['Linked save'].progress_basis, 'linked_account')
    assert.equal(Number(result['Unlinked save'].raw_progress_aed), 300)
    assert.equal(result['Unlinked save'].progress_basis, 'contributions_implicit_aed')
    assert.equal(Number(result.Debt.raw_progress_aed), -200)
    assert.equal(Number(result.Debt.raw_progress_percent), -20)
    assert.equal(Number(result.Debt.contribution_activity_aed), 250)
    assert.equal(result.Debt.quality_status, 'complete')
    assert.equal(result['Broken debt'].quality_status, 'incomplete')
  })
})

test('042 debt quality uses starting balance and linked liability while save-up still requires a positive target', async () => {
  await withTx(async (client) => {
    await asMember(client)
    const linkedSavings = await account(client, { name: 'Linked savings', value: 800 })
    const validLiability = await account(client, {
      name: 'Valid loan', type: 'loan', isLiability: true, value: 1200,
    })
    const incompleteLiability = await account(client, {
      name: 'Missing FX loan', type: 'loan', isLiability: true, currency: 'GBP', value: 100,
    })
    const nonLiability = await account(client, { name: 'Not a liability', value: 100 })

    const { rows: goals } = await client.query(`
      insert into goals (name, kind, target_amount, linked_account_id, starting_balance)
      values
        ('Valid zero-target debt', 'pay_down', 0, $1, 1000),
        ('Zero-start debt', 'pay_down', 0, $1, 0),
        ('Missing-start debt', 'pay_down', 0, $1, null),
        ('Missing-link debt', 'pay_down', 0, null, 1000),
        ('Non-liability debt', 'pay_down', 0, $2, 1000),
        ('Incomplete-link debt', 'pay_down', 0, $3, 1000),
        ('Zero-target save', 'save_up', 0, null, null),
        ('Linked save unchanged', 'save_up', 1000, $4, null),
        ('Unlinked save unchanged', 'save_up', 1000, null, null)
      returning id, name
    `, [validLiability, nonLiability, incompleteLiability, linkedSavings])
    const byName = Object.fromEntries(goals.map((goal) => [goal.name, goal.id]))

    await client.query(
      `insert into goal_contributions (goal_id, amount, date) values
       ($1,250,$5),($2,50,$5),($3,100,$5),($4,300,$5)`,
      [
        byName['Valid zero-target debt'],
        byName['Zero-target save'],
        byName['Linked save unchanged'],
        byName['Unlinked save unchanged'],
        START,
      ]
    )

    const { rows } = await client.query(`
      select name, progress_basis, current_amount_aed, raw_progress_aed,
             raw_progress_percent, contribution_activity_aed, quality_status
      from v_canonical_goal_progress
      order by name
    `)
    const result = Object.fromEntries(rows.map((row) => [row.name, row]))

    assert.equal(result['Valid zero-target debt'].quality_status, 'complete')
    assert.equal(Number(result['Valid zero-target debt'].current_amount_aed), 1200)
    assert.equal(Number(result['Valid zero-target debt'].raw_progress_aed), -200)
    assert.equal(Number(result['Valid zero-target debt'].raw_progress_percent), -20)
    assert.equal(Number(result['Valid zero-target debt'].contribution_activity_aed), 250)
    assert.equal(result['Valid zero-target debt'].progress_basis, 'linked_liability_balance')

    for (const name of [
      'Zero-start debt',
      'Missing-start debt',
      'Missing-link debt',
      'Non-liability debt',
      'Incomplete-link debt',
    ]) {
      assert.equal(result[name].quality_status, 'incomplete', `${name} must fail closed`)
    }

    assert.equal(result['Zero-target save'].quality_status, 'incomplete')
    assert.equal(Number(result['Zero-target save'].raw_progress_aed), 50)

    assert.equal(result['Linked save unchanged'].quality_status, 'complete')
    assert.equal(result['Linked save unchanged'].progress_basis, 'linked_account')
    assert.equal(Number(result['Linked save unchanged'].raw_progress_aed), 800)
    assert.equal(Number(result['Linked save unchanged'].contribution_activity_aed), 100)

    assert.equal(result['Unlinked save unchanged'].quality_status, 'complete')
    assert.equal(result['Unlinked save unchanged'].progress_basis, 'contributions_implicit_aed')
    assert.equal(Number(result['Unlinked save unchanged'].raw_progress_aed), 300)
  })
})

test('041 savings rate is NULL with a reason for zero/negative income and remains signed for negative savings', async () => {
  await withTx(async (client) => {
    await asMember(client)
    const cash = await account(client)
    await transaction(client, cash, { date: '2026-08-01', amount: 25 })
    let row = await period(client, '2026-08-01', '2026-08-01')
    assert.equal(Number(row.savings_aed), -25)
    assert.equal(row.savings_rate_percent, null)
    assert.equal(row.savings_rate_reason, 'nonpositive_income')

    row = await period(client, '2026-08-02', '2026-08-02')
    assert.equal(Number(row.savings_aed), 0)
    assert.equal(row.savings_rate_percent, null)
    assert.equal(row.savings_rate_reason, 'nonpositive_income')

    await income(client, { date: '2026-08-03', amount: -100 })
    row = await period(client, '2026-08-03', '2026-08-03')
    assert.equal(Number(row.savings_aed), -100)
    assert.equal(row.savings_rate_percent, null)
    assert.equal(row.savings_rate_reason, 'nonpositive_income')
  })
})

test('041 person scope preserves exact Joint and unassigned buckets without allocation', async () => {
  await withTx(async (client) => {
    await asMember(client)
    const cash = await account(client)
    await transaction(client, cash, { amount: 10, owner: 'Joint' })
    await transaction(client, cash, { amount: 20, owner: null })
    await transaction(client, cash, { amount: 30, owner: 'Shrey' })
    await income(client, { amount: 100, person: 'Joint' })

    const joint = await period(client, START, END, 'person', 'Joint')
    assert.equal(Number(joint.posted_income_aed), 100)
    assert.equal(Number(joint.consumption_spend_aed), 10)
    const unassigned = await period(client, START, END, 'person', null)
    assert.equal(Number(unassigned.posted_income_aed), 0)
    assert.equal(Number(unassigned.consumption_spend_aed), 20)
  })
})

test('041 split identity reconciles new RPC writes; legacy identity gaps and sub-cent splits fail visibly', async () => {
  await withTx(async (client) => {
    await asMember(client)
    const cash = await account(client)
    const { rows: split } = await client.query(
      `select * from replace_category_split(null, null, $1::jsonb, $2::jsonb)`,
      [
        JSON.stringify({ date: START, currency: 'AED', account_id: cash }),
        JSON.stringify([{ amount: 60, category: 'Groceries' }, { amount: 40, category: 'Dining' }]),
      ]
    )
    assert.equal(split.length, 2)
    assert.ok(split.every((r) => Number(r.split_original_amount) === 100))
    const { rows: reconciled } = await client.query(
      `select distinct split_reconciliation_status, quality_status
       from v_canonical_ledger_aed where transaction_group_id = $1`,
      [split[0].transaction_group_id]
    )
    assert.deepEqual(reconciled, [{ split_reconciliation_status: 'reconciled', quality_status: 'complete' }])

    const legacyGroup = '22222222-2222-2222-2222-222222222222'
    await transaction(client, cash, { amount: 5, groupId: legacyGroup, groupKind: 'category_split' })
    const { rows: legacy } = await client.query(
      `select split_reconciliation_status, quality_status from v_canonical_ledger_aed
       where transaction_group_id = $1`, [legacyGroup]
    )
    assert.equal(legacy[0].split_reconciliation_status, 'missing_identity')
    assert.equal(legacy[0].quality_status, 'incomplete')

    await assert.rejects(
      () => client.query(`select * from replace_category_split(null,null,$1::jsonb,$2::jsonb)`, [
        JSON.stringify({ date: START, currency: 'AED', account_id: cash }),
        JSON.stringify([{ amount: 1.005, category: 'Groceries' }]),
      ]),
      /2-decimal precision/
    )
  })
})

test('041 outputs round in Postgres numeric at canonical two-decimal precision and never touch nw_daily history', async () => {
  await withTx(async (client) => {
    await asMember(client)
    const cash = await account(client, { value: 10 })
    await transaction(client, cash, { amount: 1.005 })
    await client.query(
      `insert into nw_daily (day,total_aed,assets_aed,liabilities_aed)
       values ('2026-07-31',123.456,200,76.544)`
    )
    const p = await period(client)
    assert.equal(Number(p.consumption_spend_aed), 1.01)
    await client.query(`select * from canonical_balance_sheet()`)
    const { rows: history } = await client.query(
      `select total_aed,assets_aed,liabilities_aed from nw_daily where day='2026-07-31'`
    )
    assert.equal(history[0].total_aed, '123.456')
    assert.equal(history[0].assets_aed, '200')
    assert.equal(history[0].liabilities_aed, '76.544')
  })
})

test('041 canonical surfaces respect RLS and expose only invoker/read-only contracts', async () => {
  await withTx(async (client) => {
    await actAs(client, 'service_role')
    const cash = await account(client)
    await transaction(client, cash, { amount: 42 })

    await asMember(client)
    assert.equal((await client.query(`select * from v_canonical_ledger_aed`)).rows.length, 1)
    assert.equal((await client.query(`select * from canonical_period_metrics($1,$2)`, [START, END])).rows.length, 1)

    await actAs(client, 'authenticated', OUTSIDER_ID)
    assert.deepEqual((await client.query(`select * from v_canonical_ledger_aed`)).rows, [])
    assert.deepEqual((await client.query(`select * from canonical_period_metrics($1,$2)`, [START, END])).rows, [])

    await actAs(client, 'anon')
    await expectReject(client, () => client.query(`select * from v_canonical_ledger_aed`), /permission denied/i)
    await expectReject(
      client,
      () => client.query(`select * from canonical_period_metrics($1,$2)`, [START, END]),
      /permission denied/i
    )
  })
})

test('041 catalog requires security-invoker views/functions and least-privilege grants', async () => {
  await withTx(async (client) => {
    const { rows: views } = await client.query(`
      select c.relname, c.reloptions @> array['security_invoker=true']::text[] as security_invoker,
             has_table_privilege('authenticated', c.oid, 'select') as member_select,
             has_table_privilege('anon', c.oid, 'select') as anon_select
      from pg_class c
      where c.relname in ('v_canonical_ledger_aed','v_canonical_income_aed','v_canonical_accounts_aed','v_canonical_goal_progress')
    `)
    assert.equal(views.length, 4)
    for (const view of views) {
      assert.equal(view.security_invoker, true, `${view.relname} must be security_invoker`)
      assert.equal(view.member_select, true)
      assert.equal(view.anon_select, false)
    }

    const { rows: functions } = await client.query(`
      select p.proname, p.prosecdef,
             has_function_privilege('authenticated', p.oid, 'execute') as member_execute,
             has_function_privilege('anon', p.oid, 'execute') as anon_execute
      from pg_proc p
      where p.pronamespace='public'::regnamespace
        and p.proname in ('canonical_period_metrics','canonical_balance_sheet','canonical_investment_metrics','canonical_budget_actuals')
    `)
    assert.equal(functions.length, 4)
    for (const fn of functions) {
      assert.equal(fn.prosecdef, false, `${fn.proname} must execute as caller`)
      assert.equal(fn.member_execute, true)
      assert.equal(fn.anon_execute, false)
    }
  })
})
