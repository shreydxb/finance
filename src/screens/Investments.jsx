import { useState } from 'react'
import { updateAccount } from '../lib/accounts'
import { toAED } from '../lib/settings'
import { useAccountsAndFx } from '../lib/useAccountsAndFx'
import { supabase } from '../lib/supabaseClient'
import { colorizeGroups } from '../lib/chartPalette'
import { usePrefs } from '../lib/PrefsContext'
import { formatMoney } from '../lib/money'
import AccountForm from '../components/AccountForm'
import BreakdownBars from '../components/BreakdownBars'

function formatRelativeTime(isoString) {
  const diffMs = Date.now() - new Date(isoString).getTime()
  const minutes = Math.round(diffMs / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} hr${hours === 1 ? '' : 's'} ago`
  const days = Math.round(hours / 24)
  return `${days} day${days === 1 ? '' : 's'} ago`
}

/**
 * Investments — its own tab, deliberately separate from Accounts.
 *
 * Nothing here is transactable: a holding's value moves because the market
 * moved or because you re-entered it from the broker, never because a
 * transaction was logged against it. Keeping it out of Accounts/Transactions
 * is what stops 41 stock rows drowning the 4 accounts you actually spend from.
 */
export default function Investments() {
  const { accounts, fxRates, loading, error, refresh } = useAccountsAndFx()
  const { fmt } = usePrefs()

  const [ownerFilter, setOwnerFilter] = useState('combined')
  const [groupMode, setGroupMode] = useState('holding') // holding | owner | currency
  const [allocationShape, setAllocationShape] = useState('donut')
  const [editing, setEditing] = useState(null)
  const [refreshing, setRefreshing] = useState(false)
  const [refreshResult, setRefreshResult] = useState(null)

  const allHoldings = accounts.filter((a) => a.type === 'investment')
  const owners = Array.from(new Set(allHoldings.map((a) => a.owner))).sort()
  const holdings = ownerFilter === 'combined' ? allHoldings : allHoldings.filter((a) => a.owner === ownerFilter)
  const refreshable = allHoldings.filter((a) => a.currency === 'USD' && a.ticker && a.quantity != null)
  const lastRefreshedAt = refreshable.reduce(
    (latest, a) => (a.updated_at && (!latest || a.updated_at > latest) ? a.updated_at : latest),
    null
  )

  async function handleRefreshPrices() {
    setRefreshing(true)
    setRefreshResult(null)
    try {
      const { data, error: fnError } = await supabase.functions.invoke('refresh-prices', { method: 'POST' })
      if (fnError) throw fnError
      setRefreshResult(data)
      await refresh()
    } catch {
      setRefreshResult({ error: 'Could not refresh prices. Try again.' })
    } finally {
      setRefreshing(false)
    }
  }

  async function handleSave(values) {
    await updateAccount(editing.id, values)
    setEditing(null)
    await refresh()
  }

  if (loading) {
    return <div className="px-6 py-10 text-center text-sm text-ink-500">Loading investments…</div>
  }

  const rows = holdings
    .map((a) => {
      const valueAED = toAED(Number(a.value) || 0, a.currency, fxRates)
      const hasCost = a.quantity != null && a.avg_cost != null
      const cost = hasCost ? Number(a.quantity) * Number(a.avg_cost) : null
      const gain = hasCost ? Number(a.value) - cost : null
      return {
        account: a,
        valueAED,
        hasCost,
        gain,
        gainAED: hasCost ? toAED(gain, a.currency, fxRates) : 0,
        gainPct: hasCost && cost > 0 ? (gain / cost) * 100 : null,
      }
    })
    .sort((a, b) => b.valueAED - a.valueAED)

  const totalValue = rows.reduce((s, r) => s + r.valueAED, 0)
  const totalGain = rows.reduce((s, r) => s + r.gainAED, 0)
  const totalCost = totalValue - totalGain
  const totalGainPct = totalCost > 0 ? (totalGain / totalCost) * 100 : null

  const allocation = colorizeGroups(
    groupMode === 'owner'
      ? Array.from(
          rows.reduce((m, r) => m.set(r.account.owner, (m.get(r.account.owner) || 0) + r.valueAED), new Map()),
          ([k, v]) => ({ key: k, label: k, value: v })
        )
      : groupMode === 'currency'
        ? Array.from(
            rows.reduce((m, r) => m.set(r.account.currency, (m.get(r.account.currency) || 0) + r.valueAED), new Map()),
            ([k, v]) => ({ key: k, label: k === 'INR' ? 'India (INR)' : k === 'USD' ? 'US (USD)' : k, value: v })
          )
        : rows.map((r) => ({ key: r.account.id, label: r.account.ticker || r.account.name, value: r.valueAED }))
  )

  return (
    <div className="stagger mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold tracking-tight text-ink-900">Investments</h2>
          <p className="text-sm text-ink-500">
            {allHoldings.length} holdings · manual entry, prices refreshed on demand
          </p>
        </div>
        {refreshable.length > 0 && (
          <div className="flex flex-col items-end gap-1">
            <button
              type="button"
              onClick={handleRefreshPrices}
              disabled={refreshing}
              className="rounded-lg border border-ink-300 px-3 py-1.5 text-sm font-medium text-ink-600 transition-colors hover:bg-ink-100 disabled:opacity-50"
            >
              {refreshing ? 'Refreshing…' : `↻ Refresh ${refreshable.length} prices`}
            </button>
            {lastRefreshedAt && (
              <span className="text-xs text-ink-400">Last updated {formatRelativeTime(lastRefreshedAt)}</span>
            )}
          </div>
        )}
      </div>

      {error && (
        <p role="alert" className="mb-4 rounded-lg bg-neg-50 px-4 py-3 text-sm text-neg-600">
          {error}
        </p>
      )}

      {refreshResult && (
        <p
          className={`mb-4 rounded-lg px-4 py-2 text-sm ${
            refreshResult.error || refreshResult.failed?.length
              ? 'bg-amber-50 text-amber-700'
              : 'bg-pos-50 text-pos-600'
          }`}
        >
          {refreshResult.error
            ? refreshResult.error
            : `Updated ${refreshResult.updated.length} holding${refreshResult.updated.length === 1 ? '' : 's'}${
                refreshResult.failed.length
                  ? `; ${refreshResult.failed.length} could not be priced (${refreshResult.failed
                      .map((f) => f.ticker)
                      .join(', ')})`
                  : ''
              }.`}
        </p>
      )}

      {allHoldings.length === 0 ? (
        <p className="py-10 text-center text-sm text-ink-500">
          No investment accounts yet. Add one from Accounts with type “Investments”.
        </p>
      ) : (
        <>
          <div className="mb-5 grid gap-4 lg:grid-cols-[1.4fr_1fr]">
            <div className="rounded-2xl border border-ink-200 bg-surface p-5 shadow-card">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-medium uppercase tracking-wide text-ink-400">Portfolio value</p>
                <div className="flex rounded-lg bg-ink-100 p-0.5 text-xs">
                  {['combined', ...owners].map((o) => (
                    <button
                      key={o}
                      type="button"
                      onClick={() => setOwnerFilter(o)}
                      className={`rounded-md px-2.5 py-1 font-medium capitalize transition-colors ${
                        ownerFilter === o ? 'bg-surface text-ink-900 shadow-card' : 'text-ink-500 hover:text-ink-900'
                      }`}
                    >
                      {o}
                    </button>
                  ))}
                </div>
              </div>

              <p className="tnum text-3xl font-semibold tracking-tight text-ink-900">{fmt(totalValue)}</p>
              <p className={`tnum mt-1 text-sm font-medium ${totalGain < 0 ? 'text-neg-600' : 'text-pos-600'}`}>
                {totalGain >= 0 ? '▲' : '▼'} {fmt(Math.abs(totalGain))}
                {totalGainPct !== null && ` · ${totalGainPct >= 0 ? '+' : ''}${totalGainPct.toFixed(2)}%`}
                <span className="ml-1 font-normal text-ink-400">all time</span>
              </p>

              <div className="mt-4 grid grid-cols-2 gap-3 border-t border-ink-100 pt-4">
                <div>
                  <p className="text-xs text-ink-500">Cost basis</p>
                  <p className="tnum mt-0.5 font-semibold text-ink-900">{fmt(totalCost)}</p>
                </div>
                <div>
                  <p className="text-xs text-ink-500">Holdings</p>
                  <p className="tnum mt-0.5 font-semibold text-ink-900">{rows.length}</p>
                </div>
              </div>
            </div>

            <BreakdownBars
              title="Allocation"
              groups={allocation}
              formatValue={fmt}
              shape={allocationShape}
              onShapeChange={setAllocationShape}
              tabs={[
                { key: 'holding', label: 'Holding' },
                { key: 'owner', label: 'Owner' },
                { key: 'currency', label: 'Market' },
              ]}
              activeTab={groupMode}
              onTabChange={setGroupMode}
            />
          </div>

          <div className="rounded-2xl border border-ink-200 bg-surface shadow-card">
            <div className="grid grid-cols-[1fr_auto_auto] gap-3 border-b border-ink-100 px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-ink-400 sm:grid-cols-[1.6fr_1fr_1fr_1fr]">
              <span>Holding</span>
              <span className="hidden text-right sm:block">Qty × Avg</span>
              <span className="text-right">Value</span>
              <span className="text-right">Gain / Loss</span>
            </div>
            {rows.map((r) => (
              <button
                key={r.account.id}
                type="button"
                onClick={() => setEditing(r.account)}
                className="grid w-full grid-cols-[1fr_auto_auto] items-center gap-3 border-b border-ink-100 px-4 py-3 text-left text-sm last:border-b-0 transition-colors hover:bg-ink-50 sm:grid-cols-[1.6fr_1fr_1fr_1fr]"
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium text-ink-900">
                    {r.account.ticker || r.account.name}
                  </span>
                  <span className="block truncate text-xs text-ink-400">
                    {r.account.owner} · {r.account.currency}
                  </span>
                </span>
                <span className="tnum hidden text-right text-xs text-ink-500 sm:block">
                  {r.account.quantity != null
                    ? `${Number(r.account.quantity).toLocaleString('en-AE', { maximumFractionDigits: 4 })} × ${
                        r.account.avg_cost ?? '—'
                      }`
                    : '—'}
                </span>
                <span className="text-right">
                  <span className="tnum block font-medium text-ink-900">{fmt(r.valueAED)}</span>
                  {r.account.currency !== 'AED' && (
                    <span className="tnum block text-[11px] text-ink-400">
                      {formatMoney(Number(r.account.value), r.account.currency, { decimals: 0 })}
                    </span>
                  )}
                </span>
                <span
                  className={`tnum text-right text-xs font-medium ${
                    !r.hasCost ? 'text-ink-400' : r.gain < 0 ? 'text-neg-600' : 'text-pos-600'
                  }`}
                >
                  {r.hasCost ? (
                    <>
                      {r.gain >= 0 ? '+' : '−'}
                      {formatMoney(Math.abs(r.gain), r.account.currency, { decimals: 0 })}
                      <span className="block text-[11px] opacity-80">
                        {r.gainPct >= 0 ? '+' : ''}
                        {r.gainPct.toFixed(1)}%
                      </span>
                    </>
                  ) : (
                    '—'
                  )}
                </span>
              </button>
            ))}
          </div>

          <p className="mt-3 text-xs text-ink-400">
            Values are what your broker reported when last entered or refreshed — not live quotes. Metals and India
            equities have no price source wired up, so they only change when you edit them.
          </p>
        </>
      )}

      {editing && (
        <AccountForm account={editing} onSave={handleSave} onCancel={() => setEditing(null)} onDelete={() => {}} />
      )}
    </div>
  )
}
