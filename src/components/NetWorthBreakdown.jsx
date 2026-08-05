import { useMemo } from 'react'
import { typeLabel } from '../lib/accounts'
import { toAED } from '../lib/settings'

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
  const maxAbs = Math.max(1, ...groups.map((g) => Math.abs(g.value)))

  return (
    <div className="rounded-xl border border-stone-200 bg-white p-5">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-stone-900">Net worth breakdown</h2>
        <div className="flex rounded-lg border border-stone-300 p-0.5 text-xs">
          <button
            type="button"
            onClick={() => onGroupByChange('type')}
            className={`rounded-md px-2.5 py-1 font-medium ${groupBy === 'type' ? 'bg-stone-900 text-white' : 'text-stone-600 hover:bg-stone-50'}`}
          >
            By type
          </button>
          <button
            type="button"
            onClick={() => onGroupByChange('owner')}
            className={`rounded-md px-2.5 py-1 font-medium ${groupBy === 'owner' ? 'bg-stone-900 text-white' : 'text-stone-600 hover:bg-stone-50'}`}
          >
            By owner
          </button>
        </div>
      </div>

      {groups.length === 0 ? (
        <p className="py-6 text-center text-sm text-stone-500">Add accounts to see a breakdown.</p>
      ) : (
        <div className="space-y-3">
          {groups.map((g) => {
            const widthPct = (Math.abs(g.value) / maxAbs) * 100
            return (
              <div key={g.key}>
                <div className="mb-1 flex items-center justify-between text-xs">
                  <span className="flex items-center gap-1.5 font-medium text-stone-700">
                    <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: g.color }} />
                    {g.label}
                  </span>
                  <span className="font-medium text-stone-900">{formatAED(g.value)}</span>
                </div>
                <div className="h-3 w-full overflow-hidden rounded-full bg-stone-100">
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${widthPct}%`, backgroundColor: g.color }}
                  />
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
