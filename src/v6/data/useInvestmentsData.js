import { useCallback, useEffect, useRef, useState } from 'react'

import { REALTIME_TABLES } from '../../lib/realtime.js'
import { useRealtimeRefresh } from '../../lib/useRealtime.js'
import { canonicalReads } from './canonicalReads.js'
import { composeInvestments } from './composeInvestments.js'

/**
 * Reads the Investments screen's canonical contracts.
 *
 * Read-only: mounting this hook performs two selects and no write of any kind.
 * It records no snapshot, stamps no valuation, refreshes no price and writes
 * back nothing it just read. The realtime subscription re-reads the same two
 * contracts when the accounts table changes; a re-read is still a read.
 */
export function useInvestmentsData({ reads = canonicalReads } = {}) {
  const [model, setModel] = useState(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const requestRef = useRef(0)

  const refresh = useCallback(async () => {
    const request = requestRef.current + 1
    requestRef.current = request
    setRefreshing(true)
    const next = await composeInvestments({ reads })
    if (requestRef.current !== request) return
    setModel(next)
    setLoading(false)
    setRefreshing(false)
  }, [reads])

  useEffect(() => { refresh() }, [refresh])
  useRealtimeRefresh(REALTIME_TABLES.accounts, refresh)
  return { model, loading, refreshing, refresh }
}
