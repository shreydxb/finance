export function formatDateHeading(dateStr) {
  const d = new Date(`${dateStr}T00:00:00`)
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
}

export function formatAmount(amount, currency) {
  return `${currency} ${Number(amount).toLocaleString('en-AE', { maximumFractionDigits: 2 })}`
}

export function groupByDate(transactions) {
  const byDate = new Map()
  for (const t of transactions) {
    if (!byDate.has(t.date)) byDate.set(t.date, [])
    byDate.get(t.date).push(t)
  }
  return Array.from(byDate.entries()).map(([date, items]) => ({ date, entries: groupBySplit(items) }))
}

export function groupBySplit(items) {
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

/** Grouped-by-date (or flat) transaction list, shared by Transactions.jsx and the account detail view. */
export function entryKey(entry) {
  return entry.kind === 'split' ? entry.splitGroupId : entry.transaction.id
}

export default function TransactionList({
  transactions,
  accountName,
  flat = false,
  onEntryClick,
  onMarkReviewed,
  emptyMessage,
  categories,
  onCategoryChange,
  selectable = false,
  selectedIds,
  onToggleSelect,
}) {
  const groups = flat ? [{ date: null, entries: groupBySplit(transactions) }] : groupByDate(transactions)

  if (groups.length === 0) {
    return <p className="py-10 text-center text-sm text-ink-500">{emptyMessage ?? 'No transactions match.'}</p>
  }

  return (
    <div className="space-y-6">
      {groups.map((g) => (
        <div key={g.date ?? 'flat'}>
          {g.date && (
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-500">{formatDateHeading(g.date)}</h3>
          )}
          <div className="rounded-2xl border border-ink-200 bg-surface shadow-card">
            {g.entries.map((entry) => (
              <EntryRow
                key={entryKey(entry)}
                entry={entry}
                accountName={accountName}
                showDate={flat}
                onClick={() => onEntryClick(entry)}
                onMarkReviewed={onMarkReviewed}
                categories={categories}
                onCategoryChange={onCategoryChange}
                selectable={selectable}
                selected={selectable && selectedIds?.has(entryKey(entry))}
                onToggleSelect={onToggleSelect}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

function CategorySelect({ transaction, categories, onCategoryChange }) {
  const grouped = ['Needs', 'Wants', 'Savings'].map((group) => ({
    group,
    items: categories.filter((c) => c.group === group),
  }))
  return (
    <select
      value={transaction.category || ''}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => onCategoryChange(transaction.id, e.target.value)}
      className="max-w-[9rem] truncate rounded-md border border-transparent bg-transparent py-0.5 pl-0 pr-1 text-sm font-medium text-ink-900 hover:border-ink-300 hover:bg-ink-50 focus:border-ink-400 focus:outline-none"
    >
      <option value="">Uncategorised</option>
      {grouped.map(({ group, items }) =>
        items.length > 0 ? (
          <optgroup key={group} label={group}>
            {items.map((c) => (
              <option key={c.id} value={c.name}>
                {c.icon} {c.name}
              </option>
            ))}
          </optgroup>
        ) : null
      )}
    </select>
  )
}

function SelectCheckbox({ selected, onToggle }) {
  return (
    <input
      type="checkbox"
      checked={Boolean(selected)}
      onClick={(e) => e.stopPropagation()}
      onChange={onToggle}
      className="ml-4 shrink-0"
      aria-label="Select transaction"
    />
  )
}

function EntryRow({
  entry,
  accountName,
  showDate,
  onClick,
  onMarkReviewed,
  categories,
  onCategoryChange,
  selectable,
  selected,
  onToggleSelect,
}) {
  if (entry.kind === 'single') {
    const t = entry.transaction
    const canInlineEdit = categories && onCategoryChange
    return (
      <div className="flex items-center border-b border-ink-100 last:border-b-0">
        {selectable && <SelectCheckbox selected={selected} onToggle={() => onToggleSelect(entryKey(entry))} />}
        <button
          type="button"
          onClick={onClick}
          className="flex min-w-0 flex-1 items-center justify-between px-4 py-3 text-left text-sm hover:bg-ink-50"
        >
          <span className="min-w-0">
            <span className="flex items-center gap-2">
              {canInlineEdit ? (
                <CategorySelect transaction={t} categories={categories} onCategoryChange={onCategoryChange} />
              ) : (
                <span className="font-medium text-ink-900">{t.category || 'Uncategorised'}</span>
              )}
              {t.source === 'telegram' && <span title="Logged from Telegram">📥</span>}
              {t.needs_review && (
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-amber-700">
                  Needs review
                </span>
              )}
            </span>
            <span className="block truncate text-xs text-ink-400">
              {showDate ? `${formatDateHeading(t.date)} · ` : ''}
              {t.owner} · {accountName(t.account_id)}
              {t.note ? ` · ${t.note}` : ''}
            </span>
          </span>
          <span className="shrink-0 pl-2 font-medium text-ink-700">{formatAmount(t.amount, t.currency)}</span>
        </button>
        {onMarkReviewed && t.needs_review && (
          <button
            type="button"
            onClick={() => onMarkReviewed(t.id)}
            className="mr-3 shrink-0 rounded-lg border border-ink-300 px-2 py-1 text-xs font-medium text-ink-600 hover:bg-ink-50"
          >
            Looks right
          </button>
        )}
      </div>
    )
  }

  const total = entry.lines.reduce((sum, l) => sum + Number(l.amount), 0)
  const first = entry.lines[0]
  return (
    <div className="flex items-center border-b border-ink-100 last:border-b-0">
      {selectable && <SelectCheckbox selected={selected} onToggle={() => onToggleSelect(entryKey(entry))} />}
      <button type="button" onClick={onClick} className="block min-w-0 flex-1 px-4 py-3 text-left text-sm hover:bg-ink-50">
        <span className="flex items-center justify-between">
          <span className="flex items-center gap-2">
            <span className="font-medium text-ink-900">Split</span>
            <span className="rounded-full bg-ink-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-ink-500">
              {entry.lines.length} categories
            </span>
          </span>
          <span className="font-medium text-ink-700">{formatAmount(total, first.currency)}</span>
        </span>
        <span className="mt-1 block text-xs text-ink-400">
          {showDate ? `${formatDateHeading(first.date)} · ` : ''}
          {entry.lines.map((l) => l.category).join(', ')} · {first.owner} · {accountName(first.account_id)}
        </span>
      </button>
    </div>
  )
}
