import { useEffect, useState } from 'react'
import {
  createAccount,
  updateAccount,
  deleteAccount,
  ASSET_TYPES,
  LIABILITY_TYPES,
  typeLabel,
  typeIcon,
} from '../lib/accounts'
import { toAED } from '../lib/settings'
import { useAccountsAndFx } from '../lib/useAccountsAndFx'
import { listTransactions, createTransaction, updateTransaction } from '../lib/transactions'
import { listCategories } from '../lib/categories'
import { supabase } from '../lib/supabaseClient'
import { colorizeGroups } from '../lib/chartPalette'
import AccountForm from '../components/AccountForm'
import TransactionForm from '../components/TransactionForm'
import TransactionList from '../components/TransactionList'
import NetWorthHero from '../components/NetWorthHero'
import NetWorthBreakdown from '../components/NetWorthBreakdown'
import BreakdownBars from '../components/BreakdownBars'


function formatAED(n) {
  const sign = n < 0 ? '-' : ''
  const abs = Math.abs(n)
  return `${sign}AED ${abs.toLocaleString('en-AE', { maximumFractionDigits: 0 })}`
}

function formatValue(value, currency) {
  return `${currency} ${Number(value).toLocaleString('en-AE', { maximumFractionDigits: 2 })}`
}

export default function Accounts() {
  const { accounts, fxRates, loading, error, refresh } = useAccountsAndFx()
  const [editing, setEditing] = useState(null) // account being edited, or 'new'
  const [groupBy, setGroupBy] = useState('type')
  const [viewingAccount, setViewingAccount] = useState(null) // account whose detail view is open
  const [screenView, setScreenView] = useState('networth') // networth | investments

  const assetGroups = groupByType(accounts.filter((a) => !a.is_liability), ASSET_TYPES, fxRates)
  const liabilityGroups = groupByType(accounts.filter((a) => a.is_liability), LIABILITY_TYPES, fxRates)

  async function handleSave(values) {
    if (editing && editing !== 'new') {
      await updateAccount(editing.id, values)
    } else {
      await createAccount(values)
    }
    setEditing(null)
    await refresh()
  }

  async function handleDelete(id) {
    await deleteAccount(id)
    setEditing(null)
    setViewingAccount(null)
    await refresh()
  }

  if (loading) {
    return <div className="px-6 py-10 text-center text-sm text-ink-500">Loading accounts…</div>
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
      <div className="mb-6">
        <NetWorthHero accounts={accounts} fxRates={fxRates} />
      </div>

      {error && (
        <p role="alert" className="mb-4 rounded-lg bg-neg-50 px-4 py-3 text-sm text-neg-600">
          {error}
        </p>
      )}

      <div className="mb-4 flex items-center justify-between">
        <div className="flex rounded-lg bg-ink-100 p-0.5 text-xs">
          <button
            type="button"
            onClick={() => setScreenView('networth')}
            className={`rounded-md px-3 py-1.5 font-medium transition-colors ${screenView === 'networth' ? 'bg-white text-ink-900 shadow-card' : 'text-ink-500 hover:text-ink-900'}`}
          >
            Net Worth
          </button>
          <button
            type="button"
            onClick={() => setScreenView('investments')}
            className={`rounded-md px-3 py-1.5 font-medium transition-colors ${screenView === 'investments' ? 'bg-white text-ink-900 shadow-card' : 'text-ink-500 hover:text-ink-900'}`}
          >
            Investments
          </button>
        </div>
        <button
          type="button"
          onClick={() => setEditing('new')}
          className="rounded-lg bg-ink-900 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-ink-800"
        >
          + Add account
        </button>
      </div>

      {screenView === 'investments' ? (
        <InvestmentsView accounts={accounts} fxRates={fxRates} onSelect={setViewingAccount} onRefreshed={refresh} />
      ) : (
        <>
          <div className="mb-6">
            <NetWorthBreakdown accounts={accounts} fxRates={fxRates} groupBy={groupBy} onGroupByChange={setGroupBy} />
          </div>

          <h2 className="mb-4 text-lg font-semibold text-ink-900">Accounts</h2>

          <AccountGroupList title="Assets" groups={assetGroups} onSelect={setViewingAccount} />
          <AccountGroupList title="Liabilities" groups={liabilityGroups} onSelect={setViewingAccount} />

          {accounts.length === 0 && (
            <p className="py-10 text-center text-sm text-ink-500">
              No accounts yet. Add your first one — manual entry only, no bank connection needed.
            </p>
          )}
        </>
      )}

      {viewingAccount && !editing && (
        <AccountDetail
          account={viewingAccount}
          onClose={() => setViewingAccount(null)}
          onEdit={() => setEditing(viewingAccount)}
        />
      )}

      {editing && (
        <AccountForm
          account={editing === 'new' ? null : editing}
          onSave={handleSave}
          onCancel={() => setEditing(null)}
          onDelete={handleDelete}
        />
      )}
    </div>
  )
}

