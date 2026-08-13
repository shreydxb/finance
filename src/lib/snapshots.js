import { supabase } from './supabaseClient'
import { todayLocal } from './dates'
import { missingCurrencies, toAED } from './money'

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

  // Refuse to record rather than record something wrong. `nw_daily` is keyed by
  // day, upserted, and never backfilled — a bad row here is permanent, and the
  // household holds accounts in INR and USD, so an unloaded FX rate is a real
  // scenario rather than a theoretical one. Skipping costs one day of history;
  // writing costs a corrupt net-worth chart with no way back.
  const unconvertible = missingCurrencies(
    accounts.map((a) => a.currency),
    fxRates
  )
  if (unconvertible.length > 0) {
    return { skipped: true, reason: 'fx-unavailable', currencies: unconvertible }
  }

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

  // Dubai's calendar day, not UTC's: between midnight and 04:00 local the UTC
  // date is still yesterday, and this row would overwrite yesterday's snapshot.
  const day = todayLocal()
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
