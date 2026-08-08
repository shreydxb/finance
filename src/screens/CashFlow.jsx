import { useEffect, useMemo, useState } from 'react'
import { listTransactions } from '../lib/transactions'
import { listIncome } from '../lib/income'
import { listCategories } from '../lib/categories'
import { getSetting, toAED } from '../lib/settings'
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
import BreakdownBars from '../components/BreakdownBars'

function formatAED(n) {
  const sign = n < 0 ? '-' : ''
  const abs = Math.abs(n)
  return `AED ${sign}${abs.toLocaleString('en-AE', { maximumFractionDigits: 0 })}`
}

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

export default function CashFlow() {
  const [mode, setMode] = useState('month')
  const [monthCursor, setMonthCursor] = useState(currentYearMonth())
  const [quarterCursor, setQuarterCursor] = useState(currentQuarter())
  const [yearCursor, setYearCursor] = useState(new Date().getFullYear())
  const [breakdownView, setBreakdownView] = useState('category')
  const [groupingMode, setGroupingMode] = useState('category') // category | group | merchant
  const [subView, setSubView] = useState('breakdown') // breakdown | trends

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
      setError('Could not load cash flow. Check your connection and try again.')
    } finally {
      setLoading(false)
    }
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    refresh()
  }, [from, to])

  useEffect(() => {
    if (subView !== 'trends') return
    setTrendLoading(true)
    const trendFrom = new Date(cursor.year ?? new Date(to).getFullYear(), (cursor.month ?? 12) - TREND_MONTHS, 1)
    const fromStr = `${trendFrom.getFullYear()}-${String(trendFrom.getMonth() + 1).padStart(2, '0')}-01`
    listTransactions({ dateFrom: fromStr, dateTo: to })
      .then(setTrendTransactions)
      .catch(() => setTrendTransactions([]))
      .finally(() => setTrendLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subView, to])

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

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
      <div className="mb-6 flex items-center justify-between rounded-2xl border border-ink-200 bg-white shadow-card px-4 py-3">
        <button type="button" onClick={() => shift(-1)} className="rounded-lg px-3 py-1.5 text-sm font-medium text-ink-600 hover:bg-ink-100">
          ← Prev
        </button>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg bg-ink-100 p-0.5 text-xs">
            {['month', 'quarter', 'year'].map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={`rounded-md px-2 py-1 font-medium capitalize transition-colors ${mode === m ? 'bg-white text-ink-900 shadow-card' : 'text-ink-500 hover:text-ink-900'}`}
              >
                {m}
              </button>
            ))}
          </div>
          <span className="text-sm font-semibold text-ink-900">{label}</span>
        </div>
        <button type="button" onClick={() => shift(1)} className="rounded-lg px-3 py-1.5 text-sm font-medium text-ink-600 hover:bg-ink-100">
          Next →
        </button>
      </div>

      {error && (
        <p role="alert" className="mb-4 rounded-lg bg-neg-50 px-4 py-3 text-sm text-neg-600">
          {error}
        </p>
      )}

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Income" value={formatAED(totalIncome)} />
        <StatCard label="Expenses" value={formatAED(totalExpenses)} />
        <StatCard label="Savings" value={formatAED(savings)} tone={savings < 0 ? 'bad' : 'good'} />
        <StatCard label="Savings rate" value={savingsRate === null ? '—' : `${savingsRate.toFixed(0)}%`} tone={savingsRate !== null && savingsRate < 0 ? 'bad' : 'good'} />
      </div>

      <div className="mb-4">
        <div className="mb-2 flex rounded-lg bg-ink-100 p-0.5 text-xs w-fit">
          <button
            type="button"
            onClick={() => setBreakdownView('category')}
            className={`rounded-md px-2.5 py-1 font-medium transition-colors ${breakdownView === 'category' ? 'bg-white text-ink-900 shadow-card' : 'text-ink-500 hover:text-ink-900'}`}
          >
            By category
          </button>
          <button
            type="button"
            onClick={() => setBreakdownView('person')}
            className={`rounded-md px-2.5 py-1 font-medium transition-colors ${breakdownView === 'person' ? 'bg-white text-ink-900 shadow-card' : 'text-ink-500 hover:text-ink-900'}`}
          >
            By person
          </button>
        </div>

        {breakdownView === 'category' ? (
          <>
            <div className="mb-3 flex items-center justify-between">
              <div className="flex rounded-lg bg-ink-100 p-0.5 text-xs w-fit">
                {['breakdown', 'trends'].map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setSubView(v)}
                    className={`rounded-md px-2.5 py-1 font-medium capitalize transition-colors ${subView === v ? 'bg-white text-ink-900 shadow-card' : 'text-ink-500 hover:text-ink-900'}`}
                  >
                    {v}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={downloadCSV}
                className="rounded-lg border border-ink-300 px-2.5 py-1 text-xs font-medium text-ink-600 hover:bg-ink-50"
              >
                Download CSV
              </button>
            </div>

            {subView === 'breakdown' ? (
              <BreakdownBars
                title="Expenses"
                groups={catGroups}
                formatValue={formatAED}
                emptyMessage="No expenses logged for this period."
                tabs={[
                  { key: 'category', label: 'Category' },
                  { key: 'group', label: 'Group' },
                  { key: 'merchant', label: 'Merchant' },
                ]}
                activeTab={groupingMode}
                onTabChange={setGroupingMode}
              />
            ) : trendLoading ? (
              <div className="rounded-2xl border border-ink-200 bg-white shadow-card p-5">
                <p className="py-6 text-center text-sm text-ink-500">Loading trend…</p>
              </div>
            ) : (
              <BreakdownBars
                title={`Spend, last ${TREND_MONTHS} months`}
                groups={trendGroups}
                formatValue={formatAED}
                emptyMessage="No expenses logged in this window."
              />
            )}

            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <StatCard label="Transactions" value={String(stats.count)} />
              <StatCard label="Largest" value={formatAED(stats.largest)} />
              <StatCard label="Average" value={formatAED(stats.average)} />
              <StatCard
                label="First → Last"
                value={stats.first ? `${stats.first.slice(5)} → ${stats.last.slice(5)}` : '—'}
              />
            </div>
          </>
        ) : (
          <PersonBreakdown incomeByPerson={incomeByPerson} totalIncome={totalIncome} target={splitTarget} />
        )}
      </div>
    </div>
  )
}

function StatCard({ label, value, tone }) {
  const toneClass = tone === 'bad' ? 'text-neg-600' : tone === 'good' ? 'text-ink-900' : 'text-ink-900'
  return (
    <div className="rounded-2xl border border-ink-200 bg-white shadow-card p-4">
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
      <div className="rounded-2xl border border-ink-200 bg-white shadow-card p-5">
        <p className="py-6 text-center text-sm text-ink-500">No income logged for this period yet.</p>
      </div>
    )
  }

  return (
    <div className="rounded-2xl border border-ink-200 bg-white shadow-card p-5">
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
