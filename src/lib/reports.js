import { toAED } from './settings'

// A transfer between the household's own accounts (Telegram bot round2 §3)
// is logged as two real `transactions` rows — visible in the Transactions
// list for audit — but it isn't a spend, so every total below excludes it.
// The category name alone is enough to key off: it's the only category ever
// in the Transfer group, by construction (020_transfers.sql).
const TRANSFER_CATEGORY = 'Transfer'

export function totalAED(transactions, fxRates) {
  return transactions.reduce(
    (sum, t) => (t.category === TRANSFER_CATEGORY ? sum : sum + toAED(Number(t.amount) || 0, t.currency, fxRates)),
    0
  )
}

export function sumByCategoryAED(transactions, fxRates) {
  const map = new Map()
  for (const t of transactions) {
    if (t.category === TRANSFER_CATEGORY) continue
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

/** Groups by categories.group (Needs/Wants/Savings). categoryGroupByName maps category name -> group. */
export function sumByGroupAED(transactions, fxRates, categoryGroupByName) {
  const map = new Map()
  for (const t of transactions) {
    if (t.category === TRANSFER_CATEGORY) continue
    const key = categoryGroupByName.get(t.category) || 'Uncategorised'
    const aed = toAED(Number(t.amount) || 0, t.currency, fxRates)
    map.set(key, (map.get(key) || 0) + aed)
  }
  return map
}

/** Best-effort merchant grouping — there's no dedicated merchant column, so this keys off note. */
export function sumByMerchantAED(transactions, fxRates) {
  const map = new Map()
  for (const t of transactions) {
    const key = t.note?.trim() || 'No note'
    const aed = toAED(Number(t.amount) || 0, t.currency, fxRates)
    map.set(key, (map.get(key) || 0) + aed)
  }
  return map
}

/** Total/largest/average transaction size and first/last date for the given set. */
export function transactionStats(transactions) {
  if (transactions.length === 0) {
    return { count: 0, largest: 0, average: 0, first: null, last: null }
  }
  const amounts = transactions.map((t) => Math.abs(Number(t.amount) || 0))
  const dates = transactions.map((t) => t.date).sort()
  return {
    count: transactions.length,
    largest: Math.max(...amounts),
    average: amounts.reduce((s, a) => s + a, 0) / amounts.length,
    first: dates[0],
    last: dates[dates.length - 1],
  }
}

/** Monthly totals over the last `months` months ending at `to` (a Date). `transactions` should span that whole range. */
export function monthlyTrend(transactions, fxRates, months, to = new Date()) {
  const buckets = []
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(to.getFullYear(), to.getMonth() - i, 1)
    buckets.push({ year: d.getFullYear(), month: d.getMonth() + 1, key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` })
  }
  const byBucket = new Map(buckets.map((b) => [b.key, 0]))
  for (const t of transactions) {
    const key = t.date.slice(0, 7)
    if (byBucket.has(key)) {
      byBucket.set(key, byBucket.get(key) + toAED(Number(t.amount) || 0, t.currency, fxRates))
    }
  }
  return buckets.map((b) => ({ key: b.key, label: `${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][b.month - 1]}`, value: byBucket.get(b.key) }))
}

/** Client-side CSV export of a transaction list. Returns the CSV string. */
export function transactionsToCSV(transactions) {
  const headers = ['date', 'amount', 'currency', 'category', 'owner', 'note', 'tags', 'account_id']
  const rows = transactions.map((t) =>
    headers
      .map((h) => {
        const v = h === 'tags' ? (t.tags || []).join('|') : (t[h] ?? '')
        const s = String(v).replace(/"/g, '""')
        return /[",\n]/.test(s) ? `"${s}"` : s
      })
      .join(',')
  )
  return [headers.join(','), ...rows].join('\n')
}
