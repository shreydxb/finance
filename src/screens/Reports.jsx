import { useEffect, useMemo, useState } from 'react'
import { listTransactions } from '../lib/transactions'
import { listCategories } from '../lib/categories'
import { getSetting } from '../lib/settings'
import { transactionsToCSV } from '../lib/reports'
import {
  currentQuarter,
  currentYearMonth,
  monthLabel,
  monthRange,
  quarterLabel,
  quarterRange,
  shiftMonth,
  shiftQuarter,
  shiftYear,
  yearRange,
} from '../lib/period'
import {
  getCanonicalPeriodMetrics,
  getCanonicalPeriodSeries,
  listCanonicalLedgerRows,
  loadCanonicalReportPeriod,
} from '../lib/canonicalMetrics'
import {
  buildSankeyModel,
  canonicalHeadline,
  canonicalTrendPoints,
  categoryConsumptionGroups,
  consumptionStats,
  groupedCategoryConsumption,
  incomeGroups,
  ledgerConsumptionGroups,
  qualityCopy,
  savingsRateCopy,
} from '../lib/canonicalPresentation'
import { usePrefs } from '../lib/PrefsContext'
import BreakdownBars from '../components/BreakdownBars'
import SankeyChart from '../components/SankeyChart'
import LineChart from '../components/LineChart'
import VerticalBarChart from '../components/VerticalBarChart'
import ComparisonChart from '../components/ComparisonChart'
import CanonicalQualityIndicator from '../components/CanonicalQualityIndicator'
import { useRealtimeRefresh } from '../lib/useRealtime'
import { REALTIME_TABLES } from '../lib/realtime'
import {
  COMPARISON_OPTIONS,
  averageMonthRanges,
  buildComparisonSeries,
  resolveComparisonPeriod,
} from '../lib/spendingComparison'
import { useRouteQueryState } from '../lib/useRouteQueryState'

const TREND_MONTHS = 6
const INITIAL_MONTH = currentYearMonth()
const INITIAL_QUARTER = currentQuarter()
const ROUTE_DEFAULTS = {
  section: 'cashflow',
  mode: 'month',
  year: INITIAL_MONTH.year,
  month: INITIAL_MONTH.month,
  quarter: INITIAL_QUARTER.quarter,
  groupingMode: 'category',
  subView: 'breakdown',
  sankeyGrouping: 'group',
  comparisonKey: 'month_average',
}
const ROUTE_SCHEMA = {
  section: 'section', mode: 'period', year: ['year', Number, String], month: ['month', Number, String],
  quarter: ['quarter', Number, String], groupingMode: 'group', subView: 'view',
  sankeyGrouping: 'flowGroup', comparisonKey: 'comparison',
}

function periodInfo(mode, cursor) {
  if (mode === 'quarter') {
    const range = quarterRange(cursor.year, cursor.quarter)
    return { ...range, label: quarterLabel(cursor.year, cursor.quarter) }
  }
  if (mode === 'year') return { ...yearRange(cursor.year), label: String(cursor.year) }
  return { ...monthRange(cursor.year, cursor.month), label: monthLabel(cursor.year, cursor.month) }
}

function trendPeriods(to) {
  const [year, month] = to.split('-').map(Number)
  const periods = []
  for (let offset = TREND_MONTHS - 1; offset >= 0; offset -= 1) {
    const cursor = shiftMonth(year, month, -offset)
    periods.push({ ...monthRange(cursor.year, cursor.month), label: monthLabel(cursor.year, cursor.month).slice(0, 3) })
  }
  return periods
}

const emptyComparison = { points: [], currentLabel: '', comparisonLabel: '', quality: 'incomplete' }
const displayMoney = (value, fmt) => (value === null ? '—' : fmt(value))

