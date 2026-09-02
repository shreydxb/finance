import { useCallback } from 'react'

import { canonicalReads } from './data/canonicalReads'
import { isNetWorthRange } from './data/netWorthRanges'
import { useNetWorthData } from './data/useNetWorthData'
import NetWorthHeader from './net-worth/NetWorthHeader'
import CurrentNetWorth from './net-worth/CurrentNetWorth'
import BalanceSheetPositions from './net-worth/BalanceSheetPositions'
import NetWorthHistory from './net-worth/NetWorthHistory'
import NetWorthQuality from './net-worth/NetWorthQuality'
import './v6.css'

/** Fresh, read-only Wealth → Net Worth composition for SHR-177. */
export default function NetWorthScreen({ routeQuery, onRouteQueryChange, today, reads = canonicalReads }) {
  const rangeKey = isNetWorthRange(routeQuery?.range) ? routeQuery.range : '1y'
  const { model, loading, refreshing } = useNetWorthData({ rangeKey, today, reads })
  const handleRangeChange = useCallback((next) => {
    if (!isNetWorthRange(next) || next === rangeKey) return
    onRouteQueryChange?.({ range: next === '1y' ? '' : next })
  }, [onRouteQueryChange, rangeKey])

  return (
    <div className="v6-surface" data-testid="v6-net-worth" data-read-only="true">
      <NetWorthHeader />
      <p className="v6-visually-hidden" role="status" aria-live="polite">
        {loading ? 'Reading current balance-sheet and authoritative snapshot contracts.'
          : refreshing ? 'Updating current balance-sheet and authoritative snapshot contracts.'
            : `Showing whole-household Net Worth with ${model.range.label} snapshot range.`}
      </p>
      {!model ? (
        <section className="v6-section" aria-label="Net worth loading">
          <div className="v6-unavailable" role="note">
            <p className="v6-unavailable-label">Reading canonical wealth contracts…</p>
            <p className="v6-unavailable-detail">Current truth and history are read separately. Nothing is estimated, reconstructed or written while this loads.</p>
          </div>
        </section>
      ) : (
        <>
          <CurrentNetWorth current={model.current} />
          <BalanceSheetPositions accounts={model.accounts} current={model.current} provenance={model.provenance} />
          <NetWorthHistory history={model.history} range={model.range} onRangeChange={handleRangeChange} />
          <NetWorthQuality current={model.current} freshness={model.freshness} />
        </>
      )}
    </div>
  )
}
