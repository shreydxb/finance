import { supabase } from './supabaseClient'

export const RECURRING_KINDS = ['income', 'expense', 'emi']

export const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
]

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

function clampDay(year, month, day) {
  const lastDay = new Date(year, month, 0).getDate()
  return Math.min(day, lastDay)
}

// Next occurrence on/after `from` (Date). Returns a Date, or null if the
// entry has no day_of_month set, or if it's a finite series that has ended.
export function nextDueDate(entry, from = new Date()) {
  if (!entry.day_of_month) return null
  const endDate = entry.end_date ? new Date(`${entry.end_date}T23:59:59`) : null
  const months = entry.months && entry.months.length > 0 ? entry.months : null

  let year = from.getFullYear()
  let month = from.getMonth() + 1

  for (let i = 0; i < 24; i++) {
    if (!months || months.includes(month)) {
      const day = clampDay(year, month, entry.day_of_month)
      const candidate = new Date(year, month - 1, day)
      if (candidate >= new Date(from.getFullYear(), from.getMonth(), from.getDate())) {
        if (endDate && candidate > endDate) return null
        return candidate
      }
    }
    month += 1
    if (month > 12) {
      month = 1
      year += 1
    }
  }
  return null
}

export function daysUntil(date, from = new Date()) {
  const a = new Date(from.getFullYear(), from.getMonth(), from.getDate())
  const b = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  return Math.round((b - a) / 86400000)
}
