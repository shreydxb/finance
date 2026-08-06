import { toAED } from './settings'

export function totalAED(transactions, fxRates) {
  return transactions.reduce((sum, t) => sum + toAED(Number(t.amount) || 0, t.currency, fxRates), 0)
}

export function sumByCategoryAED(transactions, fxRates) {
  const map = new Map()
  for (const t of transactions) {
    const key = t.category || 'Uncategorised'
    const aed = toAED(Number(t.amount) || 0, t.currency, fxRates)
    map.set(key, (map.get(key) || 0) + aed)
  }
  return map
}

export function sumByOwnerAED(transactions, fxRates) {
  const map = new Map()
  for (const t of transactions) {
    const aed = toAED(Number(t.amount) || 0, t.currency, fxRates)
    map.set(t.owner, (map.get(t.owner) || 0) + aed)
  }
  return map
}
