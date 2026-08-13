import { supabase } from './supabaseClient'

// Scheduling rules live in their own module so they can be tested without the
// Supabase client. Re-exported here so existing call sites are unaffected.
export {
  RECURRING_KINDS,
  MONTH_NAMES,
  nextDueDate,
  daysUntil,
  occursInMonth,
  isBill,
} from './recurringSchedule'


export async function listRecurring() {
  const { data, error } = await supabase.from('recurring').select('*').order('name', { ascending: true })
  if (error) throw error
  return data
}

export async function createRecurring(fields) {
  const { data, error } = await supabase.from('recurring').insert(fields).select().single()
  if (error) throw error
  return data
}

export async function updateRecurring(id, patch) {
  const { data, error } = await supabase.from('recurring').update(patch).eq('id', id).select().single()
  if (error) throw error
  return data
}

export async function deleteRecurring(id) {
  const { error } = await supabase.from('recurring').delete().eq('id', id)
  if (error) throw error
}
