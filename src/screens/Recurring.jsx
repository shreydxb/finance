import { useEffect, useState } from 'react'
import {
  listRecurring,
  createRecurring,
  updateRecurring,
  deleteRecurring,
  nextDueDate,
  daysUntil,
  occursInMonth,
  isBill,
  MONTH_NAMES,
} from '../lib/recurring'
import { listIncome, createIncome, updateIncome, deleteIncome, INCOME_KINDS } from '../lib/income'
import { listAccounts, OWNERS } from '../lib/accounts'
import RecurringForm from '../components/RecurringForm'
import IncomeForm from '../components/IncomeForm'
import { useRouteQueryState } from '../lib/useRouteQueryState'

const CURRENT_MONTH = new Date()
const ROUTE_DEFAULTS = {
  view: 'bills',
  layout: 'list',
  year: CURRENT_MONTH.getFullYear(),
  month: CURRENT_MONTH.getMonth() + 1,
  personFilter: '',
  kindFilter: '',
}
const ROUTE_SCHEMA = {
  view: 'type',
  layout: 'view',
  year: ['year', Number, String],
  month: ['month', Number, String],
  personFilter: 'owner',
  kindFilter: 'kind',
}

function formatMoney(amount, currency) {
  return `${currency} ${Number(amount).toLocaleString('en-AE', { maximumFractionDigits: 2 })}`
}

