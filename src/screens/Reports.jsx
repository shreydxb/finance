import { useEffect, useMemo, useState } from 'react'
import { listTransactions } from '../lib/transactions'
import { listIncome } from '../lib/income'
import { listCategories } from '../lib/categories'
import { getSetting } from '../lib/settings'
import { toAED } from '../lib/money'
import { sumByCategoryAED, sumByGroupAED, sumByMerchantAED, totalAED, transactionStats, monthlyTrend, transactionsToCSV } from '../lib/reports'
import {
  currentYearMonth,
  currentQuarter,
  monthRange,
  monthLabel,
  shiftMonth,
  quarterRange,
  quarterLabel,
  shiftQuarter,
  yearRange,
  shiftYear,
} from '../lib/period'
import { CHART_PALETTE, colorizeGroups } from '../lib/chartPalette'
import { usePrefs } from '../lib/PrefsContext'
import BreakdownBars from '../components/BreakdownBars'
import SankeyChart from '../components/SankeyChart'
import LineChart from '../components/LineChart'
import VerticalBarChart from '../components/VerticalBarChart'

function periodInfo(mode, cursor) {
  if (mode === 'quarter') {
    const { from, to } = quarterRange(cursor.year, cursor.quarter)
    return { from, to, label: quarterLabel(cursor.year, cursor.quarter) }
  }
  if (mode === 'year') {
    const { from, to } = yearRange(cursor.year)
    return { from, to, label: String(cursor.year) }
  }
  const { from, to } = monthRange(cursor.year, cursor.month)
  return { from, to, label: monthLabel(cursor.year, cursor.month) }
}

function groupsFromMap(map) {
  return colorizeGroups(Array.from(map.entries()).map(([key, value]) => ({ key, label: key, value })))
}

const TREND_MONTHS = 6

