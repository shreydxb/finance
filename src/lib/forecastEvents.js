import { supabase } from './supabaseClient'

export const EVENT_KINDS = [
  { value: 'house', label: 'Buy a home', icon: '🏠' },
  { value: 'child', label: 'Have a kid', icon: '👶' },
  { value: 'retirement', label: 'Retire', icon: '🌴' },
  { value: 'custom', label: 'Custom', icon: '📌' },
]

export async function listForecastEvents() {
  const { data, error } = await supabase.from('forecast_events').select('*').order('target_date', { ascending: true })
  if (error) throw error
  return data
}

export async function createForecastEvent(fields) {
  const { data, error } = await supabase.from('forecast_events').insert(fields).select().single()
  if (error) throw error
  return data
}

export async function updateForecastEvent(id, patch) {
  const { data, error } = await supabase.from('forecast_events').update(patch).eq('id', id).select().single()
  if (error) throw error
  return data
}

export async function deleteForecastEvent(id) {
  const { error } = await supabase.from('forecast_events').delete().eq('id', id)
  if (error) throw error
}
