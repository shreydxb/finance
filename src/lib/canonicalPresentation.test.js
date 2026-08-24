import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

import {
  buildSankeyModel,
  categoryConsumptionGroups,
  incomeGroups,
  ledgerConsumptionGroups,
  qualityCopy,
} from './canonicalPresentation.js'

function metrics(overrides = {}) {
  return {
    posted_income_aed: 1000,
    consumption_spend_aed: 500,
    savings_movement_aed: 200,
    cash_retained_aed: 300,
    savings_aed: 500,
    cash_flow_aed: 300,
    savings_rate_percent: 50,
    savings_rate_reason: null,
    quality_status: 'complete',
    missing_fx_count: 0,
    needs_review_count: 0,
    zero_placeholder_count: 0,
    quality_metadata: {
      fx_basis: 'current_rate_aed',
      fx_updated_at: '2026-07-31T12:00:00Z',
      missing_fx_currencies: [],
      income_incomplete_count: 0,
      consumption_incomplete_count: 0,
      savings_movement_incomplete_count: 0,
      provisional_transaction_count: 0,
      zero_placeholder_count: 0,
    },
    ...overrides,
  }
}

test('quality detail exposes AED basis, FX timestamp, and status-specific evidence', () => {
  assert.match(qualityCopy(metrics()).detail, /Current-rate AED basis; FX updated 2026-07-31 12:00:00 UTC/)

  const provisional = qualityCopy(metrics({
    quality_status: 'provisional',
    needs_review_count: 3,
    quality_metadata: { ...metrics().quality_metadata, provisional_transaction_count: 2 },
  })).detail
  assert.match(provisional, /3 needs_review transactions/)
  assert.match(provisional, /2 provisional canonical transactions/)

  const incomplete = qualityCopy(metrics({
    quality_status: 'incomplete',
    missing_fx_count: 2,
    zero_placeholder_count: 1,
    quality_metadata: {
      ...metrics().quality_metadata,
      missing_fx_currencies: ['USD'],
      income_incomplete_count: 1,
      consumption_incomplete_count: 2,
      savings_movement_incomplete_count: 1,
      zero_placeholder_count: 1,
    },
  })).detail
  assert.match(incomplete, /1 unresolved zero placeholder/)
  assert.match(incomplete, /2 entries missing required FX \(USD\)/)
  assert.match(incomplete, /1 incomplete posted-income input/)
  assert.match(incomplete, /2 incomplete consumption inputs/)
  assert.match(incomplete, /1 incomplete savings-movement input/)
})

const budgetRows = [
  { category: 'Groceries', actual_aed: 550, quality_status: 'complete' },
  { category: 'Refunds', actual_aed: -50, quality_status: 'complete' },
]

test('category breakdown includes refunds and reconciles exactly to canonical consumption', () => {
  const result = categoryConsumptionGroups(budgetRows, 500)
  assert.equal(result.reconciles, true)
  assert.equal(result.groups.reduce((sum, group) => sum + group.value, 0), 500)
  assert.equal(result.groups.find((group) => group.key === 'Refunds').value, -50)
})

test('category breakdown fails closed instead of presenting a plausible partial sum', () => {
  assert.equal(categoryConsumptionGroups(budgetRows, 499).reconciles, false)
  assert.deepEqual(categoryConsumptionGroups(budgetRows, null).groups, [])
})

test('Transfer/card settlement is excluded and Savings & Investments stays savings movement', () => {
  const rows = [
    { id: 'consume', economic_classification: 'consumption_spend', consumption_spend_aed: 500, quality_status: 'complete', owner: 'Shrey', note: 'Grocer' },
    { id: 'save', economic_classification: 'savings_movement', consumption_spend_aed: null, savings_movement_aed: 200, quality_status: 'complete', owner: 'Tarika', note: 'Broker' },
    { id: 'card', economic_classification: 'internal_transfer', consumption_spend_aed: null, quality_status: 'complete', owner: 'Joint', note: 'Card payment' },
  ]
  const result = ledgerConsumptionGroups(rows, 'owner', 500)
  assert.deepEqual(result.groups.map((group) => group.key), ['Shrey'])
})

test('recorded person buckets preserve Shrey, Tarika, Joint and Unassigned exactly', () => {
  const rows = ['Shrey', 'Tarika', 'Joint', null].map((person, index) => ({ person, source: 'Salary', kind: 'salary', amount_aed: 100, quality_status: 'complete', id: String(index) }))
  const result = incomeGroups(rows, 'person', 400)
  assert.deepEqual(new Set(result.groups.map((group) => group.key)), new Set(['Shrey', 'Tarika', 'Joint', 'Unassigned']))
})

test('Sankey renders only when nonnegative canonical flows reconcile at cents', () => {
  const valid = buildSankeyModel({
    metrics: metrics(),
    sources: [{ key: 'salary', label: 'Salary', value: 1000 }],
    consumption: [{ key: 'needs', label: 'Needs', value: 500 }],
  })
  assert.equal(valid.canRender, true)
  assert.equal(valid.destinations.reduce((sum, group) => sum + group.value, 0), 1000)
  assert.equal(buildSankeyModel({ metrics: metrics({ cash_retained_aed: -1, cash_flow_aed: -1 }), sources: [{ key: 'salary', label: 'Salary', value: 1000 }], consumption: [{ key: 'needs', label: 'Needs', value: 500 }] }).canRender, false)
  assert.equal(buildSankeyModel({ metrics: metrics(), sources: [{ key: 'salary', label: 'Salary', value: 999.98 }], consumption: [{ key: 'needs', label: 'Needs', value: 500 }] }).canRender, false)
})

test('migrated Home and Reports source files do not recreate canonical headline arithmetic', () => {
  for (const file of ['src/screens/Home.jsx', 'src/screens/Reports.jsx']) {
    const source = readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8')
    assert.doesNotMatch(source, /\btotalAED\b|\bsumByCategoryAED\b|\bsumByGroupAED\b|\bsumByMerchantAED\b|\bmonthlyTrend\b/)
    if (file.endsWith('Reports.jsx')) assert.doesNotMatch(source, /\btoAED\b/)
  }
})