function InvestmentsView({ accounts, fxRates, onSelect, onRefreshed }) {
  const allHoldings = accounts.filter((a) => a.type === 'investment')
  const owners = Array.from(new Set(allHoldings.map((a) => a.owner))).sort()
  const [ownerFilter, setOwnerFilter] = useState('combined')
  // Allocation is a part-of-whole read, so it defaults to the donut.
  const [allocationShape, setAllocationShape] = useState('donut')
  const [refreshing, setRefreshing] = useState(false)
  const [refreshResult, setRefreshResult] = useState(null) // { updated, failed } | { error }

  const refreshablePresent = allHoldings.some((a) => a.currency === 'USD' && a.ticker && a.quantity != null)

  async function handleRefreshPrices() {
    setRefreshing(true)
    setRefreshResult(null)
    try {
      const { data, error } = await supabase.functions.invoke('refresh-prices', { method: 'POST' })
      if (error) throw error
      setRefreshResult(data)
      await onRefreshed()
    } catch {
      setRefreshResult({ error: 'Could not refresh prices. Try again.' })
    } finally {
      setRefreshing(false)
    }
  }

  if (allHoldings.length === 0) {
    return (
      <p className="py-10 text-center text-sm text-ink-500">
        No investment accounts yet. Add one (type: Investments) to see portfolio breakdown here.
      </p>
    )
  }

  const holdings = ownerFilter === 'combined' ? allHoldings : allHoldings.filter((a) => a.owner === ownerFilter)

  const rows = holdings.map((a) => {
    const valueAED = toAED(Number(a.value) || 0, a.currency, fxRates)
    const hasCostBasis = a.quantity != null && a.avg_cost != null
    const costBasis = hasCostBasis ? Number(a.quantity) * Number(a.avg_cost) : null
    const gainLoss = hasCostBasis ? Number(a.value) - costBasis : null
    const gainLossPct = hasCostBasis && costBasis > 0 ? (gainLoss / costBasis) * 100 : null
    return { account: a, valueAED, hasCostBasis, gainLoss, gainLossPct }
  })

  const totalValueAED = rows.reduce((sum, r) => sum + r.valueAED, 0)
  const totalGainLossAED = rows
    .filter((r) => r.hasCostBasis)
    .reduce((sum, r) => sum + toAED(r.gainLoss, r.account.currency, fxRates), 0)
  const anyCostBasis = rows.some((r) => r.hasCostBasis)

  // Ticker alone is the useful label on an allocation chart — the sector
  // suffix carried in the account name would blow out the legend width.
  const allocationGroups = colorizeGroups(
    rows.map((r) => ({
      key: r.account.id,
      label: r.account.ticker || r.account.name,
      value: r.valueAED,
    }))
  )

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-2">
        <div className="flex rounded-lg bg-ink-100 p-0.5 text-xs w-fit">
          <button
            type="button"
            onClick={() => setOwnerFilter('combined')}
            className={`rounded-md px-2.5 py-1 font-medium transition-colors ${ownerFilter === 'combined' ? 'bg-white text-ink-900 shadow-card' : 'text-ink-500 hover:text-ink-900'}`}
          >
            Combined
          </button>
          {owners.map((o) => (
            <button
              key={o}
              type="button"
              onClick={() => setOwnerFilter(o)}
              className={`rounded-md px-2.5 py-1 font-medium transition-colors ${ownerFilter === o ? 'bg-white text-ink-900 shadow-card' : 'text-ink-500 hover:text-ink-900'}`}
            >
              {o}
            </button>
          ))}
        </div>

        {refreshablePresent && (
          <button
            type="button"
            onClick={handleRefreshPrices}
            disabled={refreshing}
            className="shrink-0 rounded-lg border border-ink-300 px-2.5 py-1.5 text-xs font-medium text-ink-600 hover:bg-ink-50 disabled:opacity-50"
          >
            {refreshing ? 'Refreshing…' : '🔄 Refresh prices'}
          </button>
        )}
      </div>

      {refreshResult && (
        <p className={`mb-4 rounded-lg px-4 py-2 text-xs ${refreshResult.error || refreshResult.failed?.length ? 'bg-amber-50 text-amber-700' : 'bg-pos-50 text-pos-600'}`}>
          {refreshResult.error
            ? refreshResult.error
            : `Updated ${refreshResult.updated.length} holding${refreshResult.updated.length === 1 ? '' : 's'}${
                refreshResult.failed.length ? `; ${refreshResult.failed.length} failed (${refreshResult.failed.map((f) => f.ticker).join(', ')})` : ''
              }.`}
        </p>
      )}

      <div className="mb-6 grid grid-cols-2 gap-3">
        <div className="rounded-2xl border border-ink-200 bg-white shadow-card p-4">
          <p className="text-xs text-ink-500">Total invested</p>
          <p className="mt-1 text-lg font-semibold text-ink-900">{formatAED(totalValueAED)}</p>
        </div>
        <div className="rounded-2xl border border-ink-200 bg-white shadow-card p-4">
          <p className="text-xs text-ink-500">Unrealized gain/loss</p>
          <p className={`mt-1 text-lg font-semibold ${totalGainLossAED < 0 ? 'text-neg-600' : 'text-ink-900'}`}>
            {anyCostBasis ? formatAED(totalGainLossAED) : '—'}
          </p>
        </div>
      </div>

      {holdings.length === 0 ? (
        <p className="py-10 text-center text-sm text-ink-500">No investment accounts for {ownerFilter} yet.</p>
      ) : (
        <>
          <div className="mb-6">
            <BreakdownBars
              title="Allocation by holding"
              groups={allocationGroups}
              formatValue={formatAED}
              shape={allocationShape}
              onShapeChange={setAllocationShape}
            />
          </div>

          <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink-500">Holdings</h3>
          <div className="rounded-2xl border border-ink-200 bg-white shadow-card">
            {rows.map((r) => (
              <button
                key={r.account.id}
                type="button"
                onClick={() => onSelect(r.account)}
                className="flex w-full items-center justify-between border-b border-ink-100 px-4 py-3 text-left text-sm last:border-b-0 hover:bg-ink-50"
              >
                <span className="min-w-0">
                  <span className="font-medium text-ink-900">{r.account.name}</span>
                  <span className="ml-2 text-ink-400">{r.account.owner}</span>
                  <span className="block truncate text-xs text-ink-400">
                    {r.account.ticker ? `${r.account.ticker} · ` : ''}
                    {r.account.quantity != null ? `${r.account.quantity} @ ${r.account.avg_cost ?? '—'} avg` : 'no ticker/qty tracked'}
                  </span>
                </span>
                <span className="shrink-0 pl-2 text-right">
                  <span className="block font-medium text-ink-700">{formatValue(r.account.value, r.account.currency)}</span>
                  {r.hasCostBasis && (
                    <span className={`block text-xs ${r.gainLoss < 0 ? 'text-neg-600' : 'text-pos-600'}`}>
                      {r.gainLoss >= 0 ? '+' : ''}
                      {r.gainLoss.toFixed(0)} {r.account.currency} ({r.gainLossPct.toFixed(1)}%)
                    </span>
                  )}
                </span>
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs text-ink-400">
            Gain/loss needs Qty and Avg cost filled in per account (Edit account) — accounts without them show value only.
          </p>
        </>
      )}
    </div>
  )
}

function AccountDetail({ account, onClose, onEdit }) {
  const [transactions, setTransactions] = useState([])
  const [categories, setCategories] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [addingTxn, setAddingTxn] = useState(false)

  async function refresh() {
    setError('')
    try {
      const [txns, cats] = await Promise.all([
        listTransactions({ accountId: account.id }),
        listCategories(),
      ])
      setTransactions(txns)
      setCategories(cats)
    } catch {
      setError('Could not load this account’s transactions. Check your connection and try again.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account.id])

  async function handleCategoryChange(id, category) {
    await updateTransaction(id, { category: category || null })
    await refresh()
  }

  async function handleAddTxn(result) {
    if (result.split) return // splits aren't offered from this pre-filled form
    await createTransaction(result.fields)
    setAddingTxn(false)
    await refresh()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white p-6 shadow-xl sm:rounded-2xl">
        <div className="mb-1 flex items-start justify-between">
          <div>
            <h2 className="text-lg font-semibold text-ink-900">
              {typeIcon(account.type)} {account.name}
            </h2>
            <p className="text-xs text-ink-400">
              {typeLabel(account.type)} · {account.owner}
            </p>
          </div>
          <button type="button" onClick={onClose} className="text-sm text-ink-400 hover:text-ink-600">
            Close
          </button>
        </div>

        <p className="my-3 text-2xl font-semibold text-ink-900">{formatValue(account.value, account.currency)}</p>

        <div className="mb-5 flex gap-2">
          <button
            type="button"
            onClick={onEdit}
            className="flex-1 rounded-lg border border-ink-300 px-3 py-2 text-sm font-medium text-ink-700 hover:bg-ink-50"
          >
            Edit account
          </button>
          <button
            type="button"
            onClick={() => setAddingTxn(true)}
            className="flex-1 rounded-lg bg-ink-900 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-ink-800"
          >
            + Add transaction
          </button>
        </div>

        <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink-500">Transactions</h3>

        {error && (
          <p role="alert" className="mb-4 rounded-lg bg-neg-50 px-4 py-3 text-sm text-neg-600">
            {error}
          </p>
        )}

        {loading ? (
          <p className="py-6 text-center text-sm text-ink-500">Loading…</p>
        ) : (
          <TransactionList
            transactions={transactions}
            accountName={() => account.name}
            flat
            onEntryClick={() => {}}
            categories={categories}
            onCategoryChange={handleCategoryChange}
            emptyMessage="No transactions logged against this account yet."
          />
        )}

        {addingTxn && (
          <TransactionForm
            prefill={{ account_id: account.id, currency: account.currency, owner: account.owner }}
            accounts={[account]}
            categories={categories}
            onSave={handleAddTxn}
            onCancel={() => setAddingTxn(false)}
          />
        )}
      </div>
    </div>
  )
}

function groupByType(accounts, typeDefs, fxRates) {
  return typeDefs
    .map((t) => {
      const items = accounts.filter((a) => a.type === t.value)
      const subtotalAED = items.reduce((sum, a) => sum + toAED(Number(a.value) || 0, a.currency, fxRates), 0)
      return { type: t.value, items, subtotalAED }
    })
    .filter((g) => g.items.length > 0)
}

function AccountGroupList({ title, groups, onSelect }) {
  if (groups.length === 0) return null
  return (
    <div className="mb-6">
      <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink-500">{title}</h3>
      <div className="space-y-4">
        {groups.map((g) => (
          <div key={g.type} className="rounded-2xl border border-ink-200 bg-white shadow-card">
            <div className="flex items-center justify-between border-b border-ink-100 px-4 py-2.5">
              <span className="text-sm font-medium text-ink-700">
                {typeIcon(g.type)} {typeLabel(g.type)}
              </span>
              <span className="text-sm font-semibold text-ink-900">{formatAED(g.subtotalAED)}</span>
            </div>
            <ul>
              {g.items.map((a) => (
                <li key={a.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(a)}
                    className="flex w-full items-center justify-between px-4 py-3 text-left text-sm hover:bg-ink-50"
                  >
                    <span>
                      <span className="font-medium text-ink-900">{a.name}</span>
                      <span className="ml-2 text-ink-400">{a.owner}</span>
                    </span>
                    <span className="text-ink-700">{formatValue(a.value, a.currency)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  )
}
