import { supabase } from './supabaseClient'

export const INCOME_KINDS = ['salary', 'bonus', 'dividend', 'interest', 'trading_pnl', 'other']

export async function listIncome(filters = {}) {
  let query = supabase.from('income').select('*')
  if (filters.dateFrom) query = query.gte('date', filters.dateFrom)
  if (filters.dateTo) query = query.lte('date', filters.dateTo)
  if (filters.person) query = query.eq('person', filters.person)
  if (filters.kind) query = query.eq('kind', filters.kind)
  query = query.order('date', { ascending: false })
  const { data, error } = await query
  if (error) throw error
  return data
}

export async function createIncome(fields) {
  const { data, error } = await supabase.from('income').insert(fields).select().single()
  if (error) throw error
  return data
}

export async function updateIncome(id, patch) {
  const { data, error } = await supabase.from('income').update(patch).eq('id', id).select().single()
  if (error) throw error
  return data
}

export async function deleteIncome(id) {
  const { error } = await supabase.from('income').delete().eq('id', id)
  if (error) throw error
}
