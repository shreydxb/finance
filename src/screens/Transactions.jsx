import { useEffect, useMemo, useState } from 'react'
import {
  listTransactions,
  createTransaction,
  correctTransaction,
  ordinaryTransactionFields,
  runCommittedTransactionFollowUps,
  replaceCategorySplit,
  deleteTransaction,
  deleteTransactionGroup,
  restoreTransactions,
  countNeedsReview,
  markReviewed,
  countUnreviewed,
  setReviewedMany,
  canEditExistingActivitySplit,
} from '../lib/transactions'
import { listRules, createRule, deleteRule } from '../lib/categoryRules'
import { listAccounts, OWNERS } from '../lib/accounts'
import { listCategories } from '../lib/categories'
import { listGoals } from '../lib/goals'
import { sortByAmountAED, transactionStats, transactionsToCSV } from '../lib/reports'
import { usePrefs } from '../lib/PrefsContext'
import TransactionForm from '../components/TransactionForm'
import TransactionList from '../components/TransactionList'
import { groupEntries, entryKey } from '../lib/transactionGroups'
import { useRealtimeRefresh } from '../lib/useRealtime'
import { REALTIME_TABLES } from '../lib/realtime'
import { useRouteQueryState } from '../lib/useRouteQueryState'
import { ErrorState, LoadingState } from '../design-system'
import DetailShell from '../shell/RouteDetailShell'

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

const ROUTE_FILTER_DEFAULTS = {
  ...EMPTY_FILTERS,
}

const ROUTE_FILTER_SCHEMA = {
  search: 'search', category: 'category', owner: 'owner', accountId: 'account',
  dateFrom: 'from', dateTo: 'to', sort: 'sort',
  needsReview: ['needsReview', (value) => value === '1', () => '1'],
  unreviewed: ['unreviewed', (value) => value === '1', () => '1'],
}

