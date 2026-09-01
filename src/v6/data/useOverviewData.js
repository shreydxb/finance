import { useCallback, useEffect, useRef, useState } from 'react'

import { REALTIME_TABLES } from '../../lib/realtime.js'
import { useRealtimeRefresh } from '../../lib/useRealtime.js'
import { canonicalReads } from './canonicalReads.js'
import { composeOverview } from './composeOverview.js'
import { isPeriodKey } from './periods.js'

/**
 * Overview data state.
 *
 * `loading` is only true for the first read of a period. A period change or a
 * realtime refresh keeps the previous model on screen and flags `refreshing`,
 * so changing MTD → QTD does not blank a screen the household is reading.
 */
export function useOverviewData({ periodKey, today, reads = canonicalReads } = {}) {
  const [model, setModel] = useState(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const requestRef = useRef(0)
  const key = isPeriodKey(periodKey) ? periodKey : 'mtd'

  const refresh = useCallback(async () => {
    const request = requestRef.current + 1
    requestRef.current = request
    setRefreshing(true)
    const next = await composeOverview({ periodKey: key, today, reads })
    if (requestRef.current !== request) return
    setModel(next)
    setLoading(false)
    setRefreshing(false)
  }, [key, reads, today])

  useEffect(() => { refresh() }, [refresh])
  useRealtimeRefresh(REALTIME_TABLES.home, refresh)

  return { model, loading, refreshing, refresh }
}
