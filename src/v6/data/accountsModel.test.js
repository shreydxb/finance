import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { normalizeCanonicalAccountRows } from '../../lib/canonicalContracts.js'
import { buildAccountsModel, resolveAccountDetail } from './accountsModel.js'
import { composeAccounts } from './composeAccounts.js'
import { resolveAccountsGrouping } from './accountsGrouping.js'
import { ACCOUNTS_GAPS } from './accountsGaps.js'
import {
  ACCOUNTS_FIXTURE_MISSING_FX_ROW,
  ACCOUNTS_FIXTURE_ROWS,
  accountsFixtureReads,
  accountsFixtureReadsWith,
} from '../fixtures/accountsFixture.js'

const BALANCE = {
  scope: 'household', person: null,
  assets_aed: 2669785, liabilities_aed: 531203, net_worth_aed: 2138582,
  quality_status: 'provisional', incomplete_account_count: 0,
  provisional_account_count: 1, missing_fx_count: 0,
  quality_metadata: { fx_basis: 'current_rate_aed', classification_version: 'shr-111-phase-a-v1', fx_updated_at: '2026-08-28T07:15:00.000Z' },
}

function model(overrides = {}) {
  return buildAccountsModel({ group: 'type', balanceSheet: BALANCE, accounts: ACCOUNTS_FIXTURE_ROWS, ...overrides })
}

function allRows(built) {
  return built.positions.rows
}

test('the canonical account contract validates and carries native and AED as separate facts', () => {
  const rows = normalizeCanonicalAccountRows([...ACCOUNTS_FIXTURE_ROWS, ACCOUNTS_FIXTURE_MISSING_FX_ROW])
  const usd = rows.find((row) => row.currency === 'USD')
  assert.equal(usd.canonical_value_native, 118250)
  assert.equal(usd.canonical_value_aed, 434273.13)
  const chf = rows.find((row) => row.currency === 'CHF')
  assert.equal(chf.canonical_value_native, 39415, 'a native value survives without an AED counterpart')
  assert.equal(chf.canonical_value_aed, null)
  assert.throws(
    () => normalizeCanonicalAccountRows([{ ...ACCOUNTS_FIXTURE_MISSING_FX_ROW, canonical_value_aed: '144793.1', quality_status: 'complete' }]),
    /exposes an AED value without published FX evidence/,
    'an AED value with no published FX evidence is refused, not accepted',
  )
})