export default function Transactions({ routeQuery, onRouteQueryChange, detailId, onOpenDetail, onCloseDetail }) {
  const { fmt, fxRates } = usePrefs()
  const [transactions, setTransactions] = useState([])
  const [accounts, setAccounts] = useState([])
  const [categories, setCategories] = useState([])
  const [goals, setGoals] = useState([])
  const [rules, setRules] = useState([])
  const [reviewCount, setReviewCount] = useState(0)
  const [unreviewedCount, setUnreviewedCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [routeFilters, setRouteFilters] = useRouteQueryState(
    ROUTE_FILTER_DEFAULTS,
    ROUTE_FILTER_SCHEMA,
    routeQuery,
    onRouteQueryChange,
  )
  const filters = useMemo(() => ({
    ...EMPTY_FILTERS,
    ...routeFilters,
  }), [routeFilters])
  const [editing, setEditing] = useState(null) // 'new', a single transaction, or { splitGroup: [...] }
  const [showRules, setShowRules] = useState(false)
  const [selectMode, setSelectMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState(new Set())
  const [bulkBusy, setBulkBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [undoIds, setUndoIds] = useState([])

  async function refresh() {
    setError('')
    try {
      const [txns, accts, cats, pending, unreviewed, ruleRows, goalRows] = await Promise.all([
        listTransactions(filters),
        listAccounts(),
        listCategories(),
        countNeedsReview(),
        countUnreviewed(),
        listRules(),
        listGoals(),
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
      setGoals(goalRows)
      return true
    } catch {
      setError('Could not load transactions. Check your connection and try again.')
      return false
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

  useEffect(() => {
    if (!detailId) {
      if (editing && editing !== 'new') setEditing(null)
      return
    }
    if (transactions.length === 0) {
      setEditing(null)
      return
    }
    const entry = groupEntries(transactions).find((e) =>
      e.kind === 'single' ? e.transaction.id === detailId : e.lines.some((line) => line.id === detailId)
    )
    if (entry) openEdit(entry)
    else setEditing(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transactions, detailId])

  function setFilters(update) {
    const current = filters
    const next = typeof update === 'function' ? update(current) : update
    setRouteFilters({
      search: next.search,
      category: next.category,
      owner: next.owner,
      accountId: next.accountId,
      dateFrom: next.dateFrom,
      dateTo: next.dateTo,
      sort: next.sort,
      needsReview: next.needsReview,
      unreviewed: next.unreviewed,
    })
  }

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
      if (selectedEntries.some((entry) => entry.kind !== 'single')) {
        setError('Grouped, split, and transfer facts cannot be bulk-corrected as ordinary expenses.')
        return
      }
      const singles = selectedEntries.filter((e) => e.kind === 'single')
      await Promise.all(singles.map((e) => correctTransaction(e.transaction.id, ordinaryTransactionFields(e.transaction, { category }))))
      setSelectedIds(new Set())
      await refresh()
    } finally {
      setBulkBusy(false)
    }
  }

  async function bulkSetOwner(owner) {
    setBulkBusy(true)
    try {
      if (selectedEntries.some((entry) => entry.kind !== 'single')) {
        setError('Grouped, split, and transfer facts cannot be bulk-corrected as ordinary expenses.')
        return
      }
      const singles = selectedEntries.filter((e) => e.kind === 'single')
      await Promise.all(singles.map((e) => correctTransaction(e.transaction.id, ordinaryTransactionFields(e.transaction, { owner }))))
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

  const goalLabel = useMemo(() => {
    const map = new Map(goals.map((g) => [g.id, `${g.icon ? `${g.icon} ` : ''}${g.name}`]))
    return (id) => map.get(id) ?? null
  }, [goals])

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
      setNotice('Transfers cannot be corrected in the expense editor. Transfer integrity is handled separately.')
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

  function openEntry(entry) {
    const id = entry.kind === 'single' ? entry.transaction.id : entry.lines[0]?.id
    if (id && onOpenDetail?.('transaction', id)) return
    openEdit(entry)
  }

  function closeEdit(options) {
    if (detailId) {
      if (onCloseDetail?.(options)) setEditing(null)
      return
    }
    setEditing(null)
  }

  async function handleSave(result) {
    const isEditingExisting = editing && editing !== 'new'

    // Every branch below is now a single call. The old shape deleted the
    // existing rows and *then* inserted their replacement, so a failure
    // between the two destroyed the transaction and left nothing behind
    // (DATA-02). replace_category_split does both inside one database
    // transaction.
    if (result.split) {
      if (!canEditExistingActivitySplit(editing)) {
        const unavailable = new Error('New split entry is temporarily unavailable. Save one category for now.')
        unavailable.field = 'general'
        throw unavailable
      }
      await replaceCategorySplit(result.baseFields, result.splitLines, {
        groupId: editing.transaction_group_id,
      })
    } else if (isEditingExisting && editing.splitGroup) {
      // Split collapsing back to one row: same all-or-nothing guarantee, with
      // a single line.
      await replaceCategorySplit(result.fields, [{ category: result.fields.category, amount: result.fields.amount }], {
        groupId: editing.transaction_group_id,
      })
    } else if (isEditingExisting) {
      await correctTransaction(editing.id, result.fields)
    } else {
      await createTransaction(result.fields, result.requestKey)
    }

    closeEdit({ force: true })
    const followUpFailures = await runCommittedTransactionFollowUps({
      rule: result.rule,
      createRule,
      refresh,
    })
    setNotice(followUpFailures.join(' '))
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
    const transaction = transactions.find((item) => item.id === id)
    if (!transaction) throw new Error('Transaction no longer available.')
    await correctTransaction(id, ordinaryTransactionFields(transaction, { category: category || null }))
    await refresh()
  }

  async function handleDelete() {
    let deletedRows
    if (editing.splitGroup) {
      deletedRows = await deleteTransactionGroup(editing.transaction_group_id)
    } else {
      deletedRows = [await deleteTransaction(editing.id)]
    }
    setUndoIds(deletedRows.map((row) => row.id))
    setNotice('Transaction deleted.')
    closeEdit({ force: true })
    if (!(await refresh())) {
      setNotice('Transaction deleted. Activity could not refresh, but Undo is still available.')
    }
  }

  async function handleUndoDelete() {
    const restoring = undoIds
    if (restoring.length === 0) return
    await restoreTransactions(restoring)
    setUndoIds([])
    setNotice('Transaction restored.')
    if (!(await refresh())) {
      setNotice('Transaction restored. Activity could not refresh yet.')
    }
  }

  if (loading) {
    return detailId
      ? <DetailShell title="Transaction details" backLabel="Activity" loading onRequestClose={() => closeEdit()} />
      : <LoadingState label="Loading…" />
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-end gap-2">
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

      {notice && (
        <div role="status" className="mb-4 flex min-h-11 items-center justify-between gap-3 rounded-lg bg-brand-50 px-4 py-2 text-sm text-brand-800">
          <span>{notice}</span>
          <div className="flex shrink-0 gap-2">
            {undoIds.length > 0 && <button type="button" className="min-h-11 font-semibold underline" onClick={handleUndoDelete}>Undo</button>}
            <button type="button" className="min-h-11 text-xs underline" onClick={() => setNotice('')}>Dismiss</button>
          </div>
        </div>
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
        <div className="mb-4"><ErrorState title={error} /></div>
      )}

      <div className="grid gap-5 lg:grid-cols-[1fr_260px]">
        <div>
          <Filters filters={filters} setFilters={setFilters} categories={categories} accounts={accounts} />

          <TransactionList
            transactions={ordered}
            accountName={accountName}
            goalLabel={goalLabel}
            flat={flat}
            onEntryClick={selectMode ? (entry) => toggleSelect(entryKey(entry)) : openEntry}
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

      {detailId ? (
        <DetailShell
          title="Transaction details"
          backLabel="Activity"
          error={error}
          unavailable={!editing}
          onRequestClose={() => closeEdit()}
        >
          {editing ? <TransactionForm
            embedded
            transaction={editing}
            accounts={accounts}
            categories={categories}
            goals={goals}
            rules={rules}
            onSave={handleSave}
            onCancel={() => closeEdit()}
            onDelete={handleDelete}
            onCreateRule={handleCreateRule}
            allowSplit={canEditExistingActivitySplit(editing)}
          /> : null}
        </DetailShell>
      ) : editing && (
        <TransactionForm
          transaction={editing === 'new' ? null : editing}
          accounts={accounts}
          categories={categories}
          goals={goals}
          rules={rules}
          onSave={handleSave}
          onCancel={() => closeEdit()}
          onDelete={handleDelete}
          onCreateRule={handleCreateRule}
          allowSplit={canEditExistingActivitySplit(editing)}
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
