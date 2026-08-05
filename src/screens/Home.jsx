import { useAccountsAndFx } from '../lib/useAccountsAndFx'
import NetWorthHero from '../components/NetWorthHero'

export default function Home() {
  const { accounts, fxRates, loading, error } = useAccountsAndFx()

  if (loading) {
    return <div className="px-6 py-10 text-center text-sm text-stone-500">Loading…</div>
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
      {error && (
        <p role="alert" className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">
          {error}
        </p>
      )}
      <NetWorthHero accounts={accounts} fxRates={fxRates} />
      <p className="mt-6 text-center text-sm text-stone-400">
        Spend, budget, and bills at a glance are coming in later epics.
      </p>
    </div>
  )
}
