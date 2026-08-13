import { supabase } from './supabaseClient'

export async function getSetting(key) {
  const { data, error } = await supabase.from('settings').select('value').eq('key', key).maybeSingle()
  if (error) throw error
  return data?.value ?? null
}

export async function upsertSetting(key, value) {
  const { data, error } = await supabase
    .from('settings')
    .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: 'key' })
    .select()
    .single()
  if (error) throw error
  return data
}

/**
 * Save the whole Telegram configuration in one transaction (UI-03).
 *
 * Replaces four concurrent upserts, any subset of which could fail and leave
 * the household believing they had saved a configuration the bot never read.
 */
export async function saveTelegramSettings({ person1, person2, threshold, defaultAccountId }) {
  const { error } = await supabase.rpc('save_telegram_settings', {
    p_person1: person1,
    p_person2: person2,
    p_threshold: threshold,
    p_default_account_id: defaultAccountId,
  })
  if (error) throw error
}
