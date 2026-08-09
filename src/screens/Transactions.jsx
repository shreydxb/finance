import { useEffect, useMemo, useState } from 'react'
import {
  listTransactions,
  createTransaction,
  createSplitTransaction,
  updateTransaction,
  deleteTransaction,
  deleteSplitGroup,
  countNeedsReview,
  markReviewed,
} from '../lib/transactions'
import { listAccounts, OWNERS } from '../lib/accounts'
import { listCategories } from '../lib/categories'
import TransactionForm from '../components/TransactionForm'
import TransactionList from '../components/TransactionList'

const EMPTY_FILTERS = {
  search: '',
  category: '',
  owner: '',
  accountId: '',
  dateFrom: '',
  dateTo: '',
  sort: 'date',
  needsReview: false,
}

export default function Transactions() {
  const [transactions, setTransactions] = useState([])
  const [accounts, setAccounts] = useState([])
  const [categories, setCategories] = useState([])
  const [reviewCount, setReviewCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [filters, setFilters] = useState(EMPTY_FILTERS)
  const [editing, setEditing] = useState(null) // 'new', a single transaction, or { splitGroup: [...] }

  async function refresh() {
    setError('')
    try {
      const [txns, accts, cats, pending] = await Promise.all([
        listTransactions(filters),
        listAccounts(),
        listCategories(),
        countNeedsReview(),
      ])
      setTransactions(txns)
      // You don't spend from a stock holding — a share of NVDA is not an
      // account you can put a grocery bill against. Investments are excluded
      // here entirely (they live on their own tab), which also stops 41 stock
      // rows burying the 4 accounts actually used day to day.
      setAccounts(accts.filter((a) => a.type !== 'investment'))
      setCategories(cats)
      setReviewCount(pending)
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

  async function handleMarkReviewed(id) {
    await markReviewed(id)
    await refresh()
  }

  async function handleCategoryChange(id, category) {
    await updateTransaction(id, { category: category || null })
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
    return <div className="px-6 py-10 text-center text-sm text-ink-500">Loading…</div>
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-ink-900">Transactions</h2>
        <button
          type="button"
          onClick={() => setEditing('new')}
          disabled={accounts.length === 0}
          className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-700 disabled:opacity-50"
        >
          + Add
        </button>
      </div>

      {accounts.length === 0 && (
        <p className="mb-4 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-700">
          Add an account first (Accounts tab) before logging transactions.
        </p>
      )}

      {/* Safety net for anything the Telegram Confirm/Fix prompt never got an answer to. */}
      {reviewCount > 0 && (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <span>
            {reviewCount} {reviewCount === 1 ? 'transaction needs' : 'transactions need'} a review.
          </span>
          <button
            type="button"
            onClick={() => setFilters((f) => ({ ...f, needsReview: !f.needsReview }))}
            className="shrink-0 rounded-lg border border-amber-300 px-2 py-1 text-xs font-medium hover:bg-amber-100"
          >
            {filters.needsReview ? 'Show all' : 'Show only these'}
          </button>
        </div>
      )}

      <Filters filters={filters} setFilters={setFilters} categories={categories} accounts={accounts} />

      {error && (
        <p role="alert" className="mb-4 rounded-lg bg-neg-50 px-4 py-3 text-sm text-neg-600">
          {error}
        </p>
      )}

      <TransactionList
        transactions={transactions}
        accountName={accountName}
        flat={flat}
        onEntryClick={openEdit}
        onMarkReviewed={handleMarkReviewed}
        categories={categories}
        onCategoryChange={handleCategoryChange}
        emptyMessage="No transactions match. Try adjusting filters."
      />

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

function Filters({ filters, setFilters, categories, accounts }) {
  function set(patch) {
    setFilters((f) => ({ ...f, ...patch }))
  }

  return (
    <div className="mb-4 space-y-2 rounded-2xl border border-ink-200 bg-surface shadow-card p-3">
      <input
        type="search"
        value={filters.search}
        onChange={(e) => set({ search: e.target.value })}
        placeholder="Search notes…"
        className="w-full rounded-lg border border-ink-300 px-3 py-2 text-sm transition focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/15"
      />
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <select
          value={filters.category}
          onChange={(e) => set({ category: e.target.value })}
          className="rounded-lg border border-ink-300 px-2 py-2 text-sm transition focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/15"
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
          className="rounded-lg border border-ink-300 px-2 py-2 text-sm transition focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/15"
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
          className="rounded-lg border border-ink-300 px-2 py-2 text-sm transition focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/15"
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
          className="rounded-lg border border-ink-300 px-2 py-2 text-sm transition focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/15"
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
          className="rounded-lg border border-ink-300 px-2 py-2 text-sm transition focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/15"
        />
        <input
          type="date"
          value={filters.dateTo}
          onChange={(e) => set({ dateTo: e.target.value })}
          className="rounded-lg border border-ink-300 px-2 py-2 text-sm transition focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/15"
        />
      </div>
    </div>
  )
}
