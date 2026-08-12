import { useMemo } from 'react'
import { toAED } from './money'

export function useNetWorth(accounts, fxRates) {
  return useMemo(() => {
    let assets = 0
    let liabilities = 0
    for (const a of accounts) {
      const aed = toAED(Number(a.value) || 0, a.currency, fxRates)
      if (a.is_liability) liabilities += aed
      else assets += aed
    }
    return { assets, liabilities, netWorth: assets - liabilities }
  }, [accounts, fxRates])
}
