import { supabase } from './supabaseClient'
import { toAED } from './money'

/**
 * Net-worth history, recorded client-side.
 *
 * There is no server-side cron here, so "record a snapshot" happens when the
 * app is opened. The day is the primary key and writes are upserts, so opening
 * the app five times in a day overwrites one row rather than creating five —
 * and the value recorded is always the latest for that day.
 *
 * Consequence worth knowing: history only exists for days the app was actually
 * opened. Gaps are real gaps, not zeroes, so the chart connects across them
 * rather than dropping to the axis.
 */
export async function listDailyNetWorth(limitDays = 90) {
  const { data, error } = await supabase
    .from('nw_daily')
    .select('day, total_aed, assets_aed, liabilities_aed')
    .order('day', { ascending: false })
    .limit(limitDays)
  if (error) throw error
  return (data ?? []).slice().reverse()
}

export async function recordDailyNetWorth(accounts, fxRates) {
  if (!accounts?.length) return null

  let assets = 0
  let liabilities = 0
  const byOwner = {}
  const byType = {}

  for (const a of accounts) {
    const aed = toAED(Number(a.value) || 0, a.currency, fxRates)
    const signed = a.is_liability ? -aed : aed
    if (a.is_liability) liabilities += aed
    else assets += aed
    byOwner[a.owner] = (byOwner[a.owner] || 0) + signed
    byType[a.type] = (byType[a.type] || 0) + signed
  }

  const day = new Date().toISOString().slice(0, 10)
  const { error } = await supabase.from('nw_daily').upsert(
    {
      day,
      total_aed: assets - liabilities,
      assets_aed: assets,
      liabilities_aed: liabilities,
      by_owner: byOwner,
      by_type: byType,
    },
    { onConflict: 'day' }
  )
  if (error) throw error
  return { day, total: assets - liabilities }
}
