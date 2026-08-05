import { useEffect, useMemo, useState } from 'react'
import {
  listTransactions,
  createTransaction,
  createSplitTransaction,
  updateTransaction,
  deleteTransaction,
  deleteSplitGroup,
} from '../lib/transactions'
import { listAccounts, OWNERS } from '../lib/accounts'
import { listCategories } from '../lib/categories'
import TransactionForm from '../components/TransactionForm'

function formatDateHeading(dateStr) {
  const d = new Date(`${dateStr}T00:00:00`)
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
}

function formatAmount(amount, currency) {
  return `${currency} ${Number(amount).toLocaleString('en-AE', { maximumFractionDigits: 2 })}`
}

function groupByDate(transactions) {
  const byDate = new Map()
  for (const t of transactions) {
    if (!byDate.has(t.date)) byDate.set(t.date, [])
    byDate.get(t.date).push(t)
  }
  return Array.from(byDate.entries()).map(([date, items]) => ({ date, entries: groupBySplit(items) }))
}

function groupBySplit(items) {
  const entries = []
  const seenSplitGroups = new Set()
  for (const t of items) {
    if (t.split_group_id) {
      if (seenSplitGroups.has(t.split_group_id)) continue
      seenSplitGroups.add(t.split_group_id)
      const lines = items.filter((x) => x.split_group_id === t.split_group_id)
      entries.push({ kind: 'split', splitGroupId: t.split_group_id, lines })
    } else {
      entries.push({ kind: 'single', transaction: t })
    }
  }
  return entries
}

const EMPTY_FILTERS = { search: '', category: '', owner: '', accountId: '', dateFrom: '', dateTo: '', sort: 'date' }

