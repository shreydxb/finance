import { useCallback, useEffect, useMemo, useRef } from 'react'

import { canonicalReads } from './data/canonicalReads'
import { recurringGapSlot } from './data/recurringGaps'
import { isRecurringType, isRecurringView, recurringPeriod, stepMonth } from './data/recurringPeriods'
import { useRecurringData } from './data/useRecurringData'
import { UnavailableRegion } from './primitives/Slot'
import RecurringHeader from './recurring/RecurringHeader'
import RecurringControls from './recurring/RecurringControls'
import RecurringPlanList from './recurring/RecurringPlanList'
import RecurringCalendar from './recurring/RecurringCalendar'
import RecurringCommitmentSplit from './recurring/RecurringCommitmentSplit'
import RecurringMatching from './recurring/RecurringMatching'
import './v6.css'

function readType(routeQuery) {
  return isRecurringType(routeQuery?.type) ? routeQuery.type : 'bills'
}

function readView(routeQuery) {
  return isRecurringView(routeQuery?.view) ? routeQuery.view : 'list'
}

/**
 * Money → Recurring.
 *
 * Composed fresh from the frozen prototype inside the SHR-155 V6 boundary.
 * Nothing here comes from `src/screens/Recurring.jsx` or from
 * `src/lib/recurring.js`; the only shared pieces are non-visual infrastructure
 * — routing, the responsive shell, and the canonical read contracts the
 * Overview and Budget already consume.
 *
 * Read-only by design, and emptier than it looks by design too. Recurring is
 * a plan surface, and no approved contract publishes recurring commitments or
 * expected income. The screen therefore renders the prototype's full
 * composition — Bills / Income, List / Calendar, month navigation, the
 * fixed-versus-variable card, the matching surface — and fills only the one
 * position a canonical contract can answer: the period's posted consumption
 * spend. Every other position states its own gap and names SHR-171, SHR-167 or
 * SHR-195/SHR-156.
 *
 * What is deliberately absent is the easy version of this screen: a recurring
 * plan reverse-engineered from posted transactions. This module makes no
 * ledger read at all, so that inference has nowhere to live.
 */
export default function RecurringScreen({
  routeQuery,
  onRouteQueryChange,
  detailId,
  today,
  reads = canonicalReads,
}) {
  const type = readType(routeQuery)
  const view = readView(routeQuery)
  const year = routeQuery?.year
  const month = routeQuery?.month

  const { model, loading, refreshing } = useRecurringData({ view, type, year, month, today, reads })
  const fallbackPeriod = useMemo(() => recurringPeriod({ year, month, today }), [month, today, year])
  const period = model?.period ?? fallbackPeriod

  const commitQuery = useCallback((changes) => {
    onRouteQueryChange?.({
      type: type === 'bills' ? '' : type,
      view: view === 'list' ? '' : view,
      year: year ?? '',
      month: month ?? '',
      ...changes,
    })
  }, [month, onRouteQueryChange, type, view, year])

  const handleTypeChange = useCallback((nextType) => {
    if (nextType === type) return
    commitQuery({ type: nextType === 'bills' ? '' : nextType })
  }, [commitQuery, type])

  const handleViewChange = useCallback((nextView) => {
    if (nextView === view) return
    commitQuery({ view: nextView === 'list' ? '' : nextView })
  }, [commitQuery, view])

  const handleStep = useCallback((delta) => {
    const next = stepMonth(period, delta)
    commitQuery({ year: String(next.year), month: String(next.month) })
  }, [commitQuery, period])

  // The selected month is written into the URL once, by replacement, so a
  // shared or reloaded Recurring link reopens the same period rather than
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
    <div className="v6-surface" data-testid="v6-recurring">
      <RecurringHeader
        model={model ?? {
          period,
          plan: {
            committedTotal: recurringGapSlot('committedTotal'),
            autopay: recurringGapSlot('autopay'),
          },
        }}
        onStep={handleStep}
      />

      <p className="v6-visually-hidden" role="status" aria-live="polite">
        {loading ? 'Reading canonical period metrics.'
          : refreshing ? 'Updating canonical period metrics.'
            : `Showing ${type === 'income' ? 'expected income' : 'bills and EMIs'} for ${period.label}. No recurring plan is published for this period.`}
      </p>

      {!model ? (
        <section className="v6-section" aria-label="Recurring loading">
          <div className="v6-unavailable" role="note">
            <p className="v6-unavailable-label">Reading canonical contracts…</p>
            <p className="v6-unavailable-detail">
              Figures appear only once a canonical contract answers. Nothing is estimated while this loads.
            </p>
          </div>
        </section>
      ) : (
        <>
          <RecurringControls model={model} onTypeChange={handleTypeChange} onViewChange={handleViewChange} />

          {/* A detail deep link points at a commitment. None is published, so
              the link resolves to an honest state rather than silently showing
              the list it was not written for. */}
          {detailId ? (
            <section className="v6-section" aria-label="Recurring commitment detail">
              <UnavailableRegion slot={model.plan.bills} />
            </section>
          ) : null}

          {model.view === 'calendar'
            ? <RecurringCalendar model={model} />
            : <RecurringPlanList model={model} />}

          <RecurringCommitmentSplit model={model} />
          <RecurringMatching model={model} />
        </>
      )}
    </div>
  )
}
