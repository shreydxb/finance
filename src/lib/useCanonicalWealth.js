import { useCallback, useEffect, useState } from 'react'

import { loadCanonicalWealth } from './canonicalMetrics'
import { listDailyNetWorth } from './snapshots'
import { loadAccountsWealthView } from './wealthLoader'
import { useRealtimeRefresh } from './useRealtime'
import { REALTIME_TABLES } from './realtime'

export function useCanonicalWealth() {
  const [wealth, setWealth] = useState(null)
  const [history, setHistory] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const refresh = useCallback(async () => {
    setError('')
    try {
      const result = await loadAccountsWealthView({ loadWealth: loadCanonicalWealth, listHistory: listDailyNetWorth })
      setWealth(result.wealth)
      setHistory(result.history)
    } catch {
      setWealth(null)
      setHistory([])
      setError('Canonical wealth values are unavailable. No legacy estimate is shown.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { refresh() }, [refresh])
  useRealtimeRefresh(REALTIME_TABLES.accounts, refresh)

  return { wealth, history, loading, error, refresh }
}
