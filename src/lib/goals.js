import { supabase } from './supabaseClient'

export async function listGoals() {
  const { data, error } = await supabase.from('goals').select('*').order('priority', { ascending: true, nullsFirst: false })
  if (error) throw error
  return data
}

export async function createGoal(fields) {
  const { data, error } = await supabase.from('goals').insert(fields).select().single()
  if (error) throw error
  return data
}

export async function updateGoal(id, patch) {
  const { data, error } = await supabase.from('goals').update(patch).eq('id', id).select().single()
  if (error) throw error
  return data
}

export async function deleteGoal(id) {
  const { error } = await supabase.from('goals').delete().eq('id', id)
  if (error) throw error
}

export async function listAllContributions() {
  const { data, error } = await supabase.from('goal_contributions').select('*').order('date', { ascending: false })
  if (error) throw error
  return data
}

export async function createContribution(fields) {
  const { data, error } = await supabase.from('goal_contributions').insert(fields).select().single()
  if (error) throw error
  return data
}

export function projectedCompletionDate(remaining, monthlyPlan, from = new Date()) {
  if (!monthlyPlan || monthlyPlan <= 0 || remaining <= 0) return null
  const months = Math.ceil(remaining / monthlyPlan)
  const d = new Date(from.getFullYear(), from.getMonth() + months, from.getDate())
  return d
}
