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
import { useAccountsAndFx } from '../lib/useAccountsAndFx'
import { listTransactions, createTransaction, updateTransaction } from '../lib/transactions'
import { listCategories } from '../lib/categories'
import { listDailyNetWorth, recordDailyNetWorth } from '../lib/snapshots'
import { colorizeGroups } from '../lib/chartPalette'
import { usePrefs } from '../lib/PrefsContext'
import { formatMoney, toAED } from '../lib/money'
import { cardSummary, parseLast4, cardDisplayName, previousCycles, categoryBreakdown } from '../lib/cards'
import { todayLocal } from '../lib/dates'
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
  // Transactions for the card-cycle totals and the detail view's spending
  // history. 220 days covers the open cycle plus roughly six prior ones (the
  // longest cycle is 31 days), which is what the "recent cycles" trend needs
  // -- so the cards section and its detail view never have to re-query per
  // card.
  const [recentTxns, setRecentTxns] = useState([])
  const [viewingCard, setViewingCard] = useState(null)
  const today = todayLocal()

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

  function refreshRecentTxns() {
    const from = new Date(Date.now() - 220 * 86400000).toISOString().slice(0, 10)
    return listTransactions({ dateFrom: from, dateTo: today })
      .then((rows) => setRecentTxns(rows))
      .catch(() => setRecentTxns([]))
  }

  useEffect(() => {
    refreshRecentTxns()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [today])

  const listed = accounts.filter(INVESTMENTS_EXCLUDED)
  const cards = listed.filter((a) => a.type === 'credit_card')
  const bankAccounts = listed.filter((a) => a.type === 'cash' || a.type === 'fixed_deposit')
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

      <CardsSection
        cards={cards}
        transactions={recentTxns}
        fxRates={fxRates}
        fmt={fmt}
        today={today}
        onEdit={setEditing}
        onSelect={setViewingCard}
      />

      <BankSection accounts={bankAccounts} fmt={fmt} fxRates={fxRates} onSelect={setViewingAccount} onAdd={() => setEditing('new')} />

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

      {viewingCard && !editing && (
        <CardDetail
          account={viewingCard}
          transactions={recentTxns}
          fxRates={fxRates}
          fmt={fmt}
          today={today}
          onClose={() => setViewingCard(null)}
          onEdit={() => setEditing(viewingCard)}
          onRefresh={refreshRecentTxns}
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

function formatDayMonth(iso) {
  if (!iso) return null
  return new Date(`${iso}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

function utilisationTone(pct) {
  if (pct == null) return 'bg-ink-300'
  if (pct >= 90) return 'bg-neg-500'
  if (pct >= 70) return 'bg-amber-500'
  return 'bg-brand-500'
}

/**
 * Credit cards: what the limit is, what's owed against it, and what has
 * actually been logged this statement cycle.
 *
 * The cycle figure is labelled "logged this cycle" rather than "spent",
 * deliberately. It only counts transactions someone captured against this
 * card, so it is a floor and not a statement estimate — every restaurant bill
 * nobody photographed is missing from it. An understated card balance is worse
 * than none, because it would have you set aside too little. See
 * docs/telegram-bot-sprint-plan.md §6.2.
 */
function CardsSection({ cards, transactions, fxRates, fmt, today, onEdit, onSelect }) {
  if (cards.length === 0) return null
  return (
    <section className="mt-6">
      <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-ink-400">Credit cards</h3>
      <div className="grid gap-4 md:grid-cols-2">
        {cards.map((card) => {
          const s = cardSummary(card, transactions, fxRates, today)
          const pct = s.utilisationPct
          return (
            <div key={card.id} className="rounded-2xl border border-ink-200 bg-surface p-5 shadow-card">
              <div className="mb-3 flex items-start justify-between gap-3">
                <button type="button" onClick={() => onSelect(card)} className="min-w-0 text-left hover:opacity-80">
                  <p className="truncate text-sm font-semibold text-ink-900">💳 {card.name}</p>
                  <p className="text-xs text-ink-400">
                    {card.owner} · {card.currency}
                  </p>
                </button>
                <button
                  type="button"
                  onClick={() => onEdit(card)}
                  className="shrink-0 rounded-lg border border-ink-300 px-2 py-1 text-xs font-medium text-ink-600 hover:bg-ink-50"
                >
                  Edit
                </button>
              </div>

              {s.limit == null ? (
                <button
                  type="button"
                  onClick={() => onEdit(card)}
                  className="mb-3 w-full rounded-lg border border-dashed border-ink-300 px-3 py-2 text-left text-xs text-ink-500 hover:bg-ink-50"
                >
                  <span className="font-medium text-ink-700">No credit limit set.</span> Add it from your bank app to
                  see how much of the card is used.
                </button>
              ) : (
                <>
                  <div className="mb-1 flex items-baseline justify-between">
                    <span className="tnum text-2xl font-semibold text-ink-900">{fmt(s.owed)}</span>
                    <span className="tnum text-xs text-ink-500">of {fmt(s.limit)}</span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-ink-100">
                    <div
                      className={`h-full rounded-full transition-all ${utilisationTone(pct)}`}
                      style={{ width: `${pct == null ? 0 : Math.min(100, Math.max(0, pct))}%` }}
                    />
                  </div>
                  <div className="mt-1.5 flex items-baseline justify-between text-xs">
                    <span className={pct != null && pct >= 90 ? 'font-medium text-neg-600' : 'text-ink-500'}>
                      {pct == null ? 'Utilisation unavailable' : `${pct.toFixed(0)}% used`}
                    </span>
                    <span className="tnum text-ink-500">{fmt(s.available)} available</span>
                  </div>
                </>
              )}

              <dl className="mt-3 space-y-1 border-t border-ink-100 pt-3 text-xs">
                {s.cycle ? (
                  <>
                    <div className="flex justify-between">
                      <dt className="text-ink-500">Logged this cycle</dt>
                      <dd className="tnum font-medium text-ink-900">
                        {fmt(s.cycleSpend)}{' '}
                        <span className="font-normal text-ink-400">
                          ({s.cycleCount} {s.cycleCount === 1 ? 'txn' : 'txns'})
                        </span>
                      </dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-ink-500">Statement closes</dt>
                      <dd className="text-ink-700">
                        {formatDayMonth(s.cycle.end)}
                        {s.daysToClose != null && (
                          <span className="text-ink-400">
                            {' '}
                            ({s.daysToClose === 0 ? 'today' : `in ${s.daysToClose}d`})
                          </span>
                        )}
                      </dd>
                    </div>
                  </>
                ) : (
                  <div className="flex justify-between">
                    <dt className="text-ink-500">Statement cycle</dt>
                    <dd className="text-ink-400">not set</dd>
                  </div>
                )}
                {s.dueDate && (
                  <div className="flex justify-between">
                    <dt className="text-ink-500">Payment due</dt>
                    <dd className="text-ink-700">{formatDayMonth(s.dueDate)}</dd>
                  </div>
                )}
              </dl>

              {s.cycle && (
                <p className="mt-2 text-[11px] leading-snug text-ink-400">
                  Counts only what’s been logged in the app — check your bank before you pay.
                </p>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}

/** Bank and cash accounts, with their balances. */
function BankSection({ accounts, fmt, fxRates, onSelect, onAdd }) {
  const total = accounts.reduce((sum, a) => sum + toAED(Number(a.value) || 0, a.currency, fxRates), 0)
  return (
    <section className="mt-6">
      <div className="mb-2 flex items-baseline justify-between">
        <h3 className="text-[11px] font-semibold uppercase tracking-widest text-ink-400">Bank &amp; cash</h3>
        {accounts.length > 0 && <span className="tnum text-xs font-medium text-ink-600">{fmt(total)}</span>}
      </div>
      <div className="rounded-2xl border border-ink-200 bg-surface shadow-card">
        {accounts.length === 0 ? (
          <div className="px-4 py-6 text-center">
            <p className="text-sm text-ink-500">No bank accounts yet.</p>
            <button
              type="button"
              onClick={onAdd}
              className="mt-2 text-xs font-medium text-brand-600 underline hover:text-brand-700"
            >
              Add your first one
            </button>
          </div>
        ) : (
          accounts.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => onSelect(a)}
              className="flex w-full items-center justify-between gap-3 border-b border-ink-100 px-4 py-3 text-left last:border-b-0 hover:bg-ink-50"
            >
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium text-ink-900">
                  {typeIcon(a.type)} {a.name}
                </span>
                <span className="block text-xs text-ink-400">
                  {a.owner} · {typeLabel(a.type)}
                </span>
              </span>
              <span className="shrink-0 text-right">
                <span className="tnum block text-sm font-semibold text-ink-900">
                  {fmt(toAED(Number(a.value) || 0, a.currency, fxRates))}
                </span>
                {a.currency !== 'AED' && (
                  <span className="tnum block text-xs text-ink-400">
                    {formatMoney(Number(a.value) || 0, a.currency)}
                  </span>
                )}
              </span>
            </button>
          ))
        )}
      </div>
    </section>
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

/**
 * The card tracking view: balance and limit, this cycle's spend broken down
 * by category, and the trend across recent cycles.
 *
 * Everything here reads from `transactions`/`cardSummary`'s cycle window —
 * nothing here is itself a source of truth, including "logged this cycle"
 * itself: it is a floor, not a statement total, since it only counts what
 * was actually captured (see cards.js).
 */
function CardDetail({ account, transactions, fxRates, fmt, today, onClose, onEdit, onRefresh }) {
  const [categories, setCategories] = useState([])
  const [addingTxn, setAddingTxn] = useState(false)

  useEffect(() => {
    listCategories()
      .then(setCategories)
      .catch(() => setCategories([]))
  }, [])

  const s = cardSummary(account, transactions, fxRates, today)
  const last4 = parseLast4(account.name)
  const pct = s.utilisationPct

  const past = s.cycle ? previousCycles(account, transactions, fxRates, today, 6) : []
  const breakdown = categoryBreakdown(account, transactions, fxRates, s.cycle)
  const colored = colorizeGroups(breakdown.map((b) => ({ key: b.category, label: b.category, value: b.total })))
  const breakdownById = new Map(colored.map((c) => [c.label, c]))

  const cycleTxns = s.cycle
    ? transactions
        .filter((t) => t.account_id === account.id && t.date >= s.cycle.start && t.date <= s.cycle.end)
        .sort((a, b) => (a.date < b.date ? 1 : -1))
    : []

  async function handleCategoryChange(id, category) {
    await updateTransaction(id, { category: category || null })
    await onRefresh()
  }

  async function handleAddTxn(result) {
    if (result.split) return
    await createTransaction(result.fields)
    setAddingTxn(false)
    await onRefresh()
  }

  const maxPastSpend = Math.max(s.cycleSpend ?? 0, ...past.map((c) => c.spend), 1)

  return (
    <div className="fixed inset-0 z-[100] flex items-end justify-center overflow-y-auto bg-black/40 p-0 sm:items-center sm:p-6">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-surface p-6 shadow-pop sm:rounded-2xl">
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h2 className="text-lg font-semibold text-ink-900">💳 {cardDisplayName(account.name)}</h2>
            <p className="text-xs text-ink-400">
              {account.owner} · {last4 ? `···· ${last4}` : account.currency}
              {s.cycle && (
                <>
                  {' · '}
                  {s.daysToClose === 0 ? 'closes today' : `closes in ${s.daysToClose}d`}
                </>
              )}
            </p>
          </div>
          <button type="button" onClick={onClose} className="text-sm text-ink-400 hover:text-ink-600">
            Close
          </button>
        </div>

        {s.limit == null ? (
          <p className="mb-5 text-sm text-ink-500">
            No credit limit on file. <button type="button" onClick={onEdit} className="text-brand-600 underline">Add one</button>{' '}
            to see utilisation.
          </p>
        ) : (
          <div className="mb-5">
            <div className="mb-1 flex items-baseline justify-between">
              <span className="tnum text-3xl font-semibold text-ink-900">{fmt(s.owed)}</span>
              <span className="tnum text-xs text-ink-500">of {fmt(s.limit)} limit</span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-ink-100">
              <div
                className={`h-full rounded-full transition-all ${utilisationTone(pct)}`}
                style={{ width: `${pct == null ? 0 : Math.min(100, Math.max(0, pct))}%` }}
              />
            </div>
            <div className="mt-1.5 flex items-baseline justify-between text-xs">
              <span className={pct != null && pct >= 90 ? 'font-medium text-neg-600' : 'text-ink-500'}>
                {pct == null ? '—' : `${pct.toFixed(0)}% used`}
              </span>
              <span className="tnum text-ink-500">{fmt(s.available)} available</span>
            </div>
          </div>
        )}

        <div className="mb-5 rounded-xl border border-ink-200 p-3">
          <p className="text-xs text-ink-500">Logged this cycle</p>
          <p className="tnum text-lg font-semibold text-ink-900">{fmt(s.cycleSpend)}</p>
          <p className="text-xs text-ink-400">{s.cycleCount} transactions</p>
        </div>

        {s.dueDate && (
          <p className="mb-5 rounded-lg bg-ink-50 px-3 py-2 text-xs text-ink-600">
            Payment of at least this cycle's total is due <span className="font-medium">{formatDayMonth(s.dueDate)}</span>
            {s.daysToDue != null && ` (${s.daysToDue === 0 ? 'today' : `in ${s.daysToDue}d`})`}.
          </p>
        )}

        {breakdown.length > 0 && (
          <div className="mb-5">
            <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink-500">Spend by category</h3>
            <div className="space-y-2">
              {breakdown.map((b) => {
                const c = breakdownById.get(b.category)
                return (
                  <div key={b.category}>
                    <div className="mb-0.5 flex items-center justify-between text-xs">
                      <span className="flex items-center gap-1.5 font-medium text-ink-700">
                        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: c?.color ?? '#8b95a7' }} />
                        {b.category}
                      </span>
                      <span className="tnum text-ink-500">
                        {fmt(b.total)} · {b.pct.toFixed(0)}%
                      </span>
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-ink-100">
                      <div
                        className="h-full rounded-full"
                        style={{ width: `${b.pct}%`, backgroundColor: c?.color ?? '#8b95a7' }}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {past.length > 0 && (
          <div className="mb-5">
            <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink-500">Recent cycles</h3>
            <div className="flex items-end gap-1.5" style={{ height: 64 }}>
              {[...past].reverse().map((p) => (
                <div key={p.cycle.end} className="flex flex-1 flex-col items-center gap-1" title={fmt(p.spend)}>
                  <div
                    className="w-full rounded-t bg-ink-200"
                    style={{ height: `${Math.max(4, (p.spend / maxPastSpend) * 48)}px` }}
                  />
                  <span className="text-[10px] text-ink-400">{formatDayMonth(p.cycle.end).split(' ')[0]}</span>
                </div>
              ))}
              <div className="flex flex-1 flex-col items-center gap-1" title={fmt(s.cycleSpend)}>
                <div
                  className="w-full rounded-t bg-brand-500"
                  style={{ height: `${Math.max(4, ((s.cycleSpend ?? 0) / maxPastSpend) * 48)}px` }}
                />
                <span className="text-[10px] font-medium text-brand-600">now</span>
              </div>
            </div>
          </div>
        )}

        <div className="mb-5 flex gap-2">
          <button
            type="button"
            onClick={onEdit}
            className="flex-1 rounded-lg border border-ink-300 px-3 py-2 text-sm font-medium text-ink-700 transition-colors hover:bg-ink-50"
          >
            Edit card
          </button>
          <button
            type="button"
            onClick={() => setAddingTxn(true)}
            className="flex-1 rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-700"
          >
            + Add transaction
          </button>
        </div>

        <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink-500">This cycle's transactions</h3>
        <TransactionList
          transactions={cycleTxns}
          accountName={() => account.name}
          flat
          onEntryClick={() => {}}
          categories={categories}
          onCategoryChange={handleCategoryChange}
          emptyMessage="Nothing logged in the open cycle yet."
        />

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
