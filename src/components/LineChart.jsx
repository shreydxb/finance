import { useState } from 'react'

/**
 * Net-worth-over-time line chart. Plain SVG — no charting library, consistent
 * with the donut in BreakdownBars.
 *
 * `points` is [{ label, value }] in chronological order. A single point draws
 * a dot rather than a line, because one observation is not a trend and drawing
 * it as a flat line would imply history that doesn't exist.
 */
export default function LineChart({ points, formatValue, height = 200 }) {
  const [hover, setHover] = useState(null)

  if (points.length === 0) {
    return (
      <p className="py-10 text-center text-sm text-ink-500">
        No history recorded yet — it starts building from today.
      </p>
    )
  }

  const width = 800 // viewBox units; the SVG scales to its container
  const padY = 16
  const values = points.map((p) => p.value)
  const min = Math.min(...values)
  const max = Math.max(...values)
  // A flat series would divide by zero; give it a nominal band so the line
  // sits in the middle rather than collapsing onto an edge.
  const span = max - min || Math.max(Math.abs(max) * 0.1, 1)
  const lo = min - span * 0.1
  const hi = max + span * 0.1

  const x = (i) => (points.length === 1 ? width / 2 : (i / (points.length - 1)) * width)
  const y = (v) => height - padY - ((v - lo) / (hi - lo)) * (height - padY * 2)

  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i)} ${y(p.value)}`).join(' ')
  const area = `${line} L ${x(points.length - 1)} ${height} L ${x(0)} ${height} Z`

  const active = hover !== null ? points[hover] : points[points.length - 1]
  const rising = points.length > 1 && points[points.length - 1].value >= points[0].value

  return (
    <div>
      {/* A hover readout, not a headline — the card above already shows the
          current figure, and printing it twice just reads as a mistake. The
          row is always present so the chart doesn't jump on hover. */}
      <div className="mb-1 flex h-5 items-baseline gap-2">
        {hover !== null && (
          <>
            <span className="tnum text-sm font-semibold text-ink-900">{formatValue(active.value)}</span>
            <span className="text-xs text-ink-400">{active.label}</span>
          </>
        )}
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
            <linearGradient id="nwFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={rising ? 'var(--color-pos-500)' : 'var(--color-neg-500)'} stopOpacity="0.22" />
              <stop offset="100%" stopColor={rising ? 'var(--color-pos-500)' : 'var(--color-neg-500)'} stopOpacity="0" />
            </linearGradient>
          </defs>

          {points.length > 1 && (
            <>
              <path d={area} fill="url(#nwFill)" />
              <path
                d={line}
                fill="none"
                stroke={rising ? 'var(--color-pos-500)' : 'var(--color-neg-500)'}
                strokeWidth="2.5"
                vectorEffect="non-scaling-stroke"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </>
          )}

          {/* Invisible full-height bands make the whole chart hoverable, not
              just the 2px line itself. */}
          {points.map((p, i) => (
            <rect
              key={p.label + i}
              x={x(i) - width / Math.max(points.length, 2) / 2}
              y="0"
              width={width / Math.max(points.length, 2)}
              height={height}
              fill="transparent"
              onMouseEnter={() => setHover(i)}
            />
          ))}

          <circle
            cx={x(hover !== null ? hover : points.length - 1)}
            cy={y(active.value)}
            r="4"
            fill="var(--color-surface)"
            stroke={rising ? 'var(--color-pos-500)' : 'var(--color-neg-500)'}
            strokeWidth="2.5"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      </div>

      <div className="mt-1 flex justify-between text-[11px] text-ink-400">
        <span>{points[0].label}</span>
        {points.length > 1 && <span>{points[points.length - 1].label}</span>}
      </div>
    </div>
  )
}
