import { supabase } from './supabaseClient'

export const BUDGET_GROUPS = ['Fixed', 'Non-monthly', 'Flexible']

export async function listBudgets() {
  const { data, error } = await supabase.from('budgets').select('*, category:categories(id, name, icon, group)')
  if (error) throw error
  return data
}

export async function upsertBudget({ id, category_id, monthly_limit, group }) {
  if (id) {
    const { data, error } = await supabase
      .from('budgets')
      .update({ monthly_limit, group })
      .eq('id', id)
      .select()
      .single()
    if (error) throw error
    return data
  }
  const { data, error } = await supabase
    .from('budgets')
    .insert({ category_id, monthly_limit, group })
    .select()
    .single()
  if (error) throw error
  return data
}
