import { useNetWorth } from '../lib/useNetWorth'

function formatAED(n) {
  const sign = n < 0 ? '-' : ''
  const abs = Math.abs(n)
  return `${sign}AED ${abs.toLocaleString('en-AE', { maximumFractionDigits: 0 })}`
}

export default function NetWorthHero({ accounts, fxRates }) {
  const { assets, liabilities, netWorth } = useNetWorth(accounts, fxRates)

  return (
    <div className="rounded-xl border border-stone-200 bg-white p-6">
      <p className="text-sm text-stone-500">Net worth</p>
      <p className="mt-1 text-4xl font-semibold text-stone-900">{formatAED(netWorth)}</p>
      <div className="mt-3 flex gap-4 text-sm text-stone-600">
        <span>Assets {formatAED(assets)}</span>
        <span>Liabilities {formatAED(liabilities)}</span>
      </div>
    </div>
  )
}
