import { supabase } from './supabaseClient'
import { buildNetWorthHistory } from './snapshotHistory'
import { normalizeAuthoritativeNetWorthHistory } from './authoritativeNetWorthHistory'

const HISTORY_PAGE_SIZE = 1000

async function readHistoryPages({ table, columns, dateColumn, from, to, status = null, limit }) {
  const rows = []
  while (rows.length <= limit) {
    const pageSize = Math.min(HISTORY_PAGE_SIZE, limit + 1 - rows.length)
    let query = supabase.from(table)
      .select(columns)
      .order(dateColumn, { ascending: true })
      .range(rows.length, rows.length + pageSize - 1)
    if (status) query = query.eq('status', status)
    if (from) query = query.gte(dateColumn, from)
    if (to) query = query.lte(dateColumn, to)
    const result = await query
    if (result.error) throw result.error
    const page = result.data ?? []
    rows.push(...page)
    if (page.length < pageSize) break
  }
  if (rows.length > limit) {
    throw new Error(`Authoritative snapshot history exceeds the explicit ${limit}-row read limit`)
  }
  return rows
}

/** Read-only authoritative/legacy history. Missing dates remain explicit gaps. */
export async function listDailyNetWorth(limitDays = 90) {
  let [dailyResult, runResult] = await Promise.all([
    supabase.from('nw_daily').select([
      'day', 'total_aed', 'assets_aed', 'liabilities_aed', 'run_id',
      'snapshot_at', 'published_at', 'quality_status', 'investment_value_aed',
      'source_version', 'quality_evidence', 'input_digest',
    ].join(',')).order('day', { ascending: false }).limit(limitDays),
    supabase
      .from('nw_snapshot_runs')
      .select('id,target_day,status,snapshot_at,quality_status,final_evidence')
      .order('target_day', { ascending: false })
      .limit(limitDays),
  ])
  // Phase-A deploy previews point at production before migration 043 is
  // applied. Preserve a read-only legacy preview without reviving any writer.
  if (dailyResult.error?.code === '42703') {
    dailyResult = await supabase.from('nw_daily')
      .select('day,total_aed,assets_aed,liabilities_aed')
      .order('day', { ascending: false })
      .limit(limitDays)
    dailyResult.data = (dailyResult.data ?? []).map((row) => ({ ...row, run_id: null }))
  }
  if (runResult.error?.code === '42P01') runResult = { data: [], error: null }
  if (dailyResult.error) throw dailyResult.error
  if (runResult.error) throw runResult.error
  return buildNetWorthHistory(dailyResult.data, runResult.data)
}

/**
 * Read-only V6 history contract.
 *
 * Unlike the legacy Accounts mapper, this returns only dates present in
 * `nw_daily` or a terminal `skipped_incomplete` run. It never creates a date
 * between two observations, duplicates a previous point, interpolates, or
 * turns a missing publication into zero.
 */
export async function listAuthoritativeNetWorthHistory({ from = null, to = null, limit = 5000 } = {}) {
  if (!Number.isInteger(limit) || limit < 1) throw new Error('Authoritative snapshot history limit must be a positive integer')
  const [dailyRows, skippedRows] = await Promise.all([
    readHistoryPages({
      table: 'nw_daily',
      columns: [
        'day', 'total_aed', 'assets_aed', 'liabilities_aed', 'run_id',
        'snapshot_at', 'published_at', 'quality_status', 'source_version',
        'quality_evidence', 'input_digest',
      ].join(','),
      dateColumn: 'day', from, to, limit,
    }),
    readHistoryPages({
      table: 'nw_snapshot_runs',
      columns: 'id,target_day,status,snapshot_at,final_evidence',
      dateColumn: 'target_day', from, to, status: 'skipped_incomplete', limit,
    }),
  ])
  return normalizeAuthoritativeNetWorthHistory(dailyRows, skippedRows)
}

export { buildNetWorthHistory }
