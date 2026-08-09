import { supabase } from './supabaseClient'

export async function listRules() {
  const { data, error } = await supabase.from('category_rules').select('*').order('created_at', { ascending: false })
  if (error) throw error
  return data
}

export async function createRule(pattern, category) {
  const { data, error } = await supabase
    .from('category_rules')
    .insert({ pattern: pattern.trim(), category })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function deleteRule(id) {
  const { error } = await supabase.from('category_rules').delete().eq('id', id)
  if (error) throw error
}

/** First rule (newest-first) whose pattern appears in `note`, case-insensitive. Null if none match or note is empty. */
export function matchRule(rules, note) {
  if (!note) return null
  const lower = note.toLowerCase()
  return rules.find((r) => lower.includes(r.pattern.toLowerCase())) ?? null
}