export default function Reports({ routeQuery, onRouteQueryChange }) {
  const { fmt } = usePrefs()
  const [routeState, setRouteState] = useRouteQueryState(ROUTE_DEFAULTS, ROUTE_SCHEMA, routeQuery, onRouteQueryChange)
  const { section, mode, groupingMode, subView, sankeyGrouping, comparisonKey } = routeState
  const monthCursor = { year: routeState.year, month: routeState.month }
  const quarterCursor = { year: routeState.year, quarter: routeState.quarter }
  const yearCursor = routeState.year
  const setSection = (value) => setRouteState((state) => ({ ...state, section: value }))
  const setMode = (value) => setRouteState((state) => ({ ...state, mode: value }))
  const setMonthCursor = (update) => setRouteState((state) => {
    const current = { year: state.year, month: state.month }
    const next = typeof update === 'function' ? update(current) : update
    return { ...state, year: next.year, month: next.month }
  })
  const setQuarterCursor = (update) => setRouteState((state) => {
    const current = { year: state.year, quarter: state.quarter }
    const next = typeof update === 'function' ? update(current) : update
    return { ...state, year: next.year, quarter: next.quarter }
  })
  const setYearCursor = (update) => setRouteState((state) => ({
    ...state,
    year: typeof update === 'function' ? update(state.year) : update,
  }))
  const setGroupingMode = (value) => setRouteState((state) => ({ ...state, groupingMode: value }))
  const setSubView = (value) => setRouteState((state) => ({ ...state, subView: value }))
  const [spendShape, setSpendShape] = useState('bars')
  const [incomeShape, setIncomeShape] = useState('donut')
  const [trendShape, setTrendShape] = useState('line')
  const [cashFlowShape, setCashFlowShape] = useState('sankey')
  const setSankeyGrouping = (value) => setRouteState((state) => ({ ...state, sankeyGrouping: value }))
  const [flowDetail, setFlowDetail] = useState(null)
  const [data, setData] = useState(null)
  const [categories, setCategories] = useState([])
  const [splitTarget, setSplitTarget] = useState({ shrey: 0.69, tarika: 0.31 })
  const [csvTransactions, setCsvTransactions] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [trendData, setTrendData] = useState([])
  const [trendLoading, setTrendLoading] = useState(false)
  const setComparisonKey = (value) => setRouteState((state) => ({ ...state, comparisonKey: value }))
  const [comparisonSeries, setComparisonSeries] = useState(emptyComparison)
  const [comparisonLoading, setComparisonLoading] = useState(false)

  const cursor = mode === 'month' ? monthCursor : mode === 'quarter' ? quarterCursor : { year: yearCursor }
  const { from, to, label } = periodInfo(mode, cursor)

  async function refresh() {
    setError('')
    try {
      const [report, cats, split, rawTransactions] = await Promise.all([
        loadCanonicalReportPeriod({ from, to }),
        listCategories(),
        getSetting('income_split'),
        listTransactions({ dateFrom: from, dateTo: to }),
      ])
      setData(report)
      setCategories(cats)
      setCsvTransactions(rawTransactions)
      if (split) setSplitTarget(split)
    } catch {
      setData(null)
      setError('Could not load canonical reports. Check your connection and try again.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    setLoading(true)
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to])

  // Realtime payloads only invalidate this data. Totals always come back from
  // the canonical database contracts after a full refetch.
  useRealtimeRefresh(REALTIME_TABLES.reports, refresh)

  useEffect(() => {
    if (section !== 'spending' || subView !== 'trends') return
    const periods = trendPeriods(to)
    setTrendLoading(true)
    getCanonicalPeriodSeries(periods)
      .then((metrics) => setTrendData(canonicalTrendPoints(metrics, periods.map((period) => period.label))))
      .catch(() => setTrendData([]))
      .finally(() => setTrendLoading(false))
  }, [section, subView, to])

  const comparisonResolved = useMemo(() => resolveComparisonPeriod(comparisonKey), [comparisonKey])

  useEffect(() => {
    if (section !== 'spending' || subView !== 'compare') return
    let cancelled = false
    setComparisonLoading(true)
    const ranges = comparisonResolved.averageWindow
      ? averageMonthRanges(comparisonResolved.averageWindow)
      : comparisonResolved.comparison ? [comparisonResolved.comparison] : []
    Promise.all([
      listCanonicalLedgerRows({ from: comparisonResolved.fetchFrom, to: comparisonResolved.current.to }),
      getCanonicalPeriodMetrics(comparisonResolved.current),
      getCanonicalPeriodSeries(ranges),
    ])
      .then(([rows, currentMetrics, otherMetrics]) => {
        if (cancelled) return
        setComparisonSeries(buildComparisonSeries({
          rows,
          currentMetrics,
          comparisonMetrics: comparisonResolved.comparison ? otherMetrics[0] : null,
          averageMetrics: comparisonResolved.averageWindow ? otherMetrics : [],
        }, comparisonResolved))
      })
      .catch(() => { if (!cancelled) setComparisonSeries(emptyComparison) })
      .finally(() => { if (!cancelled) setComparisonLoading(false) })
    return () => { cancelled = true }
  }, [section, subView, comparisonResolved])

  const headline = useMemo(() => data ? canonicalHeadline(data.metrics) : null, [data])
  const categoryGroupByName = useMemo(() => new Map(categories.map((category) => [category.name, category.group])), [categories])
  const categoryBreakdown = useMemo(() => {
    if (!data || !headline) return { groups: [], reconciles: false }
    if (groupingMode === 'group') return groupedCategoryConsumption(data.budgetActuals, categoryGroupByName, headline.consumption)
    if (groupingMode === 'merchant') return ledgerConsumptionGroups(data.ledgerRows, 'merchant', headline.consumption)
    return categoryConsumptionGroups(data.budgetActuals, headline.consumption)
  }, [data, headline, groupingMode, categoryGroupByName])
  const sankeyConsumption = useMemo(() => {
    if (!data || !headline) return { groups: [], reconciles: false }
    return sankeyGrouping === 'category'
      ? categoryConsumptionGroups(data.budgetActuals, headline.consumption)
      : groupedCategoryConsumption(data.budgetActuals, categoryGroupByName, headline.consumption)
  }, [data, headline, sankeyGrouping, categoryGroupByName])
  const sourceBreakdown = useMemo(() => data && headline ? incomeGroups(data.incomeRows, 'source', headline.income) : { groups: [] }, [data, headline])
  const personBreakdown = useMemo(() => data && headline ? incomeGroups(data.incomeRows, 'person', headline.income) : { groups: [] }, [data, headline])
  const stats = useMemo(() => data && headline ? consumptionStats(data.ledgerRows, headline.consumption) : null, [data, headline])
  const sankey = useMemo(() => data && headline ? buildSankeyModel({
    metrics: data.metrics,
    sources: sourceBreakdown.groups,
    consumption: sankeyConsumption.groups,
  }) : { canRender: false, reason: 'Canonical flows are unavailable.', sources: [], destinations: [] }, [data, headline, sourceBreakdown, sankeyConsumption])

  const comparisonCurrentTotal = [...comparisonSeries.points].reverse().find((point) => point.current !== null)?.current ?? null
  const trendUnavailable = trendData.some((point) => point.value === null)

  function openFlowDetail(kind, node) {
    if (kind === 'income') {
      const items = data.incomeRows.filter((row) => (row.source?.trim() || row.kind || 'Other') === node.key)
      setFlowDetail({ kind, label: node.label, total: node.value, items })
      return
    }
    if (node.key.startsWith('__')) return
    const items = data.ledgerRows.filter((row) => {
      if (row.economic_classification !== 'consumption_spend') return false
      const key = sankeyGrouping === 'category'
        ? row.category || 'Uncategorised'
        : categoryGroupByName.get(row.category) || 'Uncategorised'
      return key === node.key
    })
    setFlowDetail({ kind, label: node.label, total: node.value, items })
  }

  function downloadCSV() {
    const blob = new Blob([transactionsToCSV(csvTransactions)], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `transactions_${from}_to_${to}.csv`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  function shift(delta) {
    if (mode === 'month') setMonthCursor((value) => shiftMonth(value.year, value.month, delta))
    else if (mode === 'quarter') setQuarterCursor((value) => shiftQuarter(value.year, value.quarter, delta))
    else setYearCursor((value) => shiftYear(value, delta))
  }

  if (loading) return <div className="px-6 py-10 text-center text-sm text-ink-500">Loading…</div>

  if (!data || !headline || !stats) {
    return <div><p role="alert" className="rounded-lg bg-neg-50 px-4 py-3 text-sm text-neg-600">{error}</p></div>
  }

  const sections = [
    { key: 'cashflow', label: 'Cash Flow' },
    { key: 'spending', label: 'Consumption' },
    { key: 'income', label: 'Income' },
  ]
  const maxFlow = Math.max(1, ...[headline.income, headline.consumption, headline.savingsMovement, headline.cashRetained, headline.cashFlow].filter((value) => value !== null).map(Math.abs))

  return (
    <div className="stagger">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <CanonicalQualityIndicator metrics={data.metrics} />
        </div>
        <div className="grid w-full grid-cols-[2.75rem_1fr_2.75rem] items-center gap-2 sm:flex sm:w-auto">
          <button type="button" onClick={() => shift(-1)} aria-label="Previous period" className="rounded-lg border border-ink-300 px-2.5 py-1.5 text-sm font-medium text-ink-600 transition-colors hover:bg-ink-100">←</button>
          <span className="min-w-0 text-center text-sm font-semibold text-ink-900 sm:min-w-[7rem]">{label}</span>
          <button type="button" onClick={() => shift(1)} aria-label="Next period" className="rounded-lg border border-ink-300 px-2.5 py-1.5 text-sm font-medium text-ink-600 transition-colors hover:bg-ink-100">→</button>
          <div className="col-span-3 grid grid-cols-3 rounded-lg bg-ink-100 p-0.5 text-xs sm:flex">
            {['month', 'quarter', 'year'].map((value) => <button key={value} type="button" onClick={() => setMode(value)} className={`rounded-md px-2 py-1 font-medium capitalize transition-colors ${mode === value ? 'bg-surface text-ink-900 shadow-card' : 'text-ink-500 hover:text-ink-900'}`}>{value}</button>)}
          </div>
        </div>
      </div>

      <div className="mb-5 grid w-full grid-cols-3 rounded-lg bg-ink-100 p-0.5 text-sm sm:flex sm:w-fit">
        {sections.map((item) => <button key={item.key} type="button" onClick={() => setSection(item.key)} className={`rounded-md px-3.5 py-1.5 font-medium transition-colors ${section === item.key ? 'bg-surface text-ink-900 shadow-card' : 'text-ink-500 hover:text-ink-900'}`}>{item.label}</button>)}
      </div>

      {error && <p role="alert" className="mb-4 rounded-lg bg-neg-50 px-4 py-3 text-sm text-neg-600">{error}</p>}
      {data.metrics.quality_status !== 'complete' && <QualityMessage metrics={data.metrics} />}

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Posted income" value={displayMoney(headline.income, fmt)} />
        <StatCard label="Consumption" value={displayMoney(headline.consumption, fmt)} />
        <StatCard label="Savings" value={displayMoney(headline.savings, fmt)} tone={headline.savings !== null && headline.savings < 0 ? 'bad' : 'good'} />
        <StatCard label="Savings rate" value={headline.savingsRate === null ? '—' : `${headline.savingsRate.toFixed(0)}%`} hint={savingsRateCopy(headline)} tone={headline.savingsRate !== null && headline.savingsRate < 0 ? 'bad' : 'good'} />
      </div>

      {section === 'cashflow' && (
        <div className="space-y-5">
          <div className="rounded-2xl border border-ink-200 bg-surface p-5 shadow-card">
            <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-ink-900">Where it came from, where it went</h3>
              <div className="flex items-center gap-2">
                {cashFlowShape === 'sankey' && <div className="flex rounded-lg bg-ink-100 p-0.5 text-xs">{['group', 'category'].map((value) => <button key={value} type="button" onClick={() => setSankeyGrouping(value)} className={`rounded-md px-2.5 py-1 font-medium capitalize ${sankeyGrouping === value ? 'bg-surface text-ink-900 shadow-card' : 'text-ink-500'}`}>{value}</button>)}</div>}
                <div className="flex rounded-lg bg-ink-100 p-0.5 text-xs">{[{ key: 'sankey', label: '⟿', aria: 'Sankey view' }, { key: 'bars', label: '▤', aria: 'Bar view' }].map((shape) => <button key={shape.key} type="button" onClick={() => setCashFlowShape(shape.key)} aria-label={shape.aria} className={`rounded-md px-2 py-1 font-medium ${cashFlowShape === shape.key ? 'bg-surface text-ink-900 shadow-card' : 'text-ink-500'}`}>{shape.label}</button>)}</div>
              </div>
            </div>
            <p className="mb-4 text-xs text-ink-400">{label}{cashFlowShape === 'sankey' && sankey.canRender ? ' · click a node to see its canonical facts' : ''}</p>
            {cashFlowShape === 'sankey' && sankey.canRender ? (
              <SankeyChart sources={sankey.sources} destinations={sankey.destinations} hubLabel="Posted income" hubValue={headline.income} formatValue={fmt} onSourceClick={(node) => openFlowDetail('income', node)} onDestClick={(node) => openFlowDetail('consumption', node)} />
            ) : (
              <div>
                {cashFlowShape === 'sankey' && <p className="mb-4 rounded-lg bg-ink-50 px-3 py-2 text-xs text-ink-500">Sankey unavailable: {sankey.reason} Showing signed canonical flows instead.</p>}
                <CanonicalFlowBars headline={headline} max={maxFlow} fmt={fmt} />
              </div>
            )}
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            <div className="rounded-2xl border border-ink-200 bg-surface p-5 shadow-card">
              <h3 className="mb-4 text-sm font-semibold text-ink-900">In vs out</h3>
              <FlowBar label="Posted income" value={headline.income} max={maxFlow} color="var(--color-pos-500)" fmt={fmt} />
              <FlowBar label="Consumption" value={headline.consumption} max={maxFlow} color="var(--color-neg-500)" fmt={fmt} />
              <FlowBar label="Savings movement" value={headline.savingsMovement} max={maxFlow} color="var(--color-brand-500)" fmt={fmt} />
              <div className="mt-4 border-t border-ink-100 pt-3">
                <FlowBar label="Cash retained" value={headline.cashRetained} max={maxFlow} color="var(--color-ink-500)" fmt={fmt} />
                <FlowBar label="Cash flow" value={headline.cashFlow} max={maxFlow} color="var(--color-ink-700)" fmt={fmt} />
              </div>
            </div>
            <PersonBreakdown groups={personBreakdown.groups} totalIncome={headline.income} target={splitTarget} />
          </div>
        </div>
      )}

      {section === 'spending' && (
        <div>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="flex rounded-lg bg-ink-100 p-0.5 text-xs">{['breakdown', 'trends', 'compare'].map((value) => <button key={value} type="button" onClick={() => setSubView(value)} className={`rounded-md px-2.5 py-1 font-medium capitalize ${subView === value ? 'bg-surface text-ink-900 shadow-card' : 'text-ink-500'}`}>{value}</button>)}</div>
            <button type="button" onClick={downloadCSV} className="rounded-lg border border-ink-300 px-2.5 py-1 text-xs font-medium text-ink-600 transition-colors hover:bg-ink-100">Download CSV</button>
          </div>

          {subView === 'breakdown' && <BreakdownBars title="Consumption" groups={categoryBreakdown.groups} formatValue={fmt} emptyMessage={categoryBreakdown.reconciles ? 'No consumption logged for this period.' : 'Canonical consumption breakdown unavailable for this period.'} shape={spendShape} onShapeChange={setSpendShape} tabs={[{ key: 'category', label: 'Category' }, { key: 'group', label: 'Group' }, { key: 'merchant', label: 'Merchant' }]} activeTab={groupingMode} onTabChange={setGroupingMode} />}

          {subView === 'trends' && <div className="rounded-2xl border border-ink-200 bg-surface p-5 shadow-card">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2"><h2 className="text-sm font-semibold text-ink-900">Consumption, last {TREND_MONTHS} months</h2><div className="flex rounded-lg bg-ink-100 p-0.5 text-xs">{[{ key: 'line', label: '⟋', aria: 'Line view' }, { key: 'bars', label: '▤', aria: 'Bar view' }].map((shape) => <button key={shape.key} type="button" onClick={() => setTrendShape(shape.key)} aria-label={shape.aria} className={`rounded-md px-2 py-1 font-medium ${trendShape === shape.key ? 'bg-surface text-ink-900 shadow-card' : 'text-ink-500'}`}>{shape.label}</button>)}</div></div>
            {trendLoading ? <p className="py-6 text-center text-sm text-ink-500">Loading trend…</p> : trendUnavailable || trendData.length === 0 ? <p className="py-6 text-center text-sm text-ink-500">Canonical consumption trend unavailable because at least one period is incomplete.</p> : trendShape === 'line' ? <LineChart points={trendData} formatValue={fmt} height={220} /> : <VerticalBarChart points={trendData} formatValue={fmt} height={220} />}
          </div>}

          {subView === 'compare' && <div className="rounded-2xl border border-ink-200 bg-surface p-5 shadow-card">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2"><h2 className="text-sm font-semibold text-ink-900">Consumption {displayMoney(comparisonCurrentTotal, fmt)} {comparisonSeries.currentLabel.toLowerCase()}</h2><select value={comparisonKey} onChange={(event) => setComparisonKey(event.target.value)} className="rounded-lg border border-ink-300 bg-surface px-2.5 py-1.5 text-xs font-medium text-ink-700">{COMPARISON_OPTIONS.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}</select></div>
            {comparisonLoading ? <p className="py-6 text-center text-sm text-ink-500">Loading comparison…</p> : comparisonSeries.quality === 'incomplete' ? <p className="py-6 text-center text-sm text-ink-500">Canonical comparison unavailable because inputs are incomplete or do not reconcile.</p> : <ComparisonChart points={comparisonSeries.points} currentLabel={comparisonSeries.currentLabel} comparisonLabel={comparisonSeries.comparisonLabel} formatValue={fmt} height={240} />}
          </div>}

          <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="Consumption entries" value={String(stats.count)} />
            <StatCard label="Largest" value={displayMoney(stats.largest, fmt)} />
            <StatCard label="Average" value={displayMoney(stats.average, fmt)} />
            <StatCard label="First → Last" value={stats.first ? `${stats.first.slice(5)} → ${stats.last.slice(5)}` : '—'} />
          </div>
        </div>
      )}

      {section === 'income' && <div className="grid gap-5 lg:grid-cols-2"><BreakdownBars title="Posted income by source" groups={sourceBreakdown.groups} formatValue={fmt} emptyMessage={sourceBreakdown.reconciles ? 'No income logged for this period.' : 'Canonical income breakdown unavailable for this period.'} shape={incomeShape} onShapeChange={setIncomeShape} /><PersonBreakdown groups={personBreakdown.groups} totalIncome={headline.income} target={splitTarget} /></div>}
      {flowDetail && <FlowDetail detail={flowDetail} fmt={fmt} onClose={() => setFlowDetail(null)} />}
    </div>
  )
}

function QualityMessage({ metrics }) {
  const copy = qualityCopy(metrics)
  return <p className="mb-4 text-xs text-ink-500" role="status"><span className="font-semibold">{copy.label}:</span> {copy.detail}</p>
}

function CanonicalFlowBars({ headline, max, fmt }) {
  return <div className="grid gap-5 sm:grid-cols-2"><div><FlowBar label="Posted income" value={headline.income} max={max} color="var(--color-pos-500)" fmt={fmt} /><FlowBar label="Consumption" value={headline.consumption} max={max} color="var(--color-neg-500)" fmt={fmt} /></div><div><FlowBar label="Savings movement" value={headline.savingsMovement} max={max} color="var(--color-brand-500)" fmt={fmt} /><FlowBar label="Cash retained" value={headline.cashRetained} max={max} color="var(--color-ink-500)" fmt={fmt} /></div></div>
}

function FlowDetail({ detail, fmt, onClose }) {
  return <div className="fixed inset-0 z-[100] flex items-end justify-center overflow-y-auto bg-black/40 p-0 sm:items-center sm:p-6"><div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-surface p-6 shadow-xl sm:rounded-2xl"><div className="mb-1 flex items-center justify-between"><h2 className="text-lg font-semibold text-ink-900">{detail.label}</h2><button type="button" onClick={onClose} className="text-sm text-ink-400 hover:text-ink-600">Close</button></div><p className="mb-4 text-xs text-ink-400">{detail.items.length} canonical {detail.items.length === 1 ? 'fact' : 'facts'} · {fmt(detail.total)} total</p><ul className="divide-y divide-ink-100 rounded-2xl border border-ink-200">{detail.items.slice().sort((a, b) => a.date < b.date ? 1 : -1).map((item) => <li key={item.id} className="flex items-center justify-between px-4 py-2.5 text-sm"><span className="min-w-0"><span className="block text-ink-600">{item.date}</span><span className="block truncate text-xs text-ink-400">{detail.kind === 'income' ? item.person || 'Unassigned' : [item.owner || 'Unassigned', item.note].filter(Boolean).join(' · ')}</span></span><span className="tnum shrink-0 pl-2 font-medium text-ink-900">{displayMoney(item.amount_aed, fmt)}</span></li>)}</ul></div></div>
}

function FlowBar({ label, value, max, color, fmt }) {
  return <div className="mb-3 last:mb-0"><div className="mb-1 flex items-center justify-between text-xs"><span className="font-medium text-ink-700">{label}</span><span className="tnum font-semibold text-ink-900">{displayMoney(value, fmt)}</span></div><div className="h-2.5 w-full overflow-hidden rounded-full bg-ink-100">{value !== null && <div className="h-full origin-left rounded-full" style={{ width: `${Math.min(100, (Math.abs(value) / max) * 100)}%`, backgroundColor: color, animation: 'grow .7s cubic-bezier(.16,1,.3,1) both' }} />}</div></div>
}

function StatCard({ label, value, tone, hint }) {
  const toneClass = tone === 'bad' ? 'text-neg-600' : 'text-ink-900'
  return <div className="rounded-2xl border border-ink-200 bg-surface p-4 shadow-card"><p className="text-xs text-ink-500">{label}</p><p className={`mt-1 text-lg font-semibold ${toneClass}`}>{value}</p>{hint && <p className="mt-1 text-xs text-ink-400">{hint}</p>}</div>
}

function PersonBreakdown({ groups, totalIncome, target }) {
  if (totalIncome === null || groups.length === 0) return <div className="rounded-2xl border border-ink-200 bg-surface p-5 shadow-card"><p className="py-6 text-center text-sm text-ink-500">Canonical recorded-person breakdown unavailable for this period.</p></div>
  const targets = new Map([['Shrey', (target?.shrey ?? 0.69) * 100], ['Tarika', (target?.tarika ?? 0.31) * 100]])
  return <div className="rounded-2xl border border-ink-200 bg-surface p-5 shadow-card"><h2 className="mb-4 text-sm font-semibold text-ink-900">Posted income by recorded person</h2><div className="space-y-4">{groups.map((group) => { const actualPct = totalIncome > 0 ? (group.value / totalIncome) * 100 : null; const targetPct = targets.get(group.key); return <div key={group.key}><div className="mb-1 flex items-center justify-between text-xs"><span className="font-medium text-ink-700">{group.label}</span><span className="tnum text-ink-900">{actualPct === null ? '—' : `${actualPct.toFixed(0)}%`}{targetPct !== undefined ? <span className="ml-1 text-ink-400">target {targetPct.toFixed(0)}%</span> : null}</span></div><div className="relative h-3 w-full overflow-hidden rounded-full bg-ink-100">{actualPct !== null && <div className="h-full rounded-full bg-ink-300" style={{ width: `${Math.min(100, Math.abs(actualPct))}%` }} />}</div></div> })}</div><p className="mt-3 text-xs text-ink-400">Shrey, Tarika, Joint and Unassigned remain exact recorded buckets. The 69/31 target is guidance only.</p></div>
}
