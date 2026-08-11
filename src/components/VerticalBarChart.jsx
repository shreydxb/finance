import { useState } from 'react'

/**
 * Chronological vertical bars — a time series, unlike BreakdownBars' Bars
 * (which sorts by magnitude for a categorical comparison, not by time).
 * Plain SVG, matching LineChart's style and no-library approach.
 *
 * `points` is [{ label, value }] in chronological order.
 */
export default function VerticalBarChart({ points, formatValue, height = 220 }) {
  const [hover, setHover] = useState(null)

  if (points.length === 0) {
    return <p className="py-10 text-center text-sm text-ink-500">Nothing to show yet.</p>
  }

  const maxAbs = Math.max(1, ...points.map((p) => Math.abs(p.value)))
  const active = hover !== null ? points[hover] : null
  const barGapPct = 28 // gap between bars as a % of each bar's slot

  return (
    <div>
      <div className="mb-1 flex h-5 items-baseline gap-2">
        {active && (
          <>
            <span className="tnum text-sm font-semibold text-ink-900">{formatValue(active.value)}</span>
            <span className="text-xs text-ink-400">{active.label}</span>
          </>
        )}
      </div>

      <div className="flex items-end gap-[2%]" style={{ height }} onMouseLeave={() => setHover(null)}>
        {points.map((p, i) => {
          const pct = (Math.abs(p.value) / maxAbs) * 100
          const dimmed = hover !== null && hover !== i
          return (
            <div
              key={p.label + i}
              className="flex h-full flex-1 flex-col justify-end"
              onMouseEnter={() => setHover(i)}
            >
              <div
                className="w-full rounded-t-md transition-opacity duration-200"
                style={{
                  height: `${Math.max(pct, 2)}%`,
                  backgroundColor: 'var(--color-brand-500)',
                  opacity: dimmed ? 0.35 : 1,
                  marginInline: `${barGapPct / 2}%`,
                  width: `${100 - barGapPct}%`,
                  transformOrigin: 'bottom',
                  animation: 'grow-y 0.6s cubic-bezier(0.16, 1, 0.3, 1) both',
                  animationDelay: `${Math.min(i * 60, 400)}ms`,
                }}
              />
            </div>
          )
        })}
      </div>

      <div className="mt-1 flex gap-[2%] text-[11px] text-ink-400">
        {points.map((p, i) => (
          <span key={p.label + i} className="flex-1 truncate text-center">
            {p.label}
          </span>
        ))}
      </div>
    </div>
  )
}
