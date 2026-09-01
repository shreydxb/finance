import { useCallback, useEffect, useRef, useState } from 'react'

import { REALTIME_TABLES } from '../../lib/realtime.js'
import { useRealtimeRefresh } from '../../lib/useRealtime.js'
import { canonicalReads } from './canonicalReads.js'
import { composeInsights } from './composeInsights.js'

export function useInsightsData({ kind, view, year, month, quarter, today, reads = canonicalReads } = {}) {
  const [model, setModel] = useState(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const requestRef = useRef(0)

  const refresh = useCallback(async () => {
    const request = requestRef.current + 1
    requestRef.current = request
    setRefreshing(true)
    const next = await composeInsights({ kind, view, year, month, quarter, today, reads })
    if (requestRef.current !== request) return
    setModel(next)
    setLoading(false)
    setRefreshing(false)
  }, [kind, month, quarter, reads, today, view, year])

  useEffect(() => { refresh() }, [refresh])
  useRealtimeRefresh(REALTIME_TABLES.transactions, refresh)

  return { model, loading, refreshing, refresh }
}
