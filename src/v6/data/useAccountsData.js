import { useCallback, useEffect, useRef, useState } from 'react'

import { REALTIME_TABLES } from '../../lib/realtime.js'
import { useRealtimeRefresh } from '../../lib/useRealtime.js'
import { canonicalReads } from './canonicalReads.js'
import { composeAccounts } from './composeAccounts.js'

/**
 * Reads the Accounts screen's canonical contracts.
 *
 * Read-only: mounting this hook performs two selects and no write of any kind.
 * The realtime subscription re-reads the same two contracts when the accounts
 * table changes; it never records a snapshot, never stamps a valuation and
 * never writes back what it just read.
 */
export function useAccountsData({ group, reads = canonicalReads } = {}) {
  const [model, setModel] = useState(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const requestRef = useRef(0)

  const refresh = useCallback(async () => {
    const request = requestRef.current + 1
    requestRef.current = request
    setRefreshing(true)
    const next = await composeAccounts({ group, reads })
    if (requestRef.current !== request) return
    setModel(next)
    setLoading(false)
    setRefreshing(false)
  }, [group, reads])

  useEffect(() => { refresh() }, [refresh])
  useRealtimeRefresh(REALTIME_TABLES.accounts, refresh)
  return { model, loading, refreshing, refresh }
}
