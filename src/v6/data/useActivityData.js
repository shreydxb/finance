import { useCallback, useEffect, useRef, useState } from 'react'

import { REALTIME_TABLES } from '../../lib/realtime.js'
import { useRealtimeRefresh } from '../../lib/useRealtime.js'
import { canonicalReads } from './canonicalReads.js'
import { composeActivity } from './composeActivity.js'

/**
 * Activity data state.
 *
 * A filter or period change keeps the previous model on screen and flags
 * `refreshing`, so narrowing a search does not blank a list the household is
 * reading. Only the first read of the screen shows `loading`.
 */
export function useActivityData({ year, month, today, filters, view, reads = canonicalReads } = {}) {
  const [model, setModel] = useState(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const requestRef = useRef(0)
  const filterKey = JSON.stringify(filters ?? {})

  const refresh = useCallback(async () => {
    const request = requestRef.current + 1
    requestRef.current = request
    setRefreshing(true)
    const next = await composeActivity({
      year, month, today, reads, view, filters: JSON.parse(filterKey),
    })
    if (requestRef.current !== request) return
    setModel(next)
    setLoading(false)
    setRefreshing(false)
  }, [filterKey, month, reads, today, view, year])

  useEffect(() => { refresh() }, [refresh])
  useRealtimeRefresh(REALTIME_TABLES.transactions, refresh)

  return { model, loading, refreshing, refresh }
}
