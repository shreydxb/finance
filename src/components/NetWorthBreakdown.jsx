import { useMemo } from 'react'
import { typeLabel } from '../lib/accounts'
import { toAED } from '../lib/settings'
import { colorizeGroups } from '../lib/chartPalette'
import BreakdownBars from './BreakdownBars'

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
  return colorizeGroups(Array.from(byKey.entries()).map(([key, value]) => ({ key, label: label(key), value })))
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
