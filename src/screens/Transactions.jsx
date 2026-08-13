import { useEffect, useMemo, useState } from 'react'
import {
  listTransactions,
  createTransaction,
  replaceCategorySplit,
  updateTransaction,
  deleteTransaction,
  deleteTransactionGroup,
  countNeedsReview,
  markReviewed,
  countUnreviewed,
  setReviewedMany,
} from '../lib/transactions'
import { listRules, createRule, deleteRule } from '../lib/categoryRules'
import { listAccounts, OWNERS } from '../lib/accounts'
import { listCategories } from '../lib/categories'
import { sortByAmountAED, transactionStats, transactionsToCSV } from '../lib/reports'
import { usePrefs } from '../lib/PrefsContext'
import TransactionForm from '../components/TransactionForm'
import TransactionList from '../components/TransactionList'
import { groupEntries, entryKey } from '../lib/transactionGroups'
import { useRealtimeRefresh } from '../lib/useRealtime'
import { REALTIME_TABLES } from '../lib/realtime'

const EMPTY_FILTERS = {
  search: '',
  category: '',
  owner: '',
  accountId: '',
  dateFrom: '',
  dateTo: '',
  sort: 'date',
  needsReview: false,
  unreviewed: false,
}

export default function Transactions({ navPayload, onConsumeNav }) {
  const { fmt, fxRates } = usePrefs()
  const [transactions, setTransactions] = useState([])
  const [accounts, setAccounts] = useState([])
  const [categories, setCategories] = useState([])
  const [rules, setRules] = useState([])
  const [reviewCount, setReviewCount] = useState(0)
  const [unreviewedCount, setUnreviewedCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [filters, setFilters] = useState(EMPTY_FILTERS)
  const [editing, setEditing] = useState(null) // 'new', a single transaction, or { splitGroup: [...] }
  const [showRules, setShowRules] = useState(false)
  const [selectMode, setSelectMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState(new Set())
  const [bulkBusy, setBulkBusy] = useState(false)

  async function refresh() {
    setError('')
    try {
      const [txns, accts, cats, pending, unreviewed, ruleRows] = await Promise.all([
        listTransactions(filters),
        listAccounts(),
        listCategories(),
        countNeedsReview(),
        countUnreviewed(),
        listRules(),
      ])
      setTransactions(txns)
      // You don't spend from a stock holding — a share of NVDA is not an
      // account you can put a grocery bill against. Investments are excluded
      // here entirely (they live on their own tab), which also stops 41 stock
      // rows burying the 4 accounts actually used day to day.
      setAccounts(accts.filter((a) => a.type !== 'investment'))
      setCategories(cats)
      setReviewCount(pending)
      setUnreviewedCount(unreviewed)
      setRules(ruleRows)
    } catch {
      setError('Could not load transactions. Check your connection and try again.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    refresh()
  }, [filters])

  // Another client — the Telegram bot, or the other person's phone — writing to
  // these tables now refreshes this screen (INT-01).
  useRealtimeRefresh(REALTIME_TABLES.transactions, refresh)

  // Deep-link from Home's Recent-transaction row: open that specific
  // transaction's edit modal once its data has arrived, then tell App to
  // forget the payload so revisiting this tab later doesn't reopen it.
  useEffect(() => {
    if (!navPayload?.openTransactionId || transactions.length === 0) return
    const entry = groupEntries(transactions).find((e) =>
      e.kind === 'single' ? e.transaction.id === navPayload.openTransactionId : e.lines.some((l) => l.id === navPayload.openTransactionId)
    )
    if (entry) openEdit(entry)
    onConsumeNav?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transactions, navPayload])

  function toggleSelectMode() {
    setSelectMode((v) => !v)
    setSelectedIds(new Set())
  }

  function toggleSelect(key) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const selectedEntries = useMemo(() => {
    const keys = new Set(selectedIds)
    return groupEntries(transactions).filter((e) => keys.has(entryKey(e)))
  }, [transactions, selectedIds])

  async function handleCreateRule(pattern, category) {
    await createRule(pattern, category)
    await refresh()
  }

  async function handleDeleteRule(id) {
    await deleteRule(id)
    await refresh()
  }

  async function bulkSetCategory(category) {
    setBulkBusy(true)
    try {
      const singles = selectedEntries.filter((e) => e.kind === 'single')
      await Promise.all(singles.map((e) => updateTransaction(e.transaction.id, { category })))
      setSelectedIds(new Set())
      await refresh()
    } finally {
      setBulkBusy(false)
    }
  }

  async function bulkSetOwner(owner) {
    setBulkBusy(true)
    try {
      await Promise.all(
        selectedEntries.map((e) =>
          e.kind === 'single'
            ? updateTransaction(e.transaction.id, { owner })
            : Promise.all(e.lines.map((l) => updateTransaction(l.id, { owner })))
        )
      )
      setSelectedIds(new Set())
      await refresh()
    } finally {
      setBulkBusy(false)
    }
  }

  async function bulkDelete() {
    if (!confirm(`Delete ${selectedEntries.length} transaction${selectedEntries.length === 1 ? '' : 's'}?`)) return
    setBulkBusy(true)
    try {
      await Promise.all(
        // Only a category split deletes as a unit — its lines are meaningless
        // apart. A transfer's two rows are deleted together too, but by id, so
        // the intent stays explicit. Anything else deletes one row at a time.
        selectedEntries.map((e) =>
          e.kind === 'single'
            ? deleteTransaction(e.transaction.id)
            : e.kind === 'split'
              ? deleteTransactionGroup(e.groupId)
              : Promise.all(e.lines.map((l) => deleteTransaction(l.id)))
        )
      )
      setSelectedIds(new Set())
      await refresh()
    } finally {
      setBulkBusy(false)
    }
  }

  const accountName = useMemo(() => {
    const map = new Map(accounts.map((a) => [a.id, a.name]))
    return (id) => map.get(id) ?? '—'
  }, [accounts])

  const flat = filters.sort === 'amount'
  // Postgres sorted these by raw amount, which does not order mixed currencies
  // by value. Re-sort by AED for display (MONEY-04).
  const ordered = flat ? sortByAmountAED(transactions, fxRates) : transactions
  const stats = transactionStats(transactions, fxRates)

  function downloadCSV() {
    const csv = transactionsToCSV(transactions)
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'transactions.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  function openEdit(entry) {
    if (entry.kind === 'transfer') {
      // Editing a transfer through the split editor would rewrite both sides
      // from one row's fields and lose the pairing. Until it has an editor of
      // its own, open the outgoing row alone (DATA-01).
      setEditing(entry.out ?? entry.lines[0])
      return
    }
    if (entry.kind === 'split') {
      const first = entry.lines[0]
      setEditing({
        id: first.id,
        transaction_group_id: entry.groupId,
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

    // Every branch below is now a single call. The old shape deleted the
    // existing rows and *then* inserted their replacement, so a failure
    // between the two destroyed the transaction and left nothing behind
    // (DATA-02). replace_category_split does both inside one database
    // transaction.
    if (result.split) {
      await replaceCategorySplit(result.baseFields, result.splitLines, {
        groupId: isEditingExisting ? (editing.transaction_group_id ?? null) : null,
        transactionId: isEditingExisting && !editing.splitGroup ? editing.id : null,
      })
    } else if (isEditingExisting && editing.splitGroup) {
      // Split collapsing back to one row: same all-or-nothing guarantee, with
      // a single line.
      await replaceCategorySplit(result.fields, [{ category: result.fields.category, amount: result.fields.amount }], {
        groupId: editing.transaction_group_id,
      })
    } else if (isEditingExisting) {
      await updateTransaction(editing.id, result.fields)
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

  async function handleToggleReviewed(ids, reviewed) {
    await setReviewedMany(ids, reviewed)
    await refresh()
  }

  async function bulkMarkReviewed() {
    setBulkBusy(true)
    try {
      const ids = selectedEntries.flatMap((e) => (e.kind === 'single' ? [e.transaction.id] : e.lines.map((l) => l.id)))
      await setReviewedMany(ids, true)
      setSelectedIds(new Set())
      await refresh()
    } finally {
      setBulkBusy(false)
    }
  }

  async function handleCategoryChange(id, category) {
    await updateTransaction(id, { category: category || null })
    await refresh()
  }

  async function handleDelete() {
    if (editing.splitGroup) {
      await deleteTransactionGroup(editing.transaction_group_id)
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
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <div className="mb-4 flex items-center justify-between gap-2">
        <h2 className="text-xl font-semibold tracking-tight text-ink-900">Transactions</h2>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowRules(true)}
            className="rounded-lg border border-ink-300 px-3 py-1.5 text-sm font-medium text-ink-600 transition-colors hover:bg-ink-100"
          >
            Rules{rules.length > 0 ? ` (${rules.length})` : ''}
          </button>
          <button
            type="button"
            onClick={toggleSelectMode}
            className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${
              selectMode ? 'border-brand-600 bg-brand-50 text-brand-700' : 'border-ink-300 text-ink-600 hover:bg-ink-100'
            }`}
          >
            {selectMode ? 'Done' : 'Select'}
          </button>
          <button
            type="button"
            onClick={() => setEditing('new')}
            disabled={accounts.length === 0}
            className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-700 disabled:opacity-50"
          >
            + Add
          </button>
        </div>
      </div>

      {selectMode && selectedIds.size > 0 && (
        <BulkActionBar
          count={selectedIds.size}
          categories={categories}
          busy={bulkBusy}
          onSetCategory={bulkSetCategory}
          onSetOwner={bulkSetOwner}
          onMarkReviewed={bulkMarkReviewed}
          onDelete={bulkDelete}
        />
      )}

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

      {error && (
        <p role="alert" className="mb-4 rounded-lg bg-neg-50 px-4 py-3 text-sm text-neg-600">
          {error}
        </p>
      )}

      <div className="grid gap-5 lg:grid-cols-[1fr_260px]">
        <div>
          <Filters filters={filters} setFilters={setFilters} categories={categories} accounts={accounts} />

          <TransactionList
            transactions={ordered}
            accountName={accountName}
            flat={flat}
            onEntryClick={selectMode ? (entry) => toggleSelect(entryKey(entry)) : openEdit}
            onMarkReviewed={selectMode ? undefined : handleMarkReviewed}
            onToggleReviewed={selectMode ? undefined : handleToggleReviewed}
            categories={categories}
            onCategoryChange={selectMode ? undefined : handleCategoryChange}
            selectable={selectMode}
            selectedIds={selectedIds}
            onToggleSelect={toggleSelect}
            emptyMessage="No transactions match. Try adjusting filters."
          />
        </div>

        <aside className="rounded-2xl border border-ink-200 bg-surface p-4 shadow-card lg:sticky lg:top-24 lg:h-fit">
          <h3 className="mb-3 text-sm font-semibold text-ink-900">Summary</h3>
          <dl className="space-y-2.5 text-sm">
            <SummaryStat label="Transactions" value={stats.count} />
            <SummaryStat label="Unreviewed" value={unreviewedCount} />
            <SummaryStat label="Largest" value={fmt(stats.largest)} />
            <SummaryStat label="Average" value={fmt(stats.average)} />
            <SummaryStat label="First transaction" value={stats.first ?? '—'} />
            <SummaryStat label="Last transaction" value={stats.last ?? '—'} />
          </dl>
          <button
            type="button"
            onClick={downloadCSV}
            disabled={transactions.length === 0}
            className="mt-4 w-full rounded-lg border border-ink-300 px-3 py-1.5 text-xs font-medium text-ink-600 transition-colors hover:bg-ink-100 disabled:opacity-50"
          >
            Download CSV
          </button>
        </aside>
      </div>

      {editing && (
        <TransactionForm
          transaction={editing === 'new' ? null : editing}
          accounts={accounts}
          categories={categories}
          rules={rules}
          onSave={handleSave}
          onCancel={() => setEditing(null)}
          onDelete={handleDelete}
          onCreateRule={handleCreateRule}
        />
      )}

      {showRules && (
        <RulesManager
          rules={rules}
          categories={categories}
          onDelete={handleDeleteRule}
          onAdded={refresh}
          onClose={() => setShowRules(false)}
        />
      )}
    </div>
  )
}

function BulkActionBar({ count, categories, busy, onSetCategory, onSetOwner, onMarkReviewed, onDelete }) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2 rounded-2xl border border-brand-200 bg-brand-50 px-4 py-3 text-sm">
      <span className="font-medium text-brand-800">
        {count} selected
      </span>
      <select
        defaultValue=""
        disabled={busy}
        onChange={(e) => {
          if (e.target.value) onSetCategory(e.target.value)
          e.target.value = ''
        }}
        className="rounded-lg border border-ink-300 bg-surface px-2 py-1.5 text-sm"
      >
        <option value="" disabled>
          Set category…
        </option>
        {categories.map((c) => (
          <option key={c.id} value={c.name}>
            {c.icon} {c.name}
          </option>
        ))}
      </select>
      <select
        defaultValue=""
        disabled={busy}
        onChange={(e) => {
          if (e.target.value) onSetOwner(e.target.value)
          e.target.value = ''
        }}
        className="rounded-lg border border-ink-300 bg-surface px-2 py-1.5 text-sm"
      >
        <option value="" disabled>
          Set owner…
        </option>
        {OWNERS.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
      <button
        type="button"
        disabled={busy}
        onClick={onMarkReviewed}
        className="rounded-lg border border-ink-300 px-3 py-1.5 text-sm font-medium text-ink-600 hover:bg-ink-100 disabled:opacity-50"
      >
        Mark reviewed
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={onDelete}
        className="ml-auto rounded-lg border border-neg-200 px-3 py-1.5 text-sm font-medium text-neg-600 hover:bg-neg-100 disabled:opacity-50"
      >
        Delete
      </button>
    </div>
  )
}

function RulesManager({ rules, categories, onDelete, onAdded, onClose }) {
  const [pattern, setPattern] = useState('')
  const [category, setCategory] = useState(categories[0]?.name ?? '')
  const [saving, setSaving] = useState(false)

  async function handleAdd(e) {
    e.preventDefault()
    if (!pattern.trim() || !category) return
    setSaving(true)
    try {
      await createRule(pattern.trim(), category)
      setPattern('')
      await onAdded()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-end justify-center overflow-y-auto bg-black/40 p-0 sm:items-center sm:p-6">
      <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-surface p-6 shadow-xl sm:rounded-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-ink-900">Edit rules</h2>
          <button type="button" onClick={onClose} className="text-sm text-ink-500 hover:text-ink-900">
            Close
          </button>
        </div>
        <p className="mb-4 text-xs text-ink-500">
          When a new transaction's note contains a rule's pattern, its category is auto-applied. Newest rule wins if more than
          one matches.
        </p>

        <form onSubmit={handleAdd} className="mb-4 flex items-center gap-2">
          <input
            type="text"
            value={pattern}
            onChange={(e) => setPattern(e.target.value)}
            placeholder="e.g. Careem"
            className="flex-1 rounded-lg border border-ink-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/15"
          />
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="rounded-lg border border-ink-300 px-2 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/15"
          >
            {categories.map((c) => (
              <option key={c.id} value={c.name}>
                {c.icon} {c.name}
              </option>
            ))}
          </select>
          <button
            type="submit"
            disabled={saving || !pattern.trim()}
            className="rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
          >
            Add
          </button>
        </form>

        {rules.length === 0 ? (
          <p className="py-6 text-center text-sm text-ink-500">No rules yet.</p>
        ) : (
          <ul className="divide-y divide-ink-100 rounded-lg border border-ink-200">
            {rules.map((r) => (
              <li key={r.id} className="flex items-center justify-between px-3 py-2 text-sm">
                <span>
                  “{r.pattern}” → <span className="font-medium text-ink-900">{r.category}</span>
                </span>
                <button type="button" onClick={() => onDelete(r.id)} className="text-xs text-neg-600 hover:underline">
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function SummaryStat({ label, value }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="text-ink-500">{label}</dt>
      <dd className="tnum font-medium text-ink-900">{value}</dd>
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
      <label className="flex items-center gap-2 px-1 text-sm text-ink-600">
        <input
          type="checkbox"
          checked={filters.unreviewed}
          onChange={(e) => set({ unreviewed: e.target.checked })}
        />
        Unreviewed only
      </label>
    </div>
  )
}
