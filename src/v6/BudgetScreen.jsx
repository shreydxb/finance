import { useCallback, useEffect, useMemo, useRef } from 'react'

import { canonicalReads } from './data/canonicalReads'
import { budgetPeriod, isBudgetView, stepMonth, stepYear } from './data/budgetPeriods'
import { useBudgetData } from './data/useBudgetData'
import BudgetHeader from './budget/BudgetHeader'
import BudgetControls from './budget/BudgetControls'
import BudgetSummary from './budget/BudgetSummary'
import BudgetCategoryTable from './budget/BudgetCategoryTable'
import BudgetYearGrid from './budget/BudgetYearGrid'
import BudgetQuality from './budget/BudgetQuality'
import './v6.css'

function readView(routeQuery) {
  return isBudgetView(routeQuery?.view) ? routeQuery.view : 'month'
}

/**
 * Money → Budget.
 *
 * Composed fresh from the frozen prototype inside the SHR-155 V6 boundary.
 * Nothing here comes from `src/screens/Budget.jsx` or from
 * `src/lib/budgets.js`; the only shared pieces are non-visual infrastructure —
 * routing, the responsive shell, and the canonical read contracts the Overview
 * already consumes.
 *
 * Read-only by design for this slice. Budget's writes are plan writes, and a
 * plan written outside the versioned plan contract (SHR-166) is a plan that
 * contract could not later version, interpret or supersede — so every write
 * affordance the prototype offers is rendered as a named unsupported
 * capability rather than wired to the legacy budget writer.
 */
export default function BudgetScreen({
  routeQuery,
  onRouteQueryChange,
  today,
  reads = canonicalReads,
}) {
  const view = readView(routeQuery)
  const year = routeQuery?.year
  const month = routeQuery?.month

  const { model, loading, refreshing } = useBudgetData({ view, year, month, today, reads })
  const fallbackPeriod = useMemo(() => budgetPeriod({ view, year, month, today }), [month, today, view, year])
  const period = model?.period ?? fallbackPeriod

  const commitQuery = useCallback((changes) => {
    onRouteQueryChange?.({
      view: view === 'month' ? '' : view,
      year: year ?? '',
      month: month ?? '',
      ...changes,
    })
  }, [month, onRouteQueryChange, view, year])

  const handleViewChange = useCallback((nextView) => {
    if (nextView === view) return
    // The month stays in the URL across the switch, so returning to Month
    // reopens the month the household was already looking at.
    commitQuery({
      view: nextView === 'month' ? '' : nextView,
      year: String(period.year),
      month: String(period.month),
    })
  }, [commitQuery, period.month, period.year, view])

  const handleStep = useCallback((delta) => {
    const next = period.view === 'year' ? stepYear(period, delta) : stepMonth(period, delta)
    commitQuery({ year: String(next.year), month: String(next.month) })
  }, [commitQuery, period])

  // The selected period is written into the URL once, by replacement, so a
  // shared or reloaded Budget link reopens the same month or year rather than
  // silently resetting to today's. Written only after the first model arrives
  // so it never races the initial read, and only once so it adds no history.
  const periodPinned = useRef(false)
  useEffect(() => {
    if (periodPinned.current || !model) return
    periodPinned.current = true
    if (routeQuery?.year && routeQuery?.month) return
    commitQuery({ year: String(period.year), month: String(period.month) })
  }, [commitQuery, model, period.month, period.year, routeQuery?.month, routeQuery?.year])

  return (
    <div className="v6-surface" data-testid="v6-budget">
      <BudgetHeader
        model={model ?? {
          period,
          view,
          summary: { actual: { status: 'unavailable', gap: null, reason: 'Reading…' }, quality: null, needsReviewCount: null },
        }}
        onStep={handleStep}
      />

      <p className="v6-visually-hidden" role="status" aria-live="polite">
        {loading ? 'Reading canonical budget actuals.'
          : refreshing ? 'Updating canonical budget actuals.'
            : `Showing canonical category actuals for ${period.label}.`}
      </p>

      {!model ? (
        <section className="v6-section" aria-label="Budget loading">
          <div className="v6-unavailable" role="note">
            <p className="v6-unavailable-label">Reading canonical contracts…</p>
            <p className="v6-unavailable-detail">
              Figures appear only once a canonical contract answers. Nothing is estimated while this loads.
            </p>
          </div>
        </section>
      ) : (
        <>
          <BudgetControls model={model} onViewChange={handleViewChange} />
          {model.view === 'year' ? (
            <BudgetYearGrid model={model} />
          ) : (
            <>
              <BudgetSummary model={model} />
              <BudgetCategoryTable model={model} />
              <BudgetQuality model={model} />
            </>
          )}
        </>
      )}
    </div>
  )
}
