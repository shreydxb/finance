import { supabase } from './supabaseClient'
import {
  normalizeCanonicalBudgetRows,
  normalizeCanonicalAccountRows,
  normalizeCanonicalBalanceSheet,
  normalizeCanonicalIncomeRows,
  normalizeCanonicalInvestmentMetrics,
  normalizeCanonicalLedgerRows,
  normalizeCanonicalPeriodResponse,
} from './canonicalContracts'

const LEDGER_COLUMNS = [
  'id', 'date', 'amount', 'currency', 'category', 'owner', 'note', 'tags', 'account_id',
  'needs_review', 'transaction_group_id', 'group_kind', 'transfer_direction',
  'economic_classification', 'classification_reason', 'quality_status', 'amount_aed',
  'consumption_spend_aed', 'savings_movement_aed',
].join(',')

const INCOME_COLUMNS = [
  'id', 'date', 'amount', 'currency', 'person', 'source', 'kind',
  'amount_aed', 'quality_status',
].join(',')

// SHR-180 adds `canonical_value_native` and `freshness_status`. Both are
// published by `v_canonical_accounts_aed` itself (041): the native figure is
// the canonical valuation in the account's own currency, and the freshness
// status is the view's own categorisation of where the valuation timestamp
// comes from. Selecting them lets Accounts state the native and AED positions
// as two separately published facts instead of converting one into the other.
const ACCOUNT_COLUMNS = [
  'id', 'name', 'owner', 'type', 'is_liability', 'currency',
  'canonical_value_native', 'canonical_value_aed',
  'quality_status', 'valuation_method', 'valuation_as_of', 'freshness_status',
  'fx_rate_to_aed', 'fx_updated_at',
].join(',')

function canonicalRequest({ from, to, scope = 'household', person = null }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from ?? '') || !/^\d{4}-\d{2}-\d{2}$/.test(to ?? '') || from > to) {
    throw new Error('Canonical request requires a valid inclusive date range')
  }
  if (!['household', 'person'].includes(scope)) throw new Error(`Unknown canonical scope: ${String(scope)}`)
  if (person !== null && (typeof person !== 'string' || person.trim() === '')) throw new Error('Canonical person scope must be non-empty text or null')
  if (scope === 'household' && person !== null) throw new Error('Household canonical scope cannot include a person')
  return { from, to, scope, person }
}

function applyPersonScope(query, column, request) {
  if (request.scope !== 'person') return query
  return request.person === null ? query.is(column, null) : query.eq(column, request.person)
}

export async function getCanonicalPeriodMetrics(input) {
  const request = canonicalRequest(input)
  const { data, error } = await supabase.rpc('canonical_period_metrics', {
    p_start: request.from,
    p_end: request.to,
    p_scope: request.scope,
    p_person: request.person,
  })
  if (error) throw error
  return normalizeCanonicalPeriodResponse(data, request)
}

export async function getCanonicalPeriodSeries(requests) {
  if (!Array.isArray(requests)) throw new Error('Canonical period series requires an array')
  return Promise.all(requests.map(getCanonicalPeriodMetrics))
}

export async function listCanonicalBudgetActuals(input) {
  const request = canonicalRequest(input)
  const { data, error } = await supabase.rpc('canonical_budget_actuals', {
    p_start: request.from,
    p_end: request.to,
    p_scope: request.scope,
    p_person: request.person,
  })
  if (error) throw error
  return normalizeCanonicalBudgetRows(data)
}

export async function listCanonicalLedgerRows(input) {
  const request = canonicalRequest(input)
  let query = supabase
    .from('v_canonical_ledger_aed')
    .select(LEDGER_COLUMNS)
    .gte('date', request.from)
    .lte('date', request.to)
    .order('date', { ascending: false })
  query = applyPersonScope(query, 'owner', request)
  const { data, error } = await query
  if (error) throw error
  return normalizeCanonicalLedgerRows(data)
}

export async function listCanonicalIncomeRows(input) {
  const request = canonicalRequest(input)
  let query = supabase
    .from('v_canonical_income_aed')
    .select(INCOME_COLUMNS)
    .gte('date', request.from)
    .lte('date', request.to)
    .order('date', { ascending: false })
  query = applyPersonScope(query, 'person', request)
  const { data, error } = await query
  if (error) throw error
  return normalizeCanonicalIncomeRows(data)
}

export async function loadCanonicalReportPeriod(input) {
  const request = canonicalRequest(input)
  const [metrics, budgetActuals, ledgerRows, incomeRows] = await Promise.all([
    getCanonicalPeriodMetrics(request),
    listCanonicalBudgetActuals(request),
    listCanonicalLedgerRows(request),
    listCanonicalIncomeRows(request),
  ])
  return Object.freeze({ metrics, budgetActuals, ledgerRows, incomeRows })
}

export async function getCanonicalBalanceSheet() {
  const { data, error } = await supabase.rpc('canonical_balance_sheet', {
    p_scope: 'household',
    p_person: null,
  })
  if (error) throw error
  return normalizeCanonicalBalanceSheet(data)
}

export async function getCanonicalInvestmentMetrics() {
  // SHR-113 freshness thresholds are intentionally absent here. This remains
  // the generic SHR-111 current investment contract.
  const { data, error } = await supabase.rpc('canonical_investment_metrics', {
    p_scope: 'household',
    p_person: null,
    p_stale_before: null,
  })
  if (error) throw error
  return normalizeCanonicalInvestmentMetrics(data)
}

export async function listCanonicalAccounts() {
  const { data, error } = await supabase
    .from('v_canonical_accounts_aed')
    .select(ACCOUNT_COLUMNS)
    .order('id', { ascending: true })
  if (error) throw error
  return normalizeCanonicalAccountRows(data)
}

export async function loadCanonicalWealth() {
  const [balance, investments, accounts] = await Promise.all([
    getCanonicalBalanceSheet(),
    getCanonicalInvestmentMetrics(),
    listCanonicalAccounts(),
  ])
  return Object.freeze({ balance, investments, accounts })
}
