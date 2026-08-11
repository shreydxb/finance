import { useEffect, useMemo, useState } from 'react'
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
import { listDailyNetWorth, recordDailyNetWorth } from '../lib/snapshots'
import { colorizeGroups } from '../lib/chartPalette'
import { usePrefs } from '../lib/PrefsContext'
import { formatMoney } from '../lib/money'
import AccountForm from '../components/AccountForm'
import TransactionForm from '../components/TransactionForm'
import TransactionList from '../components/TransactionList'
import LineChart from '../components/LineChart'
import AnimatedNumber from '../components/AnimatedNumber'

/** Investments live on their own tab; this screen is about what you spend from and owe. */
const INVESTMENTS_EXCLUDED = (a) => a.type !== 'investment'

function shortDay(dayStr) {
  return new Date(`${dayStr}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

function scrollToGroup(type) {
  const el = document.getElementById(`account-group-${type}`)
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

export default function Accounts({ onNavigate }) {
  const { accounts, fxRates, loading, error, refresh } = useAccountsAndFx()
  const { fmt } = usePrefs()
  const [editing, setEditing] = useState(null)
  const [viewingAccount, setViewingAccount] = useState(null)
  const [history, setHistory] = useState([])
  const [groupBy, setGroupBy] = useState('type')

  // Net worth still counts investments — they're part of what the household is
  // worth, they just aren't listed on this screen.
  const totals = useMemo(() => {
    let assets = 0
    let liabilities = 0
    let investments = 0
    for (const a of accounts) {
      const aed = toAED(Number(a.value) || 0, a.currency, fxRates)
      if (a.is_liability) liabilities += aed
      else {
        assets += aed
        if (a.type === 'investment') investments += aed
      }
    }
    return { assets, liabilities, investments, netWorth: assets - liabilities }
  }, [accounts, fxRates])

  // Record today's net worth, then read history back. Upsert-by-day means
  // reopening the app doesn't create duplicate points.
  useEffect(() => {
    if (loading || accounts.length === 0) return
    let cancelled = false
    recordDailyNetWorth(accounts, fxRates)
      .catch(() => null)
      .then(() => listDailyNetWorth(90))
      .then((rows) => !cancelled && setHistory(rows))
      .catch(() => !cancelled && setHistory([]))
    return () => {
      cancelled = true
    }
  }, [loading, accounts, fxRates])

  const listed = accounts.filter(INVESTMENTS_EXCLUDED)
  const assetGroups = groupByType(listed.filter((a) => !a.is_liability), ASSET_TYPES, fxRates)
  const liabilityGroups = groupByType(listed.filter((a) => a.is_liability), LIABILITY_TYPES, fxRates)

  const compositionGroups = useMemo(() => {
    const byKey = new Map()
    for (const a of accounts) {
      if (a.is_liability) continue
      const key = groupBy === 'owner' ? a.owner : a.type
      byKey.set(key, (byKey.get(key) || 0) + toAED(Number(a.value) || 0, a.currency, fxRates))
    }
    return colorizeGroups(
      Array.from(byKey, ([key, value]) => ({
        key,
        label: groupBy === 'owner' ? key : typeLabel(key),
        value,
      }))
    )
  }, [accounts, fxRates, groupBy])

  const chartPoints = history.map((h) => ({ label: shortDay(h.day), value: Number(h.total_aed) }))
  const firstValue = chartPoints[0]?.value
  const change = chartPoints.length > 1 ? totals.netWorth - firstValue : null
  const changePct = change !== null && firstValue ? (change / Math.abs(firstValue)) * 100 : null

  async function handleSave(values) {
    if (editing && editing !== 'new') await updateAccount(editing.id, values)
    else await createAccount(values)
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
    <div className="stagger mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-semibold tracking-tight text-ink-900">Accounts</h2>
        <button
          type="button"
          onClick={() => setEditing('new')}
          className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-700"
        >
          + Add account
        </button>
      </div>

      {error && (
        <p role="alert" className="mb-4 rounded-lg bg-neg-50 px-4 py-3 text-sm text-neg-600">
          {error}
        </p>
      )}

      <div className="grid gap-5 lg:grid-cols-[1.6fr_1fr]">
        <div className="rounded-2xl border border-ink-200 bg-surface p-5 shadow-card">
          <div className="mb-3 flex items-baseline justify-between">
            <p className="text-xs font-medium uppercase tracking-wide text-ink-400">Net worth</p>
            {change !== null && (
              <span className={`tnum text-xs font-medium ${change < 0 ? 'text-neg-600' : 'text-pos-600'}`}>
                {change >= 0 ? '▲' : '▼'} {fmt(Math.abs(change))}
                {changePct !== null && ` (${changePct >= 0 ? '+' : ''}${changePct.toFixed(1)}%)`}
              </span>
            )}
          </div>
          <AnimatedNumber
            value={totals.netWorth}
            format={fmt}
            className="tnum block text-3xl font-semibold tracking-tight text-ink-900"
          />
          <div className="mt-4">
            <LineChart points={chartPoints} formatValue={fmt} height={190} />
          </div>
          {chartPoints.length <= 1 && (
            <p className="mt-2 text-xs text-ink-400">
              History starts today — a point is recorded each day you open the app.
            </p>
          )}
        </div>

        <aside className="space-y-4">
          <div className="rounded-2xl border border-ink-200 bg-surface p-5 shadow-card">
            <h3 className="mb-3 text-sm font-semibold text-ink-900">Summary</h3>
            <SummaryRow label="Assets" value={fmt(totals.assets)} onClick={() => scrollToGroup(assetGroups[0]?.type)} />
            <div className="my-2 h-2 w-full overflow-hidden rounded-full bg-ink-100">
              <div
                className="h-full rounded-full bg-gradient-to-r from-pos-500 to-brand-500"
                style={{
                  width: `${totals.assets > 0 ? Math.min(100, ((totals.assets - totals.liabilities) / totals.assets) * 100) : 0}%`,
                }}
              />
            </div>
            <SummaryRow
              label="Liabilities"
              value={fmt(totals.liabilities)}
              tone="neg"
              onClick={() => scrollToGroup(liabilityGroups[0]?.type)}
            />
            <div className="mt-3 space-y-1.5 border-t border-ink-100 pt-3 text-xs">
              <SummaryRow small label="Investments" value={fmt(totals.investments)} onClick={() => onNavigate?.('Investments')} />
              <SummaryRow small label="Cash & other" value={fmt(totals.assets - totals.investments)} onClick={() => scrollToGroup(assetGroups[0]?.type)} />
            </div>
          </div>

          <div className="rounded-2xl border border-ink-200 bg-surface p-5 shadow-card">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-ink-900">Composition</h3>
              <div className="flex rounded-lg bg-ink-100 p-0.5 text-xs">
                {[
                  { key: 'type', label: 'Type' },
                  { key: 'owner', label: 'Owner' },
                ].map((t) => (
                  <button
                    key={t.key}
                    type="button"
                    onClick={() => setGroupBy(t.key)}
                    className={`rounded-md px-2 py-1 font-medium transition-colors ${
                      groupBy === t.key ? 'bg-surface text-ink-900 shadow-card' : 'text-ink-500 hover:text-ink-900'
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
            <ul className="space-y-2">
              {compositionGroups.map((g) => {
                const pct = totals.assets > 0 ? (g.value / totals.assets) * 100 : 0
                return (
                  <li key={g.key}>
                    <button
                      type="button"
                      onClick={() =>
                        groupBy === 'type'
                          ? g.key === 'investment'
                            ? onNavigate?.('Investments')
                            : scrollToGroup(g.key)
                          : undefined
                      }
                      className={`mb-1 flex w-full items-center justify-between text-xs ${
                        groupBy === 'type' ? 'cursor-pointer hover:opacity-80' : 'cursor-default'
                      }`}
                    >
                      <span className="flex items-center gap-1.5 font-medium text-ink-700">
                        <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: g.color }} />
                        {g.label}
                      </span>
                      <span className="tnum text-ink-500">{pct.toFixed(0)}%</span>
                    </button>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-ink-100">
                      <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: g.color }} />
                    </div>
                  </li>
                )
              })}
            </ul>
          </div>
        </aside>
      </div>

      <div className="mt-6 grid gap-5 md:grid-cols-2">
        <AccountGroupList title="Assets" groups={assetGroups} onSelect={setViewingAccount} fmt={fmt} fxRates={fxRates} />
        <AccountGroupList title="Liabilities" groups={liabilityGroups} onSelect={setViewingAccount} fmt={fmt} fxRates={fxRates} />
      </div>

      {listed.length === 0 && (
        <p className="py-10 text-center text-sm text-ink-500">
          No spending accounts yet. Add your first one — manual entry only, no bank connection needed.
        </p>
      )}

      <p className="mt-4 text-xs text-ink-400">
        Investments aren’t listed here — they live on the Investments tab. They still count toward net worth above.
      </p>

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

