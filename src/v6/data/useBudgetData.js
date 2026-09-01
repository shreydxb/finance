import { useCallback, useEffect, useRef, useState } from 'react'

import { REALTIME_TABLES } from '../../lib/realtime.js'
import { useRealtimeRefresh } from '../../lib/useRealtime.js'
import { canonicalReads } from './canonicalReads.js'
import { composeBudget } from './composeBudget.js'

/**
 * Budget data state.
 *
 * A period or view change keeps the previous model on screen and flags
 * `refreshing`, so stepping a month does not blank a table the household is
 * reading. Only the first read of the screen shows `loading`.
 */
export function useBudgetData({ view, year, month, today, reads = canonicalReads } = {}) {
  const [model, setModel] = useState(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const requestRef = useRef(0)

  const refresh = useCallback(async () => {
    const request = requestRef.current + 1
    requestRef.current = request
    setRefreshing(true)
    const next = await composeBudget({ view, year, month, today, reads })
    if (requestRef.current !== request) return
    setModel(next)
    setLoading(false)
    setRefreshing(false)
  }, [month, reads, today, view, year])

  useEffect(() => { refresh() }, [refresh])
  useRealtimeRefresh(REALTIME_TABLES.transactions, refresh)

  return { model, loading, refreshing, refresh }
}
