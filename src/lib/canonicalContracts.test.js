import assert from 'node:assert/strict'
import test from 'node:test'

import {
  mergeCanonicalQuality,
  normalizeCanonicalBudgetRows,
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

test('duplicate canonical fact identities fail closed', () => {
  const ledger = {
    id: 'a', date: '2026-07-01', amount: '1', currency: 'AED', category: 'Groceries', owner: 'Shrey', note: null,
    tags: [], account_id: null, needs_review: false, transaction_group_id: null, group_kind: null, transfer_direction: null,
    amount_aed: '1', consumption_spend_aed: '1', savings_movement_aed: null,
    economic_classification: 'consumption_spend', classification_reason: 'categorised_consumption', quality_status: 'complete',
  }
  assert.throws(() => normalizeCanonicalLedgerRows([ledger, ledger]), /duplicate ids/)
  const budget = { category: 'Groceries', actual_aed: '1', quality_status: 'complete', transaction_count: 1, needs_review_count: 0, zero_placeholder_count: 0, missing_fx_count: 0 }
  assert.throws(() => normalizeCanonicalBudgetRows([budget, budget]), /duplicate categories/)
})
