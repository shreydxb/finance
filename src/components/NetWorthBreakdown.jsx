import { useMemo } from 'react'
import { typeLabel } from '../lib/accounts'
import { toAED } from '../lib/settings'
import BreakdownBars from './BreakdownBars'

// Fixed categorical order — never cycled. 8 slots; a 9th distinct key folds into "Other".
const PALETTE = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948']
const OTHER_COLOR = '#898781'

function formatAED(n) {
  const sign = n < 0 ? '-' : ''
  const abs = Math.abs(n)
  return `${sign}AED ${abs.toLocaleString('en-AE', { maximumFractionDigits: 0 })}`
}

function buildGroups(accounts, fxRates, groupBy) {
  const byKey = new Map()
  for (const acct of accounts) {
    const aed = toAED(Number(acct.value) || 0, acct.currency, fxRates)
    const signed = acct.is_liability ? -aed : aed
    const key = groupBy === 'owner' ? acct.owner : acct.type
    byKey.set(key, (byKey.get(key) || 0) + signed)
  }
  const label = (key) => (groupBy === 'owner' ? key : typeLabel(key))
  let entries = Array.from(byKey.entries())
    .filter(([, value]) => value !== 0)
    .map(([key, value]) => ({ key, label: label(key), value }))
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))

  if (entries.length > PALETTE.length) {
    const head = entries.slice(0, PALETTE.length - 1)
    const rest = entries.slice(PALETTE.length - 1)
    const otherValue = rest.reduce((sum, e) => sum + e.value, 0)
    entries = [...head, { key: '__other', label: 'Other', value: otherValue }]
  }

  return entries.map((e, i) => ({ ...e, color: i === entries.length - 1 && entries.length > PALETTE.length ? OTHER_COLOR : PALETTE[i] }))
}

export default function NetWorthBreakdown({ accounts, fxRates, groupBy, onGroupByChange }) {
  const groups = useMemo(() => buildGroups(accounts, fxRates, groupBy), [accounts, fxRates, groupBy])

  return (
    <BreakdownBars
      title="Net worth breakdown"
      groups={groups}
      tabs={[
        { key: 'type', label: 'By type' },
        { key: 'owner', label: 'By owner' },
      ]}
      activeTab={groupBy}
      onTabChange={onGroupByChange}
      formatValue={formatAED}
      emptyMessage="Add accounts to see a breakdown."
    />
  )
}