export default function Reports() {
  const { fmt } = usePrefs()
  const [section, setSection] = useState('cashflow') // cashflow | spending | income
  const [mode, setMode] = useState('month')
  const [monthCursor, setMonthCursor] = useState(currentYearMonth())
  const [quarterCursor, setQuarterCursor] = useState(currentQuarter())
  const [yearCursor, setYearCursor] = useState(new Date().getFullYear())
  const [groupingMode, setGroupingMode] = useState('category') // category | group | merchant
  const [subView, setSubView] = useState('breakdown') // breakdown | trends
  const [spendShape, setSpendShape] = useState('bars')
  const [incomeShape, setIncomeShape] = useState('donut')
  const [trendShape, setTrendShape] = useState('line') // line | bars
  const [cashFlowShape, setCashFlowShape] = useState('sankey') // sankey | bars
  const [sankeyGrouping, setSankeyGrouping] = useState('group') // group | category
  const [flowDetail, setFlowDetail] = useState(null) // { label, items: [...], total, kind: 'expense' | 'income' }

  const [transactions, setTransactions] = useState([])
  const [income, setIncome] = useState([])
  const [categories, setCategories] = useState([])
  const [fxRates, setFxRates] = useState({ AED: 1 })
  const [splitTarget, setSplitTarget] = useState({ shrey: 0.69, tarika: 0.31 })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [trendTransactions, setTrendTransactions] = useState([])
  const [trendLoading, setTrendLoading] = useState(false)

  const cursor = mode === 'month' ? monthCursor : mode === 'quarter' ? quarterCursor : yearCursor
  const { from, to, label } = periodInfo(mode, mode === 'year' ? { year: cursor } : cursor)

  async function refresh() {
    setError('')
    try {
      const [txns, inc, cats, fx, split] = await Promise.all([
        listTransactions({ dateFrom: from, dateTo: to }),
        listIncome({ dateFrom: from, dateTo: to }),
        listCategories(),
        getSetting('fx_rates'),
        getSetting('income_split'),
      ])
      setTransactions(txns)
      setIncome(inc)
      setCategories(cats)
      setFxRates(fx || { AED: 1 })
      if (split) setSplitTarget(split)
    } catch {
      setError('Could not load reports. Check your connection and try again.')
    } finally {
      setLoading(false)
    }
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    refresh()
  }, [from, to])

  useEffect(() => {
    if (section !== 'spending' || subView !== 'trends') return
    setTrendLoading(true)
    const trendFrom = new Date(cursor.year ?? new Date(to).getFullYear(), (cursor.month ?? 12) - TREND_MONTHS, 1)
    const fromStr = `${trendFrom.getFullYear()}-${String(trendFrom.getMonth() + 1).padStart(2, '0')}-01`
    listTransactions({ dateFrom: fromStr, dateTo: to })
      .then(setTrendTransactions)
      .catch(() => setTrendTransactions([]))
      .finally(() => setTrendLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section, subView, to])

  const totalIncome = useMemo(() => totalAED(income, fxRates), [income, fxRates])
  const totalExpenses = useMemo(() => totalAED(transactions, fxRates), [transactions, fxRates])
  const savings = totalIncome - totalExpenses
  const savingsRate = totalIncome > 0 ? (savings / totalIncome) * 100 : null

  const categoryGroupByName = useMemo(() => new Map(categories.map((c) => [c.name, c.group])), [categories])

  const catGroups = useMemo(() => {
    if (groupingMode === 'group') return groupsFromMap(sumByGroupAED(transactions, fxRates, categoryGroupByName))
    if (groupingMode === 'merchant') return groupsFromMap(sumByMerchantAED(transactions, fxRates))
    return groupsFromMap(sumByCategoryAED(transactions, fxRates))
  }, [transactions, fxRates, groupingMode, categoryGroupByName])

  // Defaults to category-group (Needs/Wants/Savings) — a Sankey with 8+
  // individual-category destinations can turn into a tangle — but Category
  // is one tap away via sankeyGrouping for whoever wants the finer read.
  const sankeyDestGroups = useMemo(
    () =>
      sankeyGrouping === 'category'
        ? groupsFromMap(sumByCategoryAED(transactions, fxRates))
        : groupsFromMap(sumByGroupAED(transactions, fxRates, categoryGroupByName)),
    [transactions, fxRates, categoryGroupByName, sankeyGrouping]
  )

  const stats = useMemo(() => transactionStats(transactions), [transactions])
  const trendGroups = useMemo(
    () => monthlyTrend(trendTransactions, fxRates, TREND_MONTHS, new Date(`${to}T00:00:00`)).map((b) => ({ key: b.key, label: b.label, value: b.value, color: CHART_PALETTE[0] })),
    [trendTransactions, fxRates, to]
  )

  const incomeByPerson = useMemo(() => {
    const map = new Map()
    for (const i of income) {
      map.set(i.person, (map.get(i.person) || 0) + toAED(Number(i.amount) || 0, i.currency, fxRates))
    }
    return map
  }, [income, fxRates])

  // `source` is the free-text label (e.g. "Emirates Salary"); `kind` is the
  // enum (salary/bonus/…). Source is the more useful axis, with kind as the
  // fallback when a row was logged without one.
  const incomeBySource = useMemo(() => {
    const map = new Map()
    for (const i of income) {
      const key = i.source?.trim() || i.kind || 'Other'
      map.set(key, (map.get(key) || 0) + toAED(Number(i.amount) || 0, i.currency, fxRates))
    }
    return groupsFromMap(map)
  }, [income, fxRates])

  // Sankey node click → the transactions/income rows behind that number,
  // matched the same way sumByCategoryAED/sumByGroupAED/incomeBySource
  // grouped them in the first place, so the total in the detail header
  // always ties back exactly to the node's own value.
  function openFlowDetail(kind, node) {
    if (kind === 'income') {
      const items = income.filter((i) => (i.source?.trim() || i.kind || 'Other') === node.key)
      setFlowDetail({ kind, label: node.label, total: node.value, items })
      return
    }
    const items = transactions.filter((t) => {
      if (t.category === 'Transfer') return false
      const key = sankeyGrouping === 'category' ? t.category || 'Uncategorised' : categoryGroupByName.get(t.category) || 'Uncategorised'
      return key === node.key
    })
    setFlowDetail({ kind, label: node.label, total: node.value, items })
  }

  function downloadCSV() {
    const csv = transactionsToCSV(transactions)
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `transactions_${from}_to_${to}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  function shift(delta) {
    if (mode === 'month') setMonthCursor((c) => shiftMonth(c.year, c.month, delta))
    else if (mode === 'quarter') setQuarterCursor((c) => shiftQuarter(c.year, c.quarter, delta))
    else setYearCursor((y) => shiftYear(y, delta))
  }

  if (loading) {
    return <div className="px-6 py-10 text-center text-sm text-ink-500">Loading…</div>
  }

  const SECTIONS = [
    { key: 'cashflow', label: 'Cash Flow' },
    { key: 'spending', label: 'Spending' },
    { key: 'income', label: 'Income' },
  ]

  return (
    <div className="stagger mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-semibold tracking-tight text-ink-900">Reports</h2>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => shift(-1)} aria-label="Previous period"
            className="rounded-lg border border-ink-300 px-2.5 py-1.5 text-sm font-medium text-ink-600 transition-colors hover:bg-ink-100">←</button>
          <div className="flex rounded-lg bg-ink-100 p-0.5 text-xs">
            {['month', 'quarter', 'year'].map((m) => (
              <button key={m} type="button" onClick={() => setMode(m)}
                className={`rounded-md px-2 py-1 font-medium capitalize transition-colors ${mode === m ? 'bg-surface text-ink-900 shadow-card' : 'text-ink-500 hover:text-ink-900'}`}>{m}</button>
            ))}
          </div>
          <span className="min-w-[7rem] text-center text-sm font-semibold text-ink-900">{label}</span>
          <button type="button" onClick={() => shift(1)} aria-label="Next period"
            className="rounded-lg border border-ink-300 px-2.5 py-1.5 text-sm font-medium text-ink-600 transition-colors hover:bg-ink-100">→</button>
        </div>
      </div>

      {/* Monarch's own Reports structure: one period selector, three lenses. */}
      <div className="mb-5 flex w-fit rounded-lg bg-ink-100 p-0.5 text-sm">
        {SECTIONS.map((s) => (
          <button key={s.key} type="button" onClick={() => setSection(s.key)}
            className={`rounded-md px-3.5 py-1.5 font-medium transition-colors ${section === s.key ? 'bg-surface text-ink-900 shadow-card' : 'text-ink-500 hover:text-ink-900'}`}>{s.label}</button>
        ))}
      </div>

      {error && (
        <p role="alert" className="mb-4 rounded-lg bg-neg-50 px-4 py-3 text-sm text-neg-600">{error}</p>
      )}

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Income" value={fmt(totalIncome)} />
        <StatCard label="Expenses" value={fmt(totalExpenses)} />
        <StatCard label="Savings" value={fmt(savings)} tone={savings < 0 ? 'bad' : 'good'} />
        <StatCard label="Savings rate" value={savingsRate === null ? '—' : `${savingsRate.toFixed(0)}%`}
          tone={savingsRate !== null && savingsRate < 0 ? 'bad' : 'good'} />
      </div>

      {section === 'cashflow' && (
        <div className="space-y-5">
          <div className="rounded-2xl border border-ink-200 bg-surface p-5 shadow-card">
            <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-ink-900">Where it came from, where it went</h3>
              <div className="flex items-center gap-2">
                {cashFlowShape === 'sankey' && (
                  <div className="flex rounded-lg bg-ink-100 p-0.5 text-xs">
                    {[
                      { key: 'group', label: 'Group' },
                      { key: 'category', label: 'Category' },
                    ].map((t) => (
                      <button key={t.key} type="button" onClick={() => setSankeyGrouping(t.key)}
                        className={`rounded-md px-2.5 py-1 font-medium transition-colors ${sankeyGrouping === t.key ? 'bg-surface text-ink-900 shadow-card' : 'text-ink-500 hover:text-ink-700'}`}>
                        {t.label}
                      </button>
                    ))}
                  </div>
                )}
                <div className="flex rounded-lg bg-ink-100 p-0.5 text-xs">
                  {[
                    { key: 'sankey', label: '⟿', aria: 'Sankey view' },
                    { key: 'bars', label: '▤', aria: 'Bar view' },
                  ].map((s) => (
                    <button key={s.key} type="button" onClick={() => setCashFlowShape(s.key)} aria-label={s.aria}
                      className={`rounded-md px-2 py-1 font-medium transition-colors ${cashFlowShape === s.key ? 'bg-surface text-ink-900 shadow-card' : 'text-ink-500 hover:text-ink-700'}`}>
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <p className="mb-4 text-xs text-ink-400">{label}{cashFlowShape === 'sankey' ? ' · click a node to see its transactions' : ''}</p>
            {totalIncome === 0 && totalExpenses === 0 ? (
              <p className="py-10 text-center text-sm text-ink-500">Nothing logged for {label} yet.</p>
            ) : cashFlowShape === 'sankey' ? (
              <SankeyChart
                sources={incomeBySource}
                destinations={sankeyDestGroups}
                hubLabel="Income"
                hubValue={totalIncome}
                formatValue={fmt}
                onSourceClick={(n) => openFlowDetail('income', n)}
                onDestClick={(n) => openFlowDetail('expense', n)}
              />
            ) : (
              <div className="grid gap-5 sm:grid-cols-2">
                <BreakdownBars title="Income" groups={incomeBySource} formatValue={fmt} emptyMessage="No income logged." />
                <BreakdownBars title="Expenses" groups={sankeyDestGroups} formatValue={fmt} emptyMessage="No expenses logged." />
              </div>
            )}
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            <div className="rounded-2xl border border-ink-200 bg-surface p-5 shadow-card">
              <h3 className="mb-4 text-sm font-semibold text-ink-900">In vs out</h3>
              <FlowBar label="Income" value={totalIncome} max={Math.max(totalIncome, totalExpenses, 1)} color="var(--color-pos-500)" fmt={fmt} />
              <FlowBar label="Expenses" value={totalExpenses} max={Math.max(totalIncome, totalExpenses, 1)} color="var(--color-neg-500)" fmt={fmt} />
              <div className="mt-4 border-t border-ink-100 pt-3">
                <FlowBar label="Savings" value={Math.max(0, savings)} max={Math.max(totalIncome, totalExpenses, 1)} color="var(--color-brand-500)" fmt={fmt} />
              </div>
            </div>
            <PersonBreakdown incomeByPerson={incomeByPerson} totalIncome={totalIncome} target={splitTarget} />
          </div>
        </div>
      )}

      {section === 'spending' && (
        <div>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="flex rounded-lg bg-ink-100 p-0.5 text-xs">
              {['breakdown', 'trends'].map((v) => (
                <button key={v} type="button" onClick={() => setSubView(v)}
                  className={`rounded-md px-2.5 py-1 font-medium capitalize transition-colors ${subView === v ? 'bg-surface text-ink-900 shadow-card' : 'text-ink-500 hover:text-ink-900'}`}>{v}</button>
              ))}
            </div>
            <button type="button" onClick={downloadCSV}
              className="rounded-lg border border-ink-300 px-2.5 py-1 text-xs font-medium text-ink-600 transition-colors hover:bg-ink-100">
              Download CSV
            </button>
          </div>

          {subView === 'breakdown' ? (
            <BreakdownBars title="Expenses" groups={catGroups} formatValue={fmt}
              emptyMessage="No expenses logged for this period."
              shape={spendShape} onShapeChange={setSpendShape}
              tabs={[
                { key: 'category', label: 'Category' },
                { key: 'group', label: 'Group' },
                { key: 'merchant', label: 'Merchant' },
              ]}
              activeTab={groupingMode} onTabChange={setGroupingMode} />
          ) : trendLoading ? (
            <div className="rounded-2xl border border-ink-200 bg-surface p-5 shadow-card">
              <p className="py-6 text-center text-sm text-ink-500">Loading trend…</p>
            </div>
          ) : (
            <div className="rounded-2xl border border-ink-200 bg-surface p-5 shadow-card">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-semibold text-ink-900">Spend, last {TREND_MONTHS} months</h2>
                <div className="flex rounded-lg bg-ink-100 p-0.5 text-xs">
                  {[
                    { key: 'line', label: '⟋', aria: 'Line view' },
                    { key: 'bars', label: '▤', aria: 'Bar view' },
                  ].map((s) => (
                    <button key={s.key} type="button" onClick={() => setTrendShape(s.key)} aria-label={s.aria}
                      className={`rounded-md px-2 py-1 font-medium transition-colors ${trendShape === s.key ? 'bg-surface text-ink-900 shadow-card' : 'text-ink-500 hover:text-ink-700'}`}>
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>
              {trendGroups.length === 0 ? (
                <p className="py-6 text-center text-sm text-ink-500">No expenses logged in this window.</p>
              ) : trendShape === 'line' ? (
                <LineChart points={trendGroups} formatValue={fmt} height={220} />
              ) : (
                <VerticalBarChart points={trendGroups} formatValue={fmt} height={220} />
              )}
            </div>
          )}

          <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="Transactions" value={String(stats.count)} />
            <StatCard label="Largest" value={fmt(stats.largest)} />
            <StatCard label="Average" value={fmt(stats.average)} />
            <StatCard label="First → Last" value={stats.first ? `${stats.first.slice(5)} → ${stats.last.slice(5)}` : '—'} />
          </div>
        </div>
      )}

      {section === 'income' && (
        <div className="grid gap-5 lg:grid-cols-2">
          <BreakdownBars title="Income by source" groups={incomeBySource} formatValue={fmt}
            emptyMessage="No income logged for this period."
            shape={incomeShape} onShapeChange={setIncomeShape} />
          <PersonBreakdown incomeByPerson={incomeByPerson} totalIncome={totalIncome} target={splitTarget} />
        </div>
      )}

      {flowDetail && (
        <FlowDetail detail={flowDetail} fxRates={fxRates} fmt={fmt} onClose={() => setFlowDetail(null)} />
      )}
    </div>
  )
}

function FlowDetail({ detail, fxRates, fmt, onClose }) {
  const { kind, label, total, items } = detail
  return (
    <div className="fixed inset-0 z-[100] flex items-end justify-center overflow-y-auto bg-black/40 p-0 sm:items-center sm:p-6">
      <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-surface p-6 shadow-xl sm:rounded-2xl">
        <div className="mb-1 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-ink-900">{label}</h2>
          <button type="button" onClick={onClose} className="text-sm text-ink-400 hover:text-ink-600">
            Close
          </button>
        </div>
        <p className="mb-4 text-xs text-ink-400">
          {items.length} {kind === 'income' ? (items.length === 1 ? 'entry' : 'entries') : items.length === 1 ? 'transaction' : 'transactions'} · {fmt(total)} total
        </p>
        {items.length === 0 ? (
          <p className="py-6 text-center text-sm text-ink-500">Nothing here for this period.</p>
        ) : (
          <ul className="divide-y divide-ink-100 rounded-2xl border border-ink-200">
            {items
              .slice()
              .sort((a, b) => (a.date < b.date ? 1 : -1))
              .map((item) => (
                <li key={item.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
                  <span className="min-w-0">
                    <span className="block text-ink-600">{item.date}</span>
                    <span className="block truncate text-xs text-ink-400">
                      {kind === 'income' ? item.person : [item.owner, item.note].filter(Boolean).join(' · ') || 'No note'}
                    </span>
                  </span>
                  <span className="tnum shrink-0 pl-2 font-medium text-ink-900">
                    {fmt(toAED(Number(item.amount) || 0, item.currency, fxRates))}
                  </span>
                </li>
              ))}
          </ul>
        )}
      </div>
    </div>
  )
}

/** Horizontal magnitude bar — the in/out comparison on the Cash Flow lens. */
function FlowBar({ label, value, max, color, fmt }) {
  return (
    <div className="mb-3 last:mb-0">
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="font-medium text-ink-700">{label}</span>
        <span className="tnum font-semibold text-ink-900">{fmt(value)}</span>
      </div>
      <div className="h-2.5 w-full overflow-hidden rounded-full bg-ink-100">
        <div className="h-full origin-left rounded-full"
          style={{ width: `${Math.min(100, (Math.abs(value) / max) * 100)}%`, backgroundColor: color, animation: 'grow .7s cubic-bezier(.16,1,.3,1) both' }} />
      </div>
    </div>
  )
}

function StatCard({ label, value, tone }) {
  const toneClass = tone === 'bad' ? 'text-neg-600' : tone === 'good' ? 'text-ink-900' : 'text-ink-900'
  return (
    <div className="rounded-2xl border border-ink-200 bg-surface shadow-card p-4">
      <p className="text-xs text-ink-500">{label}</p>
      <p className={`mt-1 text-lg font-semibold ${toneClass}`}>{value}</p>
    </div>
  )
}

function PersonBreakdown({ incomeByPerson, totalIncome, target }) {
  const people = [
    { key: 'Shrey', targetPct: (target?.shrey ?? 0.69) * 100 },
    { key: 'Tarika', targetPct: (target?.tarika ?? 0.31) * 100 },
  ]

  if (totalIncome <= 0) {
    return (
      <div className="rounded-2xl border border-ink-200 bg-surface shadow-card p-5">
        <p className="py-6 text-center text-sm text-ink-500">No income logged for this period yet.</p>
      </div>
    )
  }

  return (
    <div className="rounded-2xl border border-ink-200 bg-surface shadow-card p-5">
      <h2 className="mb-4 text-sm font-semibold text-ink-900">Contribution vs 69/31 target</h2>
      <div className="space-y-4">
        {people.map((p) => {
          const actual = incomeByPerson.get(p.key) || 0
          const actualPct = (actual / totalIncome) * 100
          const delta = actualPct - p.targetPct
          const flagged = Math.abs(delta) > 3
          return (
            <div key={p.key}>
              <div className="mb-1 flex items-center justify-between text-xs">
                <span className="font-medium text-ink-700">{p.key}</span>
                <span className="flex items-center gap-1.5 font-medium">
                  <span className="text-ink-900">{actualPct.toFixed(0)}%</span>
                  <span className="text-ink-400">target {p.targetPct.toFixed(0)}%</span>
                  {flagged && (
                    <span
                      className="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase"
                      style={{ color: delta > 0 ? '#0d6b0d' : '#9a5b00', backgroundColor: delta > 0 ? '#e3f6e3' : '#fef3d9' }}
                    >
                      {delta > 0 ? '▲ Over' : '▼ Under'}
                    </span>
                  )}
                </span>
              </div>
              <div className="relative h-3 w-full overflow-hidden rounded-full bg-ink-100">
                <div className="h-full rounded-full bg-ink-300" style={{ width: `${Math.min(100, p.targetPct)}%` }} />
                <div
                  className="absolute top-0 h-full w-0.5 bg-ink-900"
                  style={{ left: `${Math.min(100, actualPct)}%` }}
                  aria-hidden="true"
                />
              </div>
            </div>
          )
        })}
      </div>
      <p className="mt-3 text-xs text-ink-400">Bar shows the 69/31 target; the marker shows actual contribution this period.</p>
    </div>
  )
}