function SummaryRow({ label, value, tone, small, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-baseline justify-between text-left hover:opacity-80"
    >
      <span className={small ? 'text-ink-500' : 'text-sm text-ink-600'}>{label}</span>
      <span
        className={`tnum font-semibold ${small ? 'text-xs' : 'text-sm'} ${
          tone === 'neg' ? 'text-neg-600' : 'text-ink-900'
        }`}
      >
        {value}
      </span>
    </button>
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

function AccountGroupList({ title, groups, onSelect, fmt, fxRates }) {
  if (groups.length === 0) return null
  return (
    <div>
      <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-ink-400">{title}</h3>
      <div className="space-y-4">
        {groups.map((g) => (
          <div key={g.type} id={`account-group-${g.type}`} className="scroll-mt-24 rounded-2xl border border-ink-200 bg-surface shadow-card">
            <div className="flex items-center justify-between border-b border-ink-100 px-4 py-2.5">
              <span className="text-sm font-medium text-ink-700">
                {typeIcon(g.type)} {typeLabel(g.type)}
              </span>
              <span className="tnum text-sm font-semibold text-ink-900">{fmt(g.subtotalAED)}</span>
            </div>
            <ul>
              {g.items.map((a) => (
                <li key={a.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(a)}
                    className="flex w-full items-center justify-between px-4 py-3 text-left text-sm transition-colors hover:bg-ink-50"
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-ink-900">{a.name}</span>
                      <span className="text-xs text-ink-400">{a.owner}</span>
                    </span>
                    <span className="shrink-0 pl-2 text-right">
                      <span className="tnum block text-ink-700">{fmt(toAED(Number(a.value) || 0, a.currency, fxRates))}</span>
                      {a.currency !== 'AED' && (
                        <span className="tnum block text-[11px] text-ink-400">
                          {formatMoney(Number(a.value), a.currency, { decimals: 0 })}
                        </span>
                      )}
                    </span>
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

function AccountDetail({ account, onClose, onEdit }) {
  const [transactions, setTransactions] = useState([])
  const [categories, setCategories] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [addingTxn, setAddingTxn] = useState(false)

  async function refresh() {
    setError('')
    try {
      const [txns, cats] = await Promise.all([listTransactions({ accountId: account.id }), listCategories()])
      setTransactions(txns)
      setCategories(cats)
    } catch {
      setError('Could not load this account’s transactions.')
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
    if (result.split) return
    await createTransaction(result.fields)
    setAddingTxn(false)
    await refresh()
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-end justify-center overflow-y-auto bg-black/40 p-0 sm:items-center sm:p-6">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-surface p-6 shadow-pop sm:rounded-2xl">
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

        <p className="tnum my-3 text-2xl font-semibold text-ink-900">
          {formatMoney(Number(account.value), account.currency, { decimals: 2 })}
        </p>

        <div className="mb-5 flex gap-2">
          <button
            type="button"
            onClick={onEdit}
            className="flex-1 rounded-lg border border-ink-300 px-3 py-2 text-sm font-medium text-ink-700 transition-colors hover:bg-ink-50"
          >
            Edit account
          </button>
          <button
            type="button"
            onClick={() => setAddingTxn(true)}
            className="flex-1 rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-700"
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