function formatDate(d) {
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

export default function Recurring({ routeQuery, onRouteQueryChange, detailId, onOpenDetail, onCloseDetail }) {
  const [routeState, setRouteState] = useRouteQueryState(ROUTE_DEFAULTS, ROUTE_SCHEMA, routeQuery, onRouteQueryChange)
  const { view, layout, personFilter, kindFilter } = routeState
  const calendarCursor = { year: routeState.year, month: routeState.month }
  const setView = (next) => setRouteState((state) => ({ ...state, view: next }))
  const setLayout = (next) => setRouteState((state) => ({ ...state, layout: next }))
  const setCalendarCursor = (update) => setRouteState((state) => {
    const current = { year: state.year, month: state.month }
    const next = typeof update === 'function' ? update(current) : update
    return { ...state, year: next.year, month: next.month }
  })
  const setPersonFilter = (next) => setRouteState((state) => ({ ...state, personFilter: next }))
  const setKindFilter = (next) => setRouteState((state) => ({ ...state, kindFilter: next }))
  const [entries, setEntries] = useState([])
  const [income, setIncome] = useState([])
  const [accounts, setAccounts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [editingEntry, setEditingEntry] = useState(null) // recurring row, or 'new'
  const [editingIncome, setEditingIncome] = useState(null)

  async function refresh() {
    setError('')
    try {
      const [rec, inc, accts] = await Promise.all([listRecurring(), listIncome(), listAccounts()])
      setEntries(rec)
      setIncome(inc)
      setAccounts(accts)
    } catch {
      setError('Could not load. Check your connection and try again.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    refresh()
  }, [])

  useEffect(() => {
    if (!detailId) {
      if (editingEntry && editingEntry !== 'new') setEditingEntry(null)
      return
    }
    if (entries.length === 0) return
    const entry = entries.find((item) => item.id === detailId)
    if (entry) {
      setEditingEntry(entry)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries, detailId])

  function openEntry(entry) {
    if (onOpenDetail?.('recurring', entry.id)) return
    setEditingEntry(entry)
  }

  function closeEntry(options) {
    if (detailId) {
      if (onCloseDetail?.(options)) setEditingEntry(null)
      return
    }
    setEditingEntry(null)
  }

  async function handleSaveEntry(values) {
    if (editingEntry && editingEntry !== 'new') {
      await updateRecurring(editingEntry.id, values)
    } else {
      await createRecurring(values)
    }
    closeEntry({ force: true })
    await refresh()
  }

  async function handleDeleteEntry() {
    await deleteRecurring(editingEntry.id)
    closeEntry({ force: true })
    await refresh()
  }

  async function handleSaveIncome(values) {
    if (editingIncome && editingIncome !== 'new') {
      await updateIncome(editingIncome.id, values)
    } else {
      await createIncome(values)
    }
    setEditingIncome(null)
    await refresh()
  }

  async function handleDeleteIncome() {
    await deleteIncome(editingIncome.id)
    setEditingIncome(null)
    await refresh()
  }

  if (loading) {
    return <div className="px-6 py-10 text-center text-sm text-ink-500">Loading…</div>
  }

  // "Bills & EMIs" means things you pay. Recurring income rows were mixed in
  // here, so salary appeared as an upcoming bill (UI-02). They keep their own
  // section below rather than disappearing, since this is the only screen that
  // can edit them.
  const bills = entries.filter(isBill)
  const recurringIncome = entries.filter((e) => !isBill(e))

  const withDue = bills
    .map((e) => ({ entry: e, due: nextDueDate(e) }))
    .filter((x) => x.due)
    .sort((a, b) => a.due - b.due)
  const withoutDue = bills.filter((e) => !nextDueDate(e))

  const filteredIncome = income.filter((i) => (!personFilter || i.person === personFilter) && (!kindFilter || i.kind === kindFilter))

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex rounded-lg bg-ink-100 p-0.5 text-xs">
          <button
            type="button"
            onClick={() => setView('bills')}
            className={`rounded-md px-3 py-1.5 font-medium transition-colors ${view === 'bills' ? 'bg-surface text-ink-900 shadow-card' : 'text-ink-500 hover:text-ink-900'}`}
          >
            Bills & EMIs
          </button>
          <button
            type="button"
            onClick={() => setView('income')}
            className={`rounded-md px-3 py-1.5 font-medium transition-colors ${view === 'income' ? 'bg-surface text-ink-900 shadow-card' : 'text-ink-500 hover:text-ink-900'}`}
          >
            Income log
          </button>
        </div>
        <button
          type="button"
          onClick={() => (view === 'bills' ? setEditingEntry('new') : setEditingIncome('new'))}
          className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-700"
        >
          + Add
        </button>
      </div>

      {error && (
        <p role="alert" className="mb-4 rounded-lg bg-neg-50 px-4 py-3 text-sm text-neg-600">
          {error}
        </p>
      )}

      {view === 'bills' ? (
        <>
          {bills.length === 0 && <p className="py-10 text-center text-sm text-ink-500">No recurring bills yet.</p>}

          {entries.length > 0 && (
            <div className="mb-4 flex rounded-lg bg-ink-100 p-0.5 text-xs w-fit">
              {['list', 'calendar'].map((l) => (
                <button
                  key={l}
                  type="button"
                  onClick={() => setLayout(l)}
                  className={`rounded-md px-2.5 py-1 font-medium capitalize transition-colors ${layout === l ? 'bg-surface text-ink-900 shadow-card' : 'text-ink-500 hover:text-ink-900'}`}
                >
                  {l}
                </button>
              ))}
            </div>
          )}

          {layout === 'calendar' && entries.length > 0 && (
            <CalendarView entries={bills} cursor={calendarCursor} setCursor={setCalendarCursor} onSelect={openEntry} />
          )}

          {layout === 'list' && withDue.length > 0 && (
            <div className="rounded-2xl border border-ink-200 bg-surface shadow-card">
              {withDue.map(({ entry, due }) => {
                const days = daysUntil(due)
                const dueSoon = days <= 7
                return (
                  <button
                    key={entry.id}
                    type="button"
                    onClick={() => openEntry(entry)}
                    className="flex w-full items-center justify-between border-b border-ink-100 px-4 py-3 text-left text-sm last:border-b-0 hover:bg-ink-50"
                  >
                    <span className="min-w-0">
                      <span className="flex items-center gap-2">
                        <span className="font-medium text-ink-900">{entry.name}</span>
                        {dueSoon && (
                          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-amber-700">
                            {days === 0 ? 'Due today' : `Due in ${days}d`}
                          </span>
                        )}
                        {entry.autopay && (
                          <span className="rounded-full bg-ink-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-ink-500">Autopay</span>
                        )}
                      </span>
                      <span className="block truncate text-xs text-ink-400">
                        {entry.owner} · {formatDate(due)} · {entry.kind}
                      </span>
                    </span>
                    <span className="shrink-0 pl-2 font-medium text-ink-700">{formatMoney(entry.amount, entry.currency)}</span>
                  </button>
                )
              })}
            </div>
          )}

          {layout === 'list' && withoutDue.length > 0 && (
            <div className="mt-6">
              <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink-500">No upcoming due date</h3>
              <div className="rounded-2xl border border-ink-200 bg-surface shadow-card">
                {withoutDue.map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    onClick={() => openEntry(entry)}
                    className="flex w-full items-center justify-between border-b border-ink-100 px-4 py-3 text-left text-sm last:border-b-0 hover:bg-ink-50"
                  >
                    <span className="min-w-0">
                      <span className="font-medium text-ink-900">{entry.name}</span>
                      <span className="block truncate text-xs text-ink-400">
                        {entry.owner} · {entry.kind}
                        {entry.months?.length > 0 ? ` · ${entry.months.map((m) => MONTH_NAMES[m - 1]).join('/')}` : ' · every month'}
                      </span>
                    </span>
                    <span className="shrink-0 pl-2 font-medium text-ink-700">{formatMoney(entry.amount, entry.currency)}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {editingEntry && (
            <RecurringForm
              entry={editingEntry === 'new' ? null : editingEntry}
              accounts={accounts}
              onSave={handleSaveEntry}
              onCancel={() => closeEntry()}
              onDelete={handleDeleteEntry}
            />
          )}
        </>
      ) : (
        <>
          {recurringIncome.length > 0 && (
            <div className="mb-6">
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-500">
                Scheduled income
              </h3>
              <p className="mb-2 text-xs text-ink-400">
                Salaries and allowances that repeat. Listed here rather than under Bills &amp; EMIs — they are money
                arriving, not an obligation to pay.
              </p>
              <div className="rounded-2xl border border-ink-200 bg-surface shadow-card">
                {recurringIncome.map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    onClick={() => openEntry(entry)}
                    className="flex w-full items-center justify-between border-b border-ink-100 px-4 py-3 text-left text-sm last:border-b-0 hover:bg-ink-50"
                  >
                    <span className="min-w-0">
                      <span className="block font-medium text-ink-900">{entry.name}</span>
                      <span className="block truncate text-xs text-ink-400">
                        {entry.owner}
                        {entry.day_of_month ? ` · day ${entry.day_of_month}` : ''}
                        {entry.months?.length > 0 ? ` · ${entry.months.map((m) => MONTH_NAMES[m - 1]).join('/')}` : ' · every month'}
                      </span>
                    </span>
                    <span className="tnum shrink-0 pl-2 font-medium text-pos-600">
                      {entry.currency} {Number(entry.amount).toLocaleString('en-AE')}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="mb-4 flex gap-2">
            <select
              value={personFilter}
              onChange={(e) => setPersonFilter(e.target.value)}
              className="rounded-lg border border-ink-300 px-2 py-2 text-sm transition focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/15"
            >
              <option value="">All people</option>
              {OWNERS.filter((o) => o !== 'Joint').map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
            <select
              value={kindFilter}
              onChange={(e) => setKindFilter(e.target.value)}
              className="rounded-lg border border-ink-300 px-2 py-2 text-sm transition focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/15"
            >
              <option value="">All kinds</option>
              {INCOME_KINDS.map((k) => (
                <option key={k} value={k}>
                  {k.replace('_', ' ')}
                </option>
              ))}
            </select>
          </div>

          {filteredIncome.length === 0 ? (
            <p className="py-10 text-center text-sm text-ink-500">No income logged yet.</p>
          ) : (
            <div className="rounded-2xl border border-ink-200 bg-surface shadow-card">
              {filteredIncome.map((i) => (
                <button
                  key={i.id}
                  type="button"
                  onClick={() => setEditingIncome(i)}
                  className="flex w-full items-center justify-between border-b border-ink-100 px-4 py-3 text-left text-sm last:border-b-0 hover:bg-ink-50"
                >
                  <span className="min-w-0">
                    <span className="font-medium text-ink-900">
                      {i.person} · {i.kind.replace('_', ' ')}
                    </span>
                    <span className="block truncate text-xs text-ink-400">
                      {formatDate(new Date(`${i.date}T00:00:00`))}
                      {i.source ? ` · ${i.source}` : ''}
                    </span>
                  </span>
                  <span className={`shrink-0 pl-2 font-medium ${Number(i.amount) < 0 ? 'text-neg-600' : 'text-ink-700'}`}>
                    {formatMoney(i.amount, i.currency)}
                  </span>
                </button>
              ))}
            </div>
          )}

          {editingIncome && (
            <IncomeForm
              income={editingIncome === 'new' ? null : editingIncome}
              onSave={handleSaveIncome}
              onCancel={() => setEditingIncome(null)}
              onDelete={handleDeleteIncome}
            />
          )}
        </>
      )}
    </div>
  )
}

function monthGridDays(year, month) {
  const firstWeekday = new Date(year, month - 1, 1).getDay()
  const daysInMonth = new Date(year, month, 0).getDate()
  const cells = []
  for (let i = 0; i < firstWeekday; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(d)
  return cells
}

function CalendarView({ entries, cursor, setCursor, onSelect }) {
  const byDay = new Map()
  for (const entry of entries) {
    // Was: months-only. An obligation past its end_date kept appearing in every
    // future month (UI-02). occursInMonth applies the same rules nextDueDate
    // has always used.
    if (!occursInMonth(entry, cursor.year, cursor.month)) continue
    const day = Math.min(entry.day_of_month, new Date(cursor.year, cursor.month, 0).getDate())
    if (!byDay.has(day)) byDay.set(day, [])
    byDay.get(day).push(entry)
  }

  const cells = monthGridDays(cursor.year, cursor.month)

  function shift(delta) {
    setCursor((c) => {
      const d = new Date(c.year, c.month - 1 + delta, 1)
      return { year: d.getFullYear(), month: d.getMonth() + 1 }
    })
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <button type="button" onClick={() => shift(-1)} className="rounded-lg px-2 py-1 text-sm font-medium text-ink-600 hover:bg-ink-100">
          ← Prev
        </button>
        <span className="text-sm font-semibold text-ink-900">{MONTH_NAMES_FULL[cursor.month - 1]} {cursor.year}</span>
        <button type="button" onClick={() => shift(1)} className="rounded-lg px-2 py-1 text-sm font-medium text-ink-600 hover:bg-ink-100">
          Next →
        </button>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-semibold uppercase text-ink-400">
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
          <div key={d}>{d}</div>
        ))}
      </div>
      <div className="mt-1 grid grid-cols-7 gap-1">
        {cells.map((day, i) => (
          <div
            key={i}
            className={`min-h-[4.5rem] rounded-lg border p-1 text-left ${day ? 'border-ink-200 bg-surface' : 'border-transparent'}`}
          >
            {day && (
              <>
                <span className="text-[11px] text-ink-400">{day}</span>
                <div className="mt-0.5 space-y-0.5">
                  {(byDay.get(day) || []).map((entry) => (
                    <button
                      key={entry.id}
                      type="button"
                      onClick={() => onSelect(entry)}
                      className="block w-full truncate rounded bg-ink-100 px-1 py-0.5 text-left text-[10px] font-medium text-ink-700 hover:bg-ink-200"
                      title={entry.name}
                    >
                      {entry.name}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

const MONTH_NAMES_FULL = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]
