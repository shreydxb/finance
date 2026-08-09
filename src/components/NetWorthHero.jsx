import { useNetWorth } from '../lib/useNetWorth'
import { usePrefs } from '../lib/PrefsContext'
import AnimatedNumber from './AnimatedNumber'

/**
 * The single most-looked-at number in the app, so it gets the only dark,
 * saturated surface — everything else stays on white cards. That contrast is
 * what makes it read as "the headline" without needing a bigger font.
 */
export default function NetWorthHero({ accounts, fxRates }) {
  const { fmt } = usePrefs()
  const { assets, liabilities, netWorth } = useNetWorth(accounts, fxRates)
  const equityShare = assets > 0 ? Math.max(0, Math.min(100, ((assets - liabilities) / assets) * 100)) : 0

  return (
    <div className="relative overflow-hidden rounded-2xl bg-night p-6 shadow-hero">
      {/* Two soft radial washes give the flat navy depth without an image. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-70"
        style={{
          background:
            'radial-gradient(120% 90% at 88% -10%, rgba(37,99,235,.55) 0%, transparent 55%), radial-gradient(90% 80% at 0% 110%, rgba(14,164,114,.28) 0%, transparent 60%)',
        }}
      />

      <div className="relative">
        <p className="text-sm font-medium text-brand-200">Net worth</p>
        <AnimatedNumber
          value={netWorth}
          format={fmt}
          className="tnum mt-1 block text-4xl font-semibold tracking-tight text-white sm:text-5xl"
        />

        {/* Equity share as one proportional bar — faster to read than two bare
            numbers, and it makes a shrinking share visible at a glance. */}
        <div className="mt-5 h-1.5 w-full overflow-hidden rounded-full bg-white/15">
          <div
            className="h-full origin-left rounded-full bg-gradient-to-r from-pos-500 to-brand-400"
            style={{ width: `${equityShare}%`, animation: 'grow .9s cubic-bezier(.16,1,.3,1) both' }}
          />
        </div>

        <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm">
          <span className="text-white/70">
            Assets <span className="tnum font-semibold text-white">{fmt(assets)}</span>
          </span>
          <span className="text-white/70">
            Liabilities <span className="tnum font-semibold text-white">{fmt(liabilities)}</span>
          </span>
        </div>
      </div>
    </div>
  )
}
