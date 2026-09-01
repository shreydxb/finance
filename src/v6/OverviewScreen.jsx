import { useCallback, useMemo } from 'react'

import { canonicalReads } from './data/canonicalReads'
import { isPeriodKey, periodToDateRange } from './data/periods'
import { useOverviewData } from './data/useOverviewData'
import { formatDayMonthYear } from './format'
import OverviewHeader from './overview/OverviewHeader'
import HouseholdSummary from './overview/HouseholdSummary'
import PeriodKpis from './overview/PeriodKpis'
import CashFlowSection from './overview/CashFlowSection'
import AttentionSection from './overview/AttentionSection'
import UpcomingSection from './overview/UpcomingSection'
import { AccountsColumn, RecentActivityColumn, TopSpendColumn } from './overview/DetailColumns'
import QualitySection from './overview/QualitySection'
import './v6.css'

/**
 * The V6 Overview Command Center.
 *
 * Composed fresh from the frozen prototype: header/context, household summary
 * hero, period KPIs, cash flow, needs attention, next 30 days, then the
 * top-spend / recent-activity / accounts detail region and a quality and
 * freshness footer. Nothing in this tree comes from the legacy Home screen.
 */
export default function OverviewScreen({
  routeQuery,
  onRouteQueryChange,
  navigate,
  today,
  reads = canonicalReads,
}) {
  const periodKey = isPeriodKey(routeQuery?.period) ? routeQuery.period : 'mtd'
  const { model, loading, refreshing } = useOverviewData({ periodKey, today, reads })

  const handlePeriodChange = useCallback((next) => {
    if (!isPeriodKey(next) || next === periodKey) return
    // Through the router, so the period survives a reload, a shared link and
    // the browser's own back button.
    onRouteQueryChange?.({ period: next })
  }, [onRouteQueryChange, periodKey])

  const fallbackPeriod = useMemo(() => periodToDateRange(periodKey, today), [periodKey, today])
  const period = model?.period ?? fallbackPeriod
  const rangeLabel = `${formatDayMonthYear(period.from)} – ${formatDayMonthYear(period.to)}`

  return (
    <div className="v6-surface" data-testid="v6-overview">
      <OverviewHeader
        period={period}
        today={model?.today ?? period.to}
        periodKey={periodKey}
        onPeriodChange={handlePeriodChange}
        busy={refreshing}
      />

      <p className="v6-visually-hidden" role="status" aria-live="polite">
        {loading ? 'Loading canonical Overview values.' : refreshing ? 'Refreshing canonical Overview values.' : `Overview showing ${period.title}.`}
      </p>

      {!model ? (
        <section className="v6-section" aria-label="Overview loading">
          <div className="v6-unavailable" role="note">
            <p className="v6-unavailable-label">Reading canonical contracts…</p>
            <p className="v6-unavailable-detail">
              Figures appear only once a canonical contract answers. Nothing is estimated while this loads.
            </p>
          </div>
        </section>
      ) : (
        <>
          <HouseholdSummary summary={model.summary} navigate={navigate} />
          <PeriodKpis kpis={model.kpis} period={period} rangeLabel={rangeLabel} />
          <div className="v6-g2 v6-enter">
            <CashFlowSection cashFlow={model.cashFlow} monthsLabel="Last 6 completed months" />
            <AttentionSection attention={model.attention} navigate={navigate} />
          </div>
          <UpcomingSection upcoming={model.upcoming} navigate={navigate} />
          <div className="v6-g3 v6-enter">
            <TopSpendColumn topSpend={model.topSpend} period={period} />
            <RecentActivityColumn recentActivity={model.recentActivity} navigate={navigate} />
            <AccountsColumn accounts={model.accounts} navigate={navigate} />
          </div>
          <QualitySection quality={model.quality} />
        </>
      )}
    </div>
  )
}
