import { useCallback, useEffect, useRef, useState } from 'react'

import { REALTIME_TABLES } from '../../lib/realtime.js'
import { useRealtimeRefresh } from '../../lib/useRealtime.js'
import { canonicalReads } from './canonicalReads.js'
import { composeRecurring } from './composeRecurring.js'

/**
 * Recurring data state.
 *
 * A period, type or view change keeps the previous model on screen and flags
 * `refreshing`, so stepping a month does not blank the screen mid-read. Only
 * the first read shows `loading`.
 */
export function useRecurringData({ view, type, year, month, today, reads = canonicalReads } = {}) {
  const [model, setModel] = useState(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const requestRef = useRef(0)

  const refresh = useCallback(async () => {
    const request = requestRef.current + 1
    requestRef.current = request
    setRefreshing(true)
    const next = await composeRecurring({ view, type, year, month, today, reads })
    if (requestRef.current !== request) return
    setModel(next)
    setLoading(false)
    setRefreshing(false)
  }, [month, reads, today, type, view, year])

  useEffect(() => { refresh() }, [refresh])
  useRealtimeRefresh(REALTIME_TABLES.transactions, refresh)

  return { model, loading, refreshing, refresh }
}
