import { useEffect, useState } from 'react'
import { listAccounts } from './accounts'
import { getSetting } from './settings'

export function useAccountsAndFx() {
  const [accounts, setAccounts] = useState([])
  const [fxRates, setFxRates] = useState({ AED: 1 })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  async function refresh() {
    setError('')
    try {
      const [accts, fx] = await Promise.all([listAccounts(), getSetting('fx_rates')])
      setAccounts(accts)
      setFxRates(fx || { AED: 1 })
    } catch {
      setError('Could not load accounts. Check your connection and try again.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    refresh()
  }, [])

  return { accounts, fxRates, loading, error, refresh }
}