export default function Transactions() {
  const [transactions, setTransactions] = useState([])
  const [accounts, setAccounts] = useState([])
  const [categories, setCategories] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [filters, setFilters] = useState(EMPTY_FILTERS)
  const [editing, setEditing] = useState(null) // 'new', a single transaction, or { splitGroup: [...] }

  async function refresh() {
    setError('')
    try {
      const [txns, accts, cats] = await Promise.all([listTransactions(filters), listAccounts(), listCategories()])
      setTransactions(txns)
      setAccounts(accts)
      setCategories(cats)
    } catch {
      setError('Could not load transactions. Check your connection and try again.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    refresh()
  }, [filters])

  const accountName = useMemo(() => {
    const map = new Map(accounts.map((a) => [a.id, a.name]))
    return (id) => map.get(id) ?? '—'
  }, [accounts])

  const flat = filters.sort === 'amount'
  const groups = flat ? [{ date: null, entries: groupBySplit(transactions) }] : groupByDate(transactions)

  function openEdit(entry) {
    if (entry.kind === 'split') {
      const first = entry.lines[0]
      setEditing({
        id: first.id,
        split_group_id: entry.splitGroupId,
        splitGroup: entry.lines,
        date: first.date,
        currency: first.currency,
        account_id: first.account_id,
        owner: first.owner,
        note: first.note,
        tags: first.tags,
      })
    } else {
      setEditing(entry.transaction)
    }
  }

  async function handleSave(result) {
    const isEditingExisting = editing && editing !== 'new'

    if (isEditingExisting) {
      if (editing.splitGroup) {
        await deleteSplitGroup(editing.split_group_id)
      } else if (!result.split) {
        await updateTransaction(editing.id, result.fields)
        setEditing(null)
        await refresh()
        return
      } else {
        await deleteTransaction(editing.id)
      }
    }

    if (result.split) {
      await createSplitTransaction(result.baseFields, result.splitLines)
    } else {
      await createTransaction(result.fields)
    }
    setEditing(null)
    await refresh()
  }

  async function handleDelete() {
    if (editing.splitGroup) {
      await deleteSplitGroup(editing.split_group_id)
    } else {
      await deleteTransaction(editing.id)
    }
    setEditing(null)
    await refresh()
  }

  if (loading) {
    return <div className="px-6 py-10 text-center text-sm text-stone-500">Loading…</div>
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-stone-900">Transactions</h2>
        <button
          type="button"
          onClick={() => setEditing('new')}
          disabled={accounts.length === 0}
          className="rounded-lg bg-stone-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-stone-800 disabled:opacity-50"
        >
          + Add
        </button>
      </div>

      {accounts.length === 0 && (
        <p className="mb-4 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-700">
          Add an account first (Accounts tab) before logging transactions.
        </p>
      )}

      <Filters filters={filters} setFilters={setFilters} categories={categories} accounts={accounts} />

      {error && (
        <p role="alert" className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">
          {error}
        </p>
      )}

      {groups.length === 0 && !error && (
        <p className="py-10 text-center text-sm text-stone-500">No transactions match. Try adjusting filters.</p>
      )}

      <div className="space-y-6">
        {groups.map((g) => (
          <div key={g.date ?? 'flat'}>
            {g.date && (
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-stone-500">{formatDateHeading(g.date)}</h3>
            )}
            <div className="rounded-xl border border-stone-200 bg-white">
              {g.entries.map((entry) => (
                <EntryRow
                  key={entry.kind === 'split' ? entry.splitGroupId : entry.transaction.id}
                  entry={entry}
                  accountName={accountName}
                  showDate={flat}
                  onClick={() => openEdit(entry)}
                />
              ))}
            </div>
          </div>
        ))}
      </div>

      {editing && (
        <TransactionForm
          transaction={editing === 'new' ? null : editing}
          accounts={accounts}
          categories={categories}
          onSave={handleSave}
          onCancel={() => setEditing(null)}
          onDelete={handleDelete}
        />
      )}
    </div>
  )
}

function EntryRow({ entry, accountName, showDate, onClick }) {
  if (entry.kind === 'single') {
    const t = entry.transaction
    return (
      <button
        type="button"
        onClick={onClick}
        className="flex w-full items-center justify-between border-b border-stone-100 px-4 py-3 text-left text-sm last:border-b-0 hover:bg-stone-50"
      >
        <span className="min-w-0">
          <span className="flex items-center gap-2">
            <span className="font-medium text-stone-900">{t.category || 'Uncategorised'}</span>
            {t.needs_review && (
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-amber-700">
                Needs review
              </span>
            )}
          </span>
          <span className="block truncate text-xs text-stone-400">
            {showDate ? `${formatDateHeading(t.date)} · ` : ''}
            {t.owner} · {accountName(t.account_id)}
            {t.note ? ` · ${t.note}` : ''}
          </span>
        </span>
        <span className="shrink-0 pl-2 font-medium text-stone-700">{formatAmount(t.amount, t.currency)}</span>
      </button>
    )
  }

  const total = entry.lines.reduce((sum, l) => sum + Number(l.amount), 0)
  const first = entry.lines[0]
  return (
    <button
      type="button"
      onClick={onClick}
      className="block w-full border-b border-stone-100 px-4 py-3 text-left text-sm last:border-b-0 hover:bg-stone-50"
    >
      <span className="flex items-center justify-between">
        <span className="flex items-center gap-2">
          <span className="font-medium text-stone-900">Split</span>
          <span className="rounded-full bg-stone-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-stone-500">
            {entry.lines.length} categories
          </span>
        </span>
        <span className="font-medium text-stone-700">{formatAmount(total, first.currency)}</span>
      </span>
      <span className="mt-1 block text-xs text-stone-400">
        {showDate ? `${formatDateHeading(first.date)} · ` : ''}
        {entry.lines.map((l) => l.category).join(', ')} · {first.owner} · {accountName(first.account_id)}
      </span>
    </button>
  )
}

function Filters({ filters, setFilters, categories, accounts }) {
  function set(patch) {
    setFilters((f) => ({ ...f, ...patch }))
  }

  return (
    <div className="mb-4 space-y-2 rounded-xl border border-stone-200 bg-white p-3">
      <input
        type="search"
        value={filters.search}
        onChange={(e) => set({ search: e.target.value })}
        placeholder="Search notes…"
        className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm focus:border-stone-500 focus:outline-none"
      />
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <select
          value={filters.category}
          onChange={(e) => set({ category: e.target.value })}
          className="rounded-lg border border-stone-300 px-2 py-2 text-sm focus:border-stone-500 focus:outline-none"
        >
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c.id} value={c.name}>
              {c.name}
            </option>
          ))}
        </select>
        <select
          value={filters.owner}
          onChange={(e) => set({ owner: e.target.value })}
          className="rounded-lg border border-stone-300 px-2 py-2 text-sm focus:border-stone-500 focus:outline-none"
        >
          <option value="">All owners</option>
          {OWNERS.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
        <select
          value={filters.accountId}
          onChange={(e) => set({ accountId: e.target.value })}
          className="rounded-lg border border-stone-300 px-2 py-2 text-sm focus:border-stone-500 focus:outline-none"
        >
          <option value="">All accounts</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        <select
          value={filters.sort}
          onChange={(e) => set({ sort: e.target.value })}
          className="rounded-lg border border-stone-300 px-2 py-2 text-sm focus:border-stone-500 focus:outline-none"
        >
          <option value="date">Sort: Date</option>
          <option value="amount">Sort: Amount</option>
        </select>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <input
          type="date"
          value={filters.dateFrom}
          onChange={(e) => set({ dateFrom: e.target.value })}
          className="rounded-lg border border-stone-300 px-2 py-2 text-sm focus:border-stone-500 focus:outline-none"
        />
        <input
          type="date"
          value={filters.dateTo}
          onChange={(e) => set({ dateTo: e.target.value })}
          className="rounded-lg border border-stone-300 px-2 py-2 text-sm focus:border-stone-500 focus:outline-none"
        />
      </div>
    </div>
  )
}
