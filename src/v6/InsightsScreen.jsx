import { useCallback, useEffect, useMemo, useRef } from 'react'

import { canonicalReads } from './data/canonicalReads'
import {
  insightsPeriod,
  isInsightsPeriod,
  isInsightsView,
  stepInsightsPeriod,
} from './data/insightsPeriods'
import { useInsightsData } from './data/useInsightsData'
import InsightsHeader from './insights/InsightsHeader'
import InsightsControls from './insights/InsightsControls'
import InsightsSummary from './insights/InsightsSummary'
import InsightsBreakdown from './insights/InsightsBreakdown'
import InsightsHistory from './insights/InsightsHistory'
import InsightsCompare from './insights/InsightsCompare'
import InsightsQuality from './insights/InsightsQuality'
import './v6.css'

/** Fresh, read-only Money → Insights composition for SHR-201. */
export default function InsightsScreen({
  routeQuery,
  onRouteQueryChange,
  today,
  reads = canonicalReads,
}) {
  const kind = isInsightsPeriod(routeQuery?.period) ? routeQuery.period : 'month'
  const view = isInsightsView(routeQuery?.view) ? routeQuery.view : 'breakdown'
  const year = routeQuery?.year
  const month = routeQuery?.month
  const quarter = routeQuery?.quarter

  const { model, loading, refreshing } = useInsightsData({ kind, view, year, month, quarter, today, reads })
  const fallbackPeriod = useMemo(
    () => insightsPeriod({ kind, year, month, quarter, today }),
    [kind, month, quarter, today, year],
  )
  const period = model?.period ?? fallbackPeriod

  const commitQuery = useCallback((changes) => {
    onRouteQueryChange?.({
      period: kind === 'month' ? '' : kind,
      view: view === 'breakdown' ? '' : view,
      year: year ?? '',
      month: month ?? '',
      quarter: quarter ?? '',
      ...changes,
    })
  }, [kind, month, onRouteQueryChange, quarter, view, year])

  const handleStep = useCallback((delta) => {
    const next = stepInsightsPeriod(period, delta)
    commitQuery({
      year: String(next.year),
      month: String(next.month),
      quarter: String(next.quarter),
    })
  }, [commitQuery, period])

  const handlePeriodChange = useCallback((nextKind) => {
    if (nextKind === kind) return
    commitQuery({ period: nextKind === 'month' ? '' : nextKind })
  }, [commitQuery, kind])

  const handleViewChange = useCallback((nextView) => {
    if (nextView === view) return
    commitQuery({ view: nextView === 'breakdown' ? '' : nextView })
  }, [commitQuery, view])

  const periodPinned = useRef(false)
  useEffect(() => {
    if (periodPinned.current || !model) return
    periodPinned.current = true
    if (routeQuery?.year && routeQuery?.month && routeQuery?.quarter) return
    commitQuery({
      year: String(period.year),
      month: String(period.month),
      quarter: String(period.quarter),
    })
  }, [commitQuery, model, period.month, period.quarter, period.year, routeQuery?.month, routeQuery?.quarter, routeQuery?.year])

  return (
    <div className="v6-surface" data-testid="v6-insights" data-read-only="true">
      <InsightsHeader
        model={model ?? {
          period,
          summary: {
            spend: { status: 'unavailable', reason: 'Reading canonical period metrics.' },
            income: { status: 'unavailable', reason: 'Reading canonical period metrics.' },
            quality: null,
          },
        }}
        onStep={handleStep}
      />

      <p className="v6-visually-hidden" role="status" aria-live="polite">
        {loading ? 'Reading canonical Insights contracts.'
          : refreshing ? 'Updating canonical Insights contracts.'
            : `Showing ${view} for ${period.label}. Unsupported analytical positions remain unavailable.`}
      </p>

      {!model ? (
        <section className="v6-section" aria-label="Insights loading">
          <div className="v6-unavailable" role="note">
            <p className="v6-unavailable-label">Reading canonical contracts…</p>
            <p className="v6-unavailable-detail">
              Figures appear only once an approved canonical contract answers. Nothing is grouped, compared, averaged or estimated while this loads.
            </p>
          </div>
        </section>
      ) : (
        <>
          <InsightsControls
            model={model}
            onPeriodChange={handlePeriodChange}
            onViewChange={handleViewChange}
          />
          <InsightsSummary model={model} />
          {view === 'trends' ? <InsightsHistory model={model} /> : null}
          {view === 'compare' ? <InsightsCompare model={model} /> : null}
          {view === 'breakdown' ? <InsightsBreakdown model={model} /> : null}
          <InsightsQuality model={model} />
        </>
      )}
    </div>
  )
}