test('a missing AED valuation fails closed and is never derived from the native value', () => {
  const built = model({ accounts: [...ACCOUNTS_FIXTURE_ROWS, ACCOUNTS_FIXTURE_MISSING_FX_ROW] })
  const row = allRows(built).find((candidate) => candidate.currency === 'CHF')
  assert.equal(row.native.status, 'available')
  assert.equal(row.native.value, 39415)
  assert.equal(row.aed.status, 'incomplete')
  assert.equal(row.aed.value, undefined, 'an unavailable AED slot carries no number at all')
  assert.match(row.aed.reason, /No published FX rate for CHF/)
  assert.match(row.aed.reason, /not converted here/)
  const source = readFileSync(new URL('./accountsModel.js', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /fx_rate_to_aed\s*[*/]|[*/]\s*fx_rate_to_aed|fxRate\s*[*/]|[*/]\s*fxRate/)
})

test('native and AED slots name distinct canonical sources and are never interchanged', () => {
  const built = model()
  for (const row of allRows(built)) {
    if (row.native.status === 'available') assert.equal(row.native.source, 'v_canonical_accounts_aed.canonical_value_native')
    if (row.aed.status === 'available') assert.equal(row.aed.source, 'v_canonical_accounts_aed.canonical_value_aed')
  }
  const inr = allRows(built).find((row) => row.currency === 'INR')
  assert.notEqual(inr.native.value, inr.aed.value, 'a non-AED account keeps two different published figures')
})

test('legacy owner text never enters the model and ownership fails closed to SHR-154/SHR-156', () => {
  const built = model()
  const serialised = JSON.stringify(built)
  for (const row of ACCOUNTS_FIXTURE_ROWS) {
    assert.ok(!serialised.includes(row.owner), `legacy owner label ${row.owner} must not reach the model`)
  }
  for (const row of allRows(built)) {
    assert.equal(row.ownership.status, 'unavailable')
    assert.equal(row.ownership.gap.contract, ACCOUNTS_GAPS.ownership.contract)
    assert.match(row.ownership.gap.contract, /SHR-154 \/ SHR-156/)
    assert.equal(row.owner, undefined, 'no owner field exists on a position row')
  }
  const source = readFileSync(new URL('./accountsModel.js', import.meta.url), 'utf8')
  assert.doesNotMatch(source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1'), /row\.owner|\.owner\b/)
})

test('shared wealth is neither duplicated per person nor divided, and personal scope names SHR-156', () => {
  const built = model()
  const ids = allRows(built).map((row) => row.id)
  assert.equal(new Set(ids).size, ids.length, 'every account appears exactly once')
  assert.equal(ids.length, ACCOUNTS_FIXTURE_ROWS.length)
  assert.equal(built.gaps.scope.status, 'unavailable')
  assert.match(built.gaps.scope.gap.contract, /SHR-156 \/ SHR-173/)
  assert.match(built.gaps.scope.gap.detail, /never duplicated into two people and never divided 50\/50/)
  const source = readFileSync(new URL('./accountsModel.js', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /\/\s*2\b|0\.5|allocat(e|ion)|share\s*=/i)
})

test('household totals come from the balance sheet, not from summing the rows', () => {
  const built = model()
  assert.equal(built.totals.net.status, 'available')
  assert.equal(built.totals.net.value, 2138582)
  assert.equal(built.totals.net.source, 'canonical_balance_sheet.net_worth_aed')
  assert.equal(built.totals.assets.source, 'canonical_balance_sheet.assets_aed')
  assert.equal(built.totals.liabilities.source, 'canonical_balance_sheet.liabilities_aed')
  const rowSum = allRows(built)
    .filter((row) => row.aed.status === 'available')
    .reduce((total, row) => total + (row.isLiability ? -row.aed.value : row.aed.value), 0)
  assert.notEqual(built.totals.net.value, rowSum, 'the published total is not the browser sum of the visible rows')
  for (const section of built.positions.sections) {
    assert.equal(section.total.status, 'unavailable')
    assert.match(section.total.gap.contract, /SHR-173/)
  }
})

test('an incomplete balance sheet withholds every total instead of estimating one', () => {
  const built = model({ balanceSheet: { ...BALANCE, assets_aed: null, liabilities_aed: null, net_worth_aed: null, quality_status: 'incomplete', incomplete_account_count: 1 } })
  for (const key of ['net', 'assets', 'liabilities']) {
    assert.equal(built.totals[key].status, 'incomplete')
    assert.equal(built.totals[key].value, undefined)
  }
  assert.equal(built.totals.quality, 'incomplete')
})

test('classification uses the canonical type and is_liability, never a name heuristic', () => {
  const renamed = ACCOUNTS_FIXTURE_ROWS.map((row) => ({ ...row, name: 'Mortgage loan credit card savings property' }))
  const built = model({ accounts: renamed })
  const bySide = new Map(built.positions.sections.map((section) => [section.key, section.isLiability]))
  assert.equal(bySide.get('savings'), false)
  assert.equal(bySide.get('credit_card'), true)
  assert.equal(bySide.get('mortgage'), true)
  assert.equal(bySide.get('property'), false)
  const liabilityFirst = built.positions.sections.findIndex((section) => section.isLiability)
  assert.ok(built.positions.sections.slice(liabilityFirst).every((section) => section.isLiability), 'assets precede liabilities')
  const source = readFileSync(new URL('./accountsModel.js', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /name\.(?:includes|match|startsWith|endsWith|toLowerCase)|\/.*\/\.test\(\s*\w*name/i)
})

test('liability magnitudes stay positive and carry their side as text', () => {
  const built = model()
  for (const row of allRows(built)) {
    if (row.aed.status !== 'available') continue
    assert.ok(row.aed.value >= 0, `${row.name} keeps the canonical positive magnitude`)
    assert.equal(row.sideLabel, row.isLiability ? 'Liability' : 'Asset')
  }
})

test('valuation evidence is reported as published and never becomes a freshness verdict', () => {
  const built = model()
  const usd = allRows(built).find((row) => row.currency === 'USD')
  assert.equal(usd.valuationAsOf, '2026-08-27T20:00:00.000Z')
  assert.equal(usd.valuationMethod, 'Quantity × last published price')
  assert.equal(usd.freshnessEvidence, 'Published price timestamp')
  assert.equal(built.gaps.freshness.status, 'unavailable')
  assert.match(built.gaps.freshness.gap.contract, /SHR-172 \/ SHR-173/)
  assert.equal(built.gaps.provenance.status, 'unavailable')
  assert.match(built.gaps.provenance.gap.contract, /SHR-172/)
  const source = readFileSync(new URL('./accountsModel.js', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1')
  assert.doesNotMatch(source, /\bstale\b|isStale|staleAfter|threshold|daysSince|ageInDays|Date\.now|new Date\(/i)
})

test('grouping honours only the supported option and says so when a link asks for owner', () => {
  assert.equal(resolveAccountsGrouping('type').key, 'type')
  const owner = resolveAccountsGrouping('owner')
  assert.equal(owner.key, 'type', 'an owner grouping request resolves to the supported grouping')
  assert.equal(owner.requested, 'owner')
  assert.equal(owner.honoured, false)
  assert.equal(resolveAccountsGrouping('nonsense').key, 'type')
  assert.equal(resolveAccountsGrouping(undefined).key, 'type')
  const built = model({ group: 'owner' })
  assert.equal(built.grouping.honoured, false)
  assert.equal(built.gaps.ownerGrouping.status, 'unavailable')
})

test('summary counts are structural and make no freshness claim', () => {
  const built = model()
  assert.equal(built.summary.accountCount, ACCOUNTS_FIXTURE_ROWS.length)
  assert.deepEqual(built.summary.currencies, ['AED', 'INR', 'USD'])
  assert.equal(built.summary.currencyCount, 3)
})

test('every write and maintenance capability fails closed to a named lifecycle contract', () => {
  const built = model()
  for (const key of ['add', 'edit', 'revalue', 'archive']) {
    assert.equal(built.capabilities[key].status, 'unavailable')
    assert.match(built.capabilities[key].gap.contract, /SHR-172/)
  }
  assert.match(built.capabilities.changeOwner.gap.contract, /SHR-154 \/ SHR-156/)
  assert.match(built.capabilities.countTowardNetWorth.gap.contract, /SHR-173/)
})

test('the detail resolver fails closed for an unknown or inaccessible account id', () => {
  const built = model()
  assert.equal(resolveAccountDetail(built, null).status, 'none')
  const found = resolveAccountDetail(built, ACCOUNTS_FIXTURE_ROWS[0].id)
  assert.equal(found.status, 'found')
  assert.equal(found.row.name, ACCOUNTS_FIXTURE_ROWS[0].name)
  const missing = resolveAccountDetail(built, '99999999-0000-4000-8000-000000000000')
  assert.equal(missing.status, 'unavailable')
  assert.equal(missing.row, null)
  assert.match(missing.slot.gap.detail, /not evidence that a record exists/)
  assert.equal(resolveAccountDetail(null, 'anything').status, 'unavailable')
})

test('the detail row manufactures no history, valuation series, contribution or return', () => {
  const built = model()
  const row = resolveAccountDetail(built, ACCOUNTS_FIXTURE_ROWS[1].id).row
  for (const forbidden of ['history', 'series', 'contributions', 'returnPct', 'performance', 'costBasis', 'unrealizedPnl', 'dayChange', 'allocation']) {
    assert.equal(row[forbidden], undefined, `a detail row must not carry ${forbidden}`)
  }
  assert.match(built.gaps.history.gap.detail, /contributions minus withdrawals is not a current value/)
  assert.match(built.gaps.performance.gap.contract, /SHR-174 \/ SHR-176/)
})

test('composition reads only the two approved contracts and calls no other reader', async () => {
  const called = []
  const forbidden = async () => { throw new Error('forbidden reader called') }
  const built = await composeAccounts({
    group: 'type',
    reads: {
      getBalanceSheet: async () => { called.push('balanceSheet'); return accountsFixtureReads.getBalanceSheet() },
      listAccounts: async () => { called.push('accounts'); return accountsFixtureReads.listAccounts() },
      listLedgerRows: forbidden, listTransactions: forbidden, listIncomeRows: forbidden,
      listNetWorthHistory: forbidden, getInvestments: forbidden, listBudgetActuals: forbidden,
    },
  })
  assert.deepEqual([...called].sort(), ['accounts', 'balanceSheet'])
  assert.equal(built.positions.status, 'available')
})

test('a failed read is stated honestly and never falls back to a legacy or reconstructed value', async () => {
  const built = await composeAccounts({ group: 'type', reads: accountsFixtureReadsWith('failed') })
  assert.equal(built.positions.status, 'unavailable')
  assert.match(built.positions.reason, /No legacy account reader, browser conversion or transaction reconstruction is substituted/)
  assert.equal(built.totals.net.status, 'unavailable')
  const empty = await composeAccounts({ group: 'type', reads: accountsFixtureReadsWith('empty') })
  assert.equal(empty.positions.status, 'empty')
  assert.equal(empty.positions.rows.length, 0)
})

test('one read failing does not erase the other', async () => {
  const built = await composeAccounts({
    group: 'type',
    reads: {
      getBalanceSheet: accountsFixtureReads.getBalanceSheet,
      listAccounts: async () => { throw new Error('account read failed') },
    },
  })
  assert.equal(built.totals.net.status, 'available')
  assert.equal(built.positions.status, 'unavailable')
})

test('no prototype demo balance appears anywhere in the Accounts data tree', () => {
  const sources = ['./accountsModel.js', './accountsGaps.js', './accountsGrouping.js', './composeAccounts.js', '../fixtures/accountsFixture.js']
    .map((path) => readFileSync(new URL(path, import.meta.url), 'utf8')).join('\n')
  for (const demo of ['2847300', '2,847,300', '2450000', '266000', '166300', '150000', '28900', '212400', '84300', '96600', '460060', '8940', '3409091', '72400', '6800']) {
    assert.ok(!sources.includes(demo), `prototype demo value ${demo} must not appear in runtime data`)
  }
})
