import { supabase } from './supabaseClient'

export const OWNERS = ['Shrey', 'Tarika', 'Joint']

export const CURRENCIES = ['AED', 'USD', 'INR']

export const ASSET_TYPES = [
  { value: 'cash', label: 'Cash', icon: '💵' },
  { value: 'investment', label: 'Investments', icon: '📈' },
  { value: 'real_estate', label: 'Real Estate', icon: '🏠' },
  { value: 'vehicle', label: 'Vehicles', icon: '🚗' },
  { value: 'valuable', label: 'Valuables', icon: '💎' },
  { value: 'other', label: 'Other', icon: '📦' },
]

export const LIABILITY_TYPES = [
  { value: 'credit_card', label: 'Credit Card', icon: '💳' },
  { value: 'loan', label: 'Loan', icon: '🏦' },
  { value: 'mortgage', label: 'Mortgage', icon: '🏡' },
  { value: 'other_liability', label: 'Other', icon: '📄' },
]

export const ALL_TYPES = [...ASSET_TYPES, ...LIABILITY_TYPES]

export function typeLabel(type) {
  return ALL_TYPES.find((t) => t.value === type)?.label ?? type
}

export function typeIcon(type) {
  return ALL_TYPES.find((t) => t.value === type)?.icon ?? '❓'
}

export function isLiabilityType(type) {
  return LIABILITY_TYPES.some((t) => t.value === type)
}

export async function listAccounts() {
  const { data, error } = await supabase
    .from('accounts')
    .select('*')
    .order('created_at', { ascending: true })
  if (error) throw error
  return data
}

export async function createAccount(account) {
  const { data, error } = await supabase.from('accounts').insert(account).select().single()
  if (error) throw error
  return data
}

export async function updateAccount(id, patch) {
  const { data, error } = await supabase
    .from('accounts')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data
}

export async function deleteAccount(id) {
  const { error } = await supabase.from('accounts').delete().eq('id', id)
  if (error) throw error
}
