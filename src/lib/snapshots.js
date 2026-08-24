import { supabase } from './supabaseClient'
import { buildNetWorthHistory } from './snapshotHistory'

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

export { buildNetWorthHistory }
