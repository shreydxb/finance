import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

import {
  buildSankeyModel,
  categoryConsumptionGroups,
  incomeGroups,
  ledgerConsumptionGroups,
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
    ...overrides,
  }
}

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
