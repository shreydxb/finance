import assert from 'node:assert/strict'
import test from 'node:test'

import {
  mergeCanonicalQuality,
  normalizeCanonicalAccountRows,
  normalizeCanonicalBalanceSheet,
  normalizeCanonicalBudgetRows,
  normalizeCanonicalInvestmentMetrics,
  normalizeCanonicalLedgerRows,
  normalizeCanonicalPeriodResponse,
} from './canonicalContracts.js'
import { canonicalHeadline } from './canonicalPresentation.js'

const expected = { from: '2026-07-01', to: '2026-07-31', scope: 'household', person: null }

function metadata(overrides = {}) {
  return {
    fx_basis: 'current_rate_aed',
    fx_updated_at: '2026-07-31T12:00:00Z',
    missing_fx_currencies: [],
    income_incomplete_count: 0,
    consumption_incomplete_count: 0,
    savings_movement_incomplete_count: 0,
    provisional_transaction_count: 0,
    zero_placeholder_count: 0,
    classification_version: 'shr-111-phase-a-v1',
    ...overrides,
  }
}

function response(overrides = {}) {
  return [{
    period_start: expected.from,
    period_end: expected.to,
    scope: expected.scope,
    person: expected.person,
    posted_income_aed: '10000.00',
    consumption_spend_aed: '4000.00',
    savings_movement_aed: '1000.00',
    cash_retained_aed: '5000.00',
    savings_aed: '6000.00',
    cash_flow_aed: '5000.00',
    savings_rate_percent: '60.00',
    savings_rate_reason: null,
    quality_status: 'complete',
    missing_fx_count: 0,
    needs_review_count: 0,
    zero_placeholder_count: 0,
    quality_metadata: metadata(),
    ...overrides,
  }]
}

test('complete canonical fixture preserves every distinct financial meaning', () => {
  const normalized = normalizeCanonicalPeriodResponse(response(), expected)
  assert.deepEqual(canonicalHeadline(normalized), {
    income: 10000,
    consumption: 4000,
    savingsMovement: 1000,
    cashRetained: 5000,
    cashFlow: 5000,
    savings: 6000,
    savingsRate: 60,
    savingsRateReason: null,
    quality: 'complete',
  })
})

test('Home and Reports receive the same direct canonical headline object for a period', () => {
  const metrics = normalizeCanonicalPeriodResponse(response(), expected)
  const home = canonicalHeadline(metrics)
  const reports = canonicalHeadline(metrics)
  assert.deepEqual(home, reports)
})

test('provisional nonzero review fixture remains monetary but never complete', () => {
  const normalized = normalizeCanonicalPeriodResponse(response({
    quality_status: 'provisional',
    needs_review_count: 2,
    quality_metadata: metadata({ provisional_transaction_count: 2 }),
  }), expected)
  assert.equal(normalized.quality_status, 'provisional')
  assert.equal(normalized.consumption_spend_aed, 4000)
})

test('zero-placeholder and missing-FX fixtures preserve canonical NULL', () => {
  for (const fixture of [
    {
      needs_review_count: 1,
      zero_placeholder_count: 1,
      quality_metadata: metadata({ consumption_incomplete_count: 1, zero_placeholder_count: 1 }),
    },
    {
      missing_fx_count: 1,
      quality_metadata: metadata({ consumption_incomplete_count: 1, missing_fx_currencies: ['USD'] }),
    },
  ]) {
    const normalized = normalizeCanonicalPeriodResponse(response({
      ...fixture,
      consumption_spend_aed: null,
      cash_retained_aed: null,
      savings_aed: null,
      cash_flow_aed: null,
      savings_rate_percent: null,
      savings_rate_reason: 'incomplete_inputs',
      quality_status: 'incomplete',
    }), expected)
    assert.equal(normalized.consumption_spend_aed, null)
    assert.equal(canonicalHeadline(normalized).savings, null)
  }
})

test('savings rate is NULL with canonical reason for zero and negative posted income', () => {
  for (const income of ['0', '-100']) {
    const normalized = normalizeCanonicalPeriodResponse(response({
      posted_income_aed: income,
      consumption_spend_aed: '50',
      savings_movement_aed: '0',
      cash_retained_aed: String(Number(income) - 50),
      savings_aed: String(Number(income) - 50),
      cash_flow_aed: String(Number(income) - 50),
      savings_rate_percent: null,
      savings_rate_reason: 'nonpositive_income',
    }), expected)
    assert.equal(normalized.savings_rate_percent, null)
    assert.equal(normalized.savings_rate_reason, 'nonpositive_income')
  }
})

test('quality ordering is deterministic: complete < provisional < incomplete', () => {
  assert.equal(mergeCanonicalQuality('complete', 'provisional'), 'provisional')
  assert.equal(mergeCanonicalQuality('provisional', 'incomplete', 'complete'), 'incomplete')
})

