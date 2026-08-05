import { supabase } from './supabaseClient'

export async function getSetting(key) {
  const { data, error } = await supabase.from('settings').select('value').eq('key', key).maybeSingle()
  if (error) throw error
  return data?.value ?? null
}

export function toAED(value, currency, fxRates) {
  const rate = fxRates?.[currency]
  if (!rate) return value
  return value * rate
}
