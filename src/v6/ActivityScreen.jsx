import { useCallback, useEffect, useMemo, useRef } from 'react'

import { canonicalReads } from './data/canonicalReads'
import { resolveDetail, VIEW_OPTIONS } from './data/activityModel'
import { monthPeriod, stepMonth } from './data/activityPeriods'
import { useActivityData } from './data/useActivityData'
import ActivityHeader from './activity/ActivityHeader'
import ActivityControls from './activity/ActivityControls'
import ActivityList from './activity/ActivityList'
import ActivityCalendar from './activity/ActivityCalendar'
import TransactionDrawer from './activity/TransactionDrawer'
import './v6.css'

function readView(routeQuery) {
  return VIEW_OPTIONS.some((option) => option.value === routeQuery?.view) ? routeQuery.view : 'list'
}

function readFilters(routeQuery) {
  return {
    search: routeQuery?.search ?? '',
    category: routeQuery?.category ?? '',
    owner: routeQuery?.owner ?? '',
    needsReview: routeQuery?.needsReview === '1',
    sort: routeQuery?.sort ?? 'date',
  }
}

/**
 * Money → Activity.
 *
 * Composed fresh from the frozen prototype inside the SHR-155 V6 boundary.
 * Nothing here comes from `src/screens/Transactions.jsx`; the only shared
 * pieces are non-visual infrastructure — routing, the detail shell's focus
 * behaviour, and the canonical read contracts.
 *
 * Read-only by design for this slice: every write the prototype exposes is
 * rendered as a named unsupported capability rather than wired to a legacy
 * mutation path.
 */
export default function ActivityScreen({
  routeQuery,
  onRouteQueryChange,
  detailId,
  onOpenDetail,
  onCloseDetail,
  today,
  reads = canonicalReads,
}) {
  const view = readView(routeQuery)
  const filters = useMemo(() => readFilters(routeQuery), [routeQuery])
  const year = routeQuery?.year
  const month = routeQuery?.month

  const { model, loading, refreshing } = useActivityData({ year, month, today, filters, view, reads })
  const fallbackPeriod = useMemo(() => monthPeriod({ year, month, today }), [month, today, year])
  const period = model?.period ?? fallbackPeriod

  // `updateQuery` replaces the whole query, so every change merges onto the
  // current one rather than dropping the filters the household already set.
  const commitQuery = useCallback((changes) => {
    const next = {
      view: view === 'list' ? '' : view,
      search: filters.search,
      category: filters.category,
      owner: filters.owner,
      sort: filters.sort === 'date' ? '' : filters.sort,
      needsReview: filters.needsReview ? '1' : '',
      year: year ?? '',
      month: month ?? '',
      ...changes,
    }
    onRouteQueryChange?.(next)
  }, [filters, month, onRouteQueryChange, view, year])

  const handleFilterChange = useCallback((change) => {
    const next = { ...change }
    if ('needsReview' in change) next.needsReview = change.needsReview ? '1' : ''
    if ('sort' in change) next.sort = change.sort === 'date' ? '' : change.sort
    commitQuery(next)
  }, [commitQuery])

  const handleViewChange = useCallback((nextView) => {
    commitQuery({ view: nextView === 'list' ? '' : nextView })
  }, [commitQuery])

  const handleStepMonth = useCallback((delta) => {
    const next = stepMonth(period, delta)
    commitQuery({ year: String(next.year), month: String(next.month) })
  }, [commitQuery, period])

  // A detail route is built from the screen's current query, so the query has
  // to name the month explicitly before a row is opened. Otherwise a link
  // generated while browsing the default month carries no period, and
  // reopening it from another month cannot resolve the entry it points at.
  // Written once, by replacement, so it adds no history entry.
  const periodPinned = useRef(false)
  useEffect(() => {
    if (periodPinned.current || !model) return
    if (routeQuery?.year && routeQuery?.month) {
      periodPinned.current = true
      return
    }
    periodPinned.current = true
    commitQuery({ year: String(period.year), month: String(period.month) })
  }, [commitQuery, model, period.month, period.year, routeQuery?.month, routeQuery?.year])

  const handleOpenRow = useCallback((id) => {
    onOpenDetail?.('transaction', id)
  }, [onOpenDetail])

  const detail = resolveDetail(model, detailId)

  return (
    <div className="v6-surface" data-testid="v6-activity">
      <ActivityHeader
        model={model ?? { period, summary: { spend: { status: 'unavailable', gap: null, reason: 'Reading…' }, income: { status: 'unavailable', gap: null, reason: 'Reading…' }, quality: null }, loadedCount: 0 }}
        onStepMonth={handleStepMonth}
      />

      <p className="v6-visually-hidden" role="status" aria-live="polite">
        {loading ? 'Reading canonical ledger entries.'
          : refreshing ? 'Updating canonical ledger entries.'
            : `Showing ${model?.visibleCount ?? 0} of ${model?.loadedCount ?? 0} entries for ${period.label}.`}
      </p>

      {!model ? (
        <section className="v6-section" aria-label="Activity loading">
          <div className="v6-unavailable" role="note">
            <p className="v6-unavailable-label">Reading canonical contracts…</p>
            <p className="v6-unavailable-detail">
              Entries appear only once the canonical ledger answers. Nothing is estimated while this loads.
            </p>
          </div>
        </section>
      ) : (
        <>
          <ActivityControls model={model} onFilterChange={handleFilterChange} onViewChange={handleViewChange} />
          {model.view === 'calendar'
            ? <ActivityCalendar model={model} />
            : <ActivityList model={model} onOpenRow={handleOpenRow} />}
          {detail.status !== 'none' ? (
            <TransactionDrawer detail={detail} model={model} onClose={() => onCloseDetail?.()} />
          ) : null}
        </>
      )}
    </div>
  )
}