test('canonical response validation fails closed on zero, duplicate, malformed and unknown data', () => {
  assert.throws(() => normalizeCanonicalPeriodResponse([], expected), /expected exactly one/)
  assert.throws(() => normalizeCanonicalPeriodResponse([...response(), ...response()], expected), /returned 2 rows/)
  assert.throws(() => normalizeCanonicalPeriodResponse(response({ posted_income_aed: 'not-money' }), expected), /must be numeric/)
  assert.throws(() => normalizeCanonicalPeriodResponse(response({ quality_status: 'mostly-complete' }), expected), /unknown value/)
  assert.throws(() => normalizeCanonicalPeriodResponse(response({ quality_metadata: metadata({ classification_version: 'future' }) }), expected), /classification_version is unknown/)
})

test('period quality rejects contradictory known-enum evidence', () => {
  const contradictory = [
    response({ needs_review_count: 1 }),
    response({ needs_review_count: 1, quality_metadata: metadata({ provisional_transaction_count: 1 }) }),
    response({ missing_fx_count: 1, quality_metadata: metadata({ missing_fx_currencies: ['USD'] }) }),
    response({ quality_metadata: metadata({ consumption_incomplete_count: 1 }) }),
    response({ quality_status: 'provisional', needs_review_count: 1 }),
    response({
      quality_status: 'provisional',
      needs_review_count: 2,
      zero_placeholder_count: 1,
      quality_metadata: metadata({ provisional_transaction_count: 1, consumption_incomplete_count: 1, zero_placeholder_count: 1 }),
    }),
    response({ quality_status: 'incomplete' }),
  ]
  for (const payload of contradictory) {
    assert.throws(() => normalizeCanonicalPeriodResponse(payload, expected), /Canonical contract error/)
  }
})

test('period top-level counts and currencies must reconcile with quality metadata', () => {
  const contradictory = [
    response({ zero_placeholder_count: 1 }),
    response({ missing_fx_count: 1 }),
    response({ quality_metadata: metadata({ missing_fx_currencies: ['USD'] }) }),
    response({ missing_fx_count: 1, quality_metadata: metadata({ missing_fx_currencies: ['USD', 'EUR'] }) }),
    response({ needs_review_count: 1, quality_metadata: metadata({ provisional_transaction_count: 2 }) }),
  ]
  for (const payload of contradictory) {
    assert.throws(() => normalizeCanonicalPeriodResponse(payload, expected), /Canonical contract error/)
  }
})

test('period monetary dependencies and savings-rate reason fail closed when contradictory', () => {
  const contradictory = [
    response({ savings_aed: '5999.99' }),
    response({ cash_retained_aed: '4999.99', cash_flow_aed: '4999.99' }),
    response({ savings_rate_percent: '59.99' }),
    response({ savings_rate_percent: null, savings_rate_reason: 'nonpositive_income' }),
    response({
      quality_status: 'incomplete',
      quality_metadata: metadata({ consumption_incomplete_count: 1 }),
      savings_rate_percent: null,
      savings_rate_reason: 'incomplete_inputs',
    }),
  ]
  for (const payload of contradictory) {
    assert.throws(() => normalizeCanonicalPeriodResponse(payload, expected), /Canonical contract error/)
  }
})

function ledgerRow(overrides = {}) {
  return {
    id: 'a', date: '2026-07-01', amount: '1', currency: 'AED', category: 'Groceries', owner: 'Shrey', note: null,
    tags: [], account_id: null, needs_review: false, transaction_group_id: null, group_kind: null, transfer_direction: null,
    amount_aed: '1', consumption_spend_aed: '1', savings_movement_aed: null,
    economic_classification: 'consumption_spend', classification_reason: 'categorised_consumption', quality_status: 'complete',
    ...overrides,
  }
}

test('ledger reason and economic classification combinations follow canonical precedence', () => {
  const valid = [
    ledgerRow({
      id: 'typed', transaction_group_id: 'group', group_kind: 'transfer', transfer_direction: 'out', category: 'Transfer',
      economic_classification: 'internal_transfer', classification_reason: 'typed_transfer',
      consumption_spend_aed: null,
    }),
    ledgerRow({ id: 'legacy-transfer', category: 'Transfer', economic_classification: 'internal_transfer', classification_reason: 'legacy_exact_transfer_category', consumption_spend_aed: null }),
    ledgerRow({ id: 'savings', category: 'Savings & Investments', economic_classification: 'savings_movement', classification_reason: 'legacy_exact_savings_category', consumption_spend_aed: null, savings_movement_aed: '1' }),
    ledgerRow({ id: 'uncategorised', category: null, classification_reason: 'uncategorised_consumption' }),
    ledgerRow({ id: 'categorised' }),
  ]
  assert.equal(normalizeCanonicalLedgerRows(valid).length, 5)

  const contradictory = [
    ledgerRow({ economic_classification: 'internal_transfer', classification_reason: 'categorised_consumption', amount_aed: null, consumption_spend_aed: null }),
    ledgerRow({ economic_classification: 'savings_movement', classification_reason: 'typed_transfer', consumption_spend_aed: null, savings_movement_aed: '1' }),
    ledgerRow({ economic_classification: 'consumption_spend', classification_reason: 'legacy_exact_transfer_category' }),
    ledgerRow({ economic_classification: 'internal_transfer', classification_reason: 'legacy_exact_savings_category', consumption_spend_aed: null }),
    ledgerRow({ economic_classification: 'savings_movement', classification_reason: 'uncategorised_consumption', consumption_spend_aed: null, savings_movement_aed: '1' }),
  ]
  for (const payload of contradictory) {
    assert.throws(() => normalizeCanonicalLedgerRows([payload]), /classification reason and economic classification disagree/)
  }
})

