import { useState } from 'react'
import { CHART_PALETTE } from '../lib/chartPalette'

/**
 * Two cumulative daily series overlaid on one chart — Reports → Spending's
 * "this period vs a comparison period" view (Taskiv #103). `points` is
 * `[{ dayLabel, current, comparison }]` in day-offset order; either value can
 * be `null` where that series has no data yet (the current period hasn't
 * reached that day) or no longer (an average-month window edge) — a `null`
 * breaks the line rather than drawing it down to zero.
 *
 * The comparison series is drawn as a dashed neutral line rather than a
 * second categorical hue: it's a reference, not a competing identity, the
 * same way a budget line or an average line reads in this app elsewhere.
 */
export default function ComparisonChart({ points, currentLabel, comparisonLabel, formatValue, height = 260 }) {
  const [hover, setHover] = useState(null)

  if (points.length === 0) {
    return <p className="py-10 text-center text-sm text-ink-500">Nothing to compare yet.</p>
  }

  const width = 800
  const padY = 16
  const values = points.flatMap((p) => [p.current, p.comparison]).filter((v) => v !== null)
  const max = values.length ? Math.max(...values, 0) : 1
  const hi = max === 0 ? 1 : max * 1.1

  const x = (i) => (points.length === 1 ? width / 2 : (i / (points.length - 1)) * width)
  const y = (v) => height - padY - (v / hi) * (height - padY * 2)

  const pathFor = (key) => segmentPaths(points, key, x, y)
  const currentPaths = pathFor('current')
  const comparisonPaths = pathFor('comparison')
  const currentArea = currentPaths.length
    ? currentPaths.map(({ d, startI, endI }) => `${d} L ${x(endI)} ${height} L ${x(startI)} ${height} Z`).join(' ')
    : ''

  const activeIndex = hover !== null ? hover : points.length - 1
  const active = points[activeIndex]
  const currentColor = CHART_PALETTE[0]

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-4 text-xs">
        <Legend swatch={<span className="inline-block h-0.5 w-4 rounded-full" style={{ backgroundColor: currentColor }} />} label={currentLabel} />
        <Legend swatch={<DashedSwatch />} label={comparisonLabel} />
      </div>

      <div className="mb-1 flex h-10 flex-col justify-center">
        <span className="text-xs text-ink-400">{active.dayLabel}</span>
        <div className="flex gap-4 text-sm">
          <span className="tnum font-semibold" style={{ color: currentColor }}>
            {currentLabel}: {active.current === null ? '—' : formatValue(active.current)}
          </span>
          <span className="tnum font-semibold text-ink-500">
            {comparisonLabel}: {active.comparison === null ? '—' : formatValue(active.comparison)}
          </span>
        </div>
      </div>

      <div className="relative">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          preserveAspectRatio="none"
          className="w-full"
          style={{ height }}
          onMouseLeave={() => setHover(null)}
        >
          <defs>
            <linearGradient id="comparisonFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={currentColor} stopOpacity="0.18" />
              <stop offset="100%" stopColor={currentColor} stopOpacity="0" />
            </linearGradient>
          </defs>

          {currentArea && <path d={currentArea} fill="url(#comparisonFill)" />}

          {comparisonPaths.map(({ d, startI }) => (
            <path
              key={`cmp-${startI}`}
              d={d}
              fill="none"
              stroke="var(--color-ink-400)"
              strokeWidth="2"
              strokeDasharray="5 4"
              vectorEffect="non-scaling-stroke"
              strokeLinecap="round"
            />
          ))}

          {currentPaths.map(({ d, startI }) => (
            <path
              key={`cur-${startI}`}
              d={d}
              fill="none"
              stroke={currentColor}
              strokeWidth="2.5"
              vectorEffect="non-scaling-stroke"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ))}

          {/* One hoverable band per day, spanning the full chart height. */}
          {points.map((p, i) => (
            <rect
              key={p.dayLabel + i}
              x={x(i) - width / Math.max(points.length, 2) / 2}
              y="0"
              width={width / Math.max(points.length, 2)}
              height={height}
              fill="transparent"
              onMouseEnter={() => setHover(i)}
            />
          ))}

          {hover !== null && <line x1={x(hover)} x2={x(hover)} y1="0" y2={height} stroke="var(--color-ink-300)" strokeWidth="1" vectorEffect="non-scaling-stroke" />}

          {active.current !== null && (
            <circle cx={x(activeIndex)} cy={y(active.current)} r="4" fill="var(--color-surface)" stroke={currentColor} strokeWidth="2.5" vectorEffect="non-scaling-stroke" />
          )}
          {active.comparison !== null && (
            <circle cx={x(activeIndex)} cy={y(active.comparison)} r="4" fill="var(--color-surface)" stroke="var(--color-ink-400)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
          )}
        </svg>
      </div>

      <div className="mt-1 flex justify-between text-[11px] text-ink-400">
        <span>{points[0].dayLabel}</span>
        {points.length > 1 && <span>{points[points.length - 1].dayLabel}</span>}
      </div>
    </div>
  )
}

/**
 * Splits `points` into contiguous runs where `key` is non-null, so a gap
 * (today onward for the current series, or an average-window edge) breaks
 * the line instead of drawing a false slope down to zero.
 */
function segmentPaths(points, key, x, y) {
  const segments = []
  let current = null
  points.forEach((p, i) => {
    const v = p[key]
    if (v === null) {
      current = null
      return
    }
    if (!current) {
      current = { d: `M ${x(i)} ${y(v)}`, startI: i, endI: i }
      segments.push(current)
    } else {
      current.d += ` L ${x(i)} ${y(v)}`
      current.endI = i
    }
  })
  return segments
}

function Legend({ swatch, label }) {
  return (
    <span className="flex items-center gap-1.5 text-ink-500">
      {swatch}
      {label}
    </span>
  )
}

function DashedSwatch() {
  return (
    <svg width="16" height="2" className="shrink-0">
      <line x1="0" y1="1" x2="16" y2="1" stroke="var(--color-ink-400)" strokeWidth="2" strokeDasharray="4 3" />
    </svg>
  )
}
