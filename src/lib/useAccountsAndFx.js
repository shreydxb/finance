import { useEffect, useState } from 'react'
import { listAccounts } from './accounts'
import { usePrefs } from './PrefsContext'
import { useRealtimeRefresh } from './useRealtime'
import { REALTIME_TABLES } from './realtime'

/**
 * Accounts, plus the household's FX rates.
 *
 * FX comes from `PrefsContext` rather than a fetch of its own. This hook used
 * to load `fx_rates` independently, which meant a screen could compute an AED
 * subtotal with one snapshot of the rates and then format it with the
 * context's — a disagreement that produces a plausible, wrong figure and shows
 * up nowhere as an error. One source, one snapshot (MONEY-01).
 */
export function useAccountsAndFx() {
  const { fxRates } = usePrefs()
  const [accounts, setAccounts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  async function refresh() {
    setError('')
    try {
      setAccounts(await listAccounts())
    } catch {
      setError('Could not load accounts. Check your connection and try again.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    refresh()
  }, [])

  // Balances change from the other person's device and from price refreshes;
  // every screen built on this hook now sees that without a manual reload.
  useRealtimeRefresh(REALTIME_TABLES.accounts, refresh)

  return { accounts, fxRates, loading, error, refresh }
}
