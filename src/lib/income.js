import { supabase } from './supabaseClient'

export async function listIncome(filters = {}) {
  let query = supabase.from('income').select('*')
  if (filters.dateFrom) query = query.gte('date', filters.dateFrom)
  if (filters.dateTo) query = query.lte('date', filters.dateTo)
  const { data, error } = await query
  if (error) throw error
  return data
}