test('ledger grouping, transfer direction, category precedence and row quality invariants fail closed', () => {
  const contradictory = [
    ledgerRow({ transaction_group_id: 'group' }),
    ledgerRow({ transaction_group_id: 'group', group_kind: 'bulk_batch', transfer_direction: 'in' }),
    ledgerRow({ transaction_group_id: 'group', group_kind: 'transfer', economic_classification: 'internal_transfer', classification_reason: 'typed_transfer', consumption_spend_aed: null }),
    ledgerRow({ category: 'Food', economic_classification: 'internal_transfer', classification_reason: 'legacy_exact_transfer_category', consumption_spend_aed: null }),
    ledgerRow({ category: 'Food', economic_classification: 'savings_movement', classification_reason: 'legacy_exact_savings_category', consumption_spend_aed: null, savings_movement_aed: '1' }),
    ledgerRow({ category: 'Food', classification_reason: 'uncategorised_consumption' }),
    ledgerRow({ category: 'Transfer' }),
    ledgerRow({ needs_review: true }),
    ledgerRow({ quality_status: 'provisional', needs_review: false }),
    ledgerRow({ quality_status: 'provisional', needs_review: true, amount: '0' }),
    ledgerRow({ quality_status: 'incomplete' }),
  ]
  for (const payload of contradictory) {
    assert.throws(() => normalizeCanonicalLedgerRows([payload]), /Canonical contract error/)
  }
})

test('budget quality and count combinations fail closed', () => {
  const base = { category: 'Groceries', actual_aed: '1', quality_status: 'complete', transaction_count: 1, needs_review_count: 0, zero_placeholder_count: 0, missing_fx_count: 0 }
  const contradictory = [
    { ...base, needs_review_count: 1 },
    { ...base, quality_status: 'provisional' },
    { ...base, quality_status: 'provisional', needs_review_count: 1, zero_placeholder_count: 1 },
    { ...base, quality_status: 'provisional', needs_review_count: 1, missing_fx_count: 1 },
    { ...base, transaction_count: 0, needs_review_count: 1 },
  ]
  for (const payload of contradictory) {
    assert.throws(() => normalizeCanonicalBudgetRows([payload]), /Canonical contract error/)
  }
})

test('duplicate canonical fact identities fail closed', () => {
  const ledger = ledgerRow()
  assert.throws(() => normalizeCanonicalLedgerRows([ledger, ledger]), /duplicate ids/)
  const budget = { category: 'Groceries', actual_aed: '1', quality_status: 'complete', transaction_count: 1, needs_review_count: 0, zero_placeholder_count: 0, missing_fx_count: 0 }
  assert.throws(() => normalizeCanonicalBudgetRows([budget, budget]), /duplicate categories/)
})

test('canonical wealth contracts reconcile and preserve provisional evidence', () => {
  const balance = normalizeCanonicalBalanceSheet([{
    scope: 'household', person: null, assets_aed: '200.00', liabilities_aed: '50.00', net_worth_aed: '150.00',
    quality_status: 'provisional', incomplete_account_count: 0, provisional_account_count: 1, missing_fx_count: 0,
    quality_metadata: { fx_basis: 'current_rate_aed', classification_version: 'shr-111-phase-a-v1' },
  }])
  assert.equal(balance.net_worth_aed, 150)
  assert.equal(balance.quality_status, 'provisional')

  const investments = normalizeCanonicalInvestmentMetrics([{
    scope: 'household', person: null, investment_value_aed: '100.00', cost_basis_aed: null, unrealized_pnl_aed: null,
    quality_status: 'incomplete', incomplete_value_count: 0, incomplete_pnl_count: 1, provisional_count: 0,
    manual_value_count: 0, stale_value_count: 0, missing_fx_count: 0,
    quality_metadata: { fx_basis: 'current_rate_aed', classification_version: 'shr-111-phase-a-v1' },
  }])
  assert.equal(investments.investment_value_aed, 100, 'missing P&L does not erase valid current investment value')
})

test('canonical account rows fail closed instead of exposing legacy arithmetic', () => {
  const rows = normalizeCanonicalAccountRows([{
    id: 'account-1', owner: 'Shrey', type: 'cash', is_liability: false, currency: 'AED',
    canonical_value_aed: '250', quality_status: 'complete', valuation_method: 'account_balance',
    valuation_as_of: '2026-08-24T12:00:00Z', fx_rate_to_aed: '1', fx_updated_at: '2026-08-24T11:00:00Z',
  }])
  assert.equal(rows[0].canonical_value_aed, 250)
  assert.throws(
    () => normalizeCanonicalAccountRows([{ ...rows[0], quality_status: 'incomplete', canonical_value_aed: '250' }]),
    /incomplete account.*must not expose/
  )
})
