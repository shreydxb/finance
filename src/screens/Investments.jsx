import { useEffect, useState } from 'react'
import { deleteAccount, updateAccount } from '../lib/accounts'
import { useAccountsAndFx } from '../lib/useAccountsAndFx'
import { supabase } from '../lib/supabaseClient'
import { colorizeGroups } from '../lib/chartPalette'
import { usePrefs } from '../lib/PrefsContext'
import { formatMoney, toAED } from '../lib/money'
import AccountForm from '../components/AccountForm'
import BreakdownBars from '../components/BreakdownBars'
import { useRouteQueryState } from '../lib/useRouteQueryState'

const ROUTE_DEFAULTS = { ownerFilter: 'combined', groupMode: 'holding', allocationShape: 'donut' }
const ROUTE_SCHEMA = { ownerFilter: 'owner', groupMode: 'group', allocationShape: 'shape' }

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
export default function Investments({ routeQuery, onRouteQueryChange, detailId, onOpenDetail, onCloseDetail }) {
  const { accounts, fxRates, loading, error, refresh } = useAccountsAndFx()
  const { fmt } = usePrefs()

  const [routeState, setRouteState] = useRouteQueryState(ROUTE_DEFAULTS, ROUTE_SCHEMA, routeQuery, onRouteQueryChange)
  const { ownerFilter, groupMode, allocationShape } = routeState
  const setOwnerFilter = (value) => setRouteState((state) => ({ ...state, ownerFilter: value }))
  const setGroupMode = (value) => setRouteState((state) => ({ ...state, groupMode: value }))
  const setAllocationShape = (value) => setRouteState((state) => ({ ...state, allocationShape: value }))
  const [editing, setEditing] = useState(null)
  const [refreshing, setRefreshing] = useState(false)
  const [refreshResult, setRefreshResult] = useState(null)
  const [deleteError, setDeleteError] = useState('')

  const allHoldings = accounts.filter((a) => a.type === 'investment')
  const owners = Array.from(new Set(allHoldings.map((a) => a.owner))).sort()
  const holdings = ownerFilter === 'combined' ? allHoldings : allHoldings.filter((a) => a.owner === ownerFilter)
  const refreshable = allHoldings.filter(
    (a) => (a.currency === 'USD' || a.currency === 'INR') && a.ticker && a.quantity != null
  )
  // price_updated_at, not updated_at: the latter moves on any edit, so
  // renaming a holding used to look like a fresh quote (UI-01 / 028).
  const lastRefreshedAt = refreshable.reduce(
    (latest, a) => (a.price_updated_at && (!latest || a.price_updated_at > latest) ? a.price_updated_at : latest),
    null
  )

  useEffect(() => {
    if (!detailId) {
      if (editing) setEditing(null)
      return
    }
    const holding = allHoldings.find((account) => account.id === detailId)
    if (holding) setEditing(holding)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accounts, detailId])

  function openHolding(account) {
    if (onOpenDetail?.('investment', account.id)) return
    setEditing(account)
  }

  function closeHolding(options) {
    if (detailId) {
      if (onCloseDetail?.(options)) setEditing(null)
      return
    }
    setEditing(null)
  }

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
    closeHolding({ force: true })
    await refresh()
  }

  /**
   * Delete a holding.
   *
   * The form has always rendered a Delete button; it was wired to a no-op, and
   * because investment accounts are excluded from the Accounts screen there was
   * no other route to remove one (UI-01).
   *
   * Deleting is blocked by a foreign key if transactions, goals or recurring
   * entries still reference the account. Postgres reports that as 23503, which
   * on its own means nothing to a reader — so it is translated into the reason
   * and the remedy.
   */
  async function handleDelete() {
    const name = editing?.name ?? 'this holding'
    if (!confirm(`Delete ${name}? This cannot be undone.`)) return
    setDeleteError('')
    try {
      await deleteAccount(editing.id)
      closeHolding({ force: true })
      await refresh()
    } catch (error) {
      setDeleteError(
        error?.code === '23503'
          ? `${name} still has transactions or goals linked to it. Remove or reassign those first.`
          : `Could not delete ${name}. Check your connection and try again.`
      )
    }
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
      const isManual = !((a.currency === 'USD' || a.currency === 'INR') && a.ticker && a.quantity != null)
      return {
        account: a,
        valueAED,
        hasCost,
        cost,
        costAED: hasCost ? toAED(cost, a.currency, fxRates) : 0,
        gain,
        gainAED: hasCost ? toAED(gain, a.currency, fxRates) : 0,
        gainPct: hasCost && cost > 0 ? (gain / cost) * 100 : null,
        isManual,
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
                  <p className="text-xs text-ink-500">Invested</p>
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

          <div className="overflow-x-auto rounded-2xl border border-ink-200 bg-surface shadow-card">
            <div className="grid min-w-[820px] grid-cols-[1.6fr_0.8fr_1fr_1fr_1fr_1fr_1fr] gap-3 border-b border-ink-100 px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-ink-400">
              <span>Holding</span>
              <span className="text-right">Qty</span>
              <span className="text-right">Avg price</span>
              <span className="text-right">LTP</span>
              <span className="text-right">Invested</span>
              <span className="text-right">Cur. value</span>
              <span className="text-right">P&amp;L</span>
            </div>
            {rows.map((r) => (
              <button
                key={r.account.id}
                type="button"
                onClick={() => openHolding(r.account)}
                className="grid w-full min-w-[820px] grid-cols-[1.6fr_0.8fr_1fr_1fr_1fr_1fr_1fr] items-center gap-3 border-b border-ink-100 px-4 py-3 text-left text-sm last:border-b-0 transition-colors hover:bg-ink-50"
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium text-ink-900">
                    {r.account.ticker || r.account.name}
                  </span>
                  <span className="block truncate text-xs text-ink-400">
                    {r.account.owner} · {r.account.currency}
                    {r.isManual && ' · manual'}
                  </span>
                </span>
                <span className="tnum text-right text-xs text-ink-500">
                  {r.account.quantity != null
                    ? Number(r.account.quantity).toLocaleString('en-AE', { maximumFractionDigits: 4 })
                    : '—'}
                </span>
                <span className="tnum text-right text-xs text-ink-500">
                  {r.account.avg_cost != null
                    ? formatMoney(Number(r.account.avg_cost), r.account.currency, { decimals: 2 })
                    : '—'}
                </span>
                <span className="tnum text-right text-xs text-ink-500">
                  {r.account.last_price != null
                    ? formatMoney(Number(r.account.last_price), r.account.currency, { decimals: 2 })
                    : '—'}
                </span>
                <span className="tnum text-right text-xs text-ink-500">
                  {r.hasCost ? formatMoney(r.cost, r.account.currency, { decimals: 0 }) : '—'}
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
                      {/* gainPct is null when cost basis is zero — a holding
                          entered with avg_cost 0 has no percentage to show.
                          Calling .toFixed on it crashed the whole screen. */}
                      {r.gainPct != null && (
                        <span className="block text-[11px] opacity-80">
                          {r.gainPct >= 0 ? '+' : ''}
                          {r.gainPct.toFixed(1)}%
                        </span>
                      )}
                    </>
                  ) : (
                    '—'
                  )}
                </span>
              </button>
            ))}
          </div>

          <p className="mt-3 text-xs text-ink-400">
            Values are what your broker reported when last entered or refreshed — not live quotes. Holdings marked
            “manual” below have no price source wired up (metals, or anything without a ticker), so they only change
            when you edit them.
          </p>
        </>
      )}

      {editing && (
        <AccountForm account={editing} onSave={handleSave} onCancel={() => closeHolding()} onDelete={handleDelete} />
      )}

      {deleteError && (
        <p role="alert" className="mt-4 rounded-lg bg-neg-50 px-4 py-3 text-sm text-neg-600">
          {deleteError}
        </p>
      )}
    </div>
  )
}
