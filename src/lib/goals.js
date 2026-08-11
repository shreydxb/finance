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

/**
 * Compound-interest projection for an FD-linked goal — display only. The
 * account's real value always comes from the bank statement (money-data
 * rule); this never writes anywhere, it just answers "at this rate and this
 * monthly contribution, when would the balance cross the target?" so the
 * estimate updates itself the moment a new contribution or a fresh statement
 * value is entered, with no separate recompute step.
 */
export function projectedFDCompletion(currentValue, targetAmount, annualRatePct, monthlyContribution = 0, from = new Date()) {
  if (currentValue >= targetAmount) return { months: 0, date: new Date(from) }
  const monthlyRate = (Number(annualRatePct) || 0) / 100 / 12
  if (monthlyRate <= 0 && monthlyContribution <= 0) return null // never gets there

  let balance = currentValue
  const MAX_MONTHS = 600 // 50 years — a sane cap rather than looping forever
  for (let months = 1; months <= MAX_MONTHS; months++) {
    balance = balance * (1 + monthlyRate) + monthlyContribution
    if (balance >= targetAmount) {
      const d = new Date(from.getFullYear(), from.getMonth() + months, from.getDate())
      return { months, date: d }
    }
  }
  return null
}
