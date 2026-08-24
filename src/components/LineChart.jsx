import { useState } from 'react'

/**
 * Net-worth-over-time line chart. Plain SVG — no charting library, consistent
 * with the donut in BreakdownBars.
 *
 * `points` is [{ label, value }] in chronological order. `value: null` is a
 * truthful gap and breaks the line rather than being interpolated. A single point draws
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
  const validPoints = points.map((point, index) => ({ point, index })).filter(({ point }) => point.value !== null)
  if (validPoints.length === 0) {
    return <p className="py-10 text-center text-sm text-ink-500">History has gaps but no published values in this window.</p>
  }
  const values = validPoints.map(({ point }) => point.value)
  const min = Math.min(...values)
  const max = Math.max(...values)
  // A flat series would divide by zero; give it a nominal band so the line
  // sits in the middle rather than collapsing onto an edge.
  const span = max - min || Math.max(Math.abs(max) * 0.1, 1)
  const lo = min - span * 0.1
  const hi = max + span * 0.1

  const x = (i) => (points.length === 1 ? width / 2 : (i / (points.length - 1)) * width)
  const y = (v) => height - padY - ((v - lo) / (hi - lo)) * (height - padY * 2)

  const segments = []
  let segment = []
  for (let index = 0; index < points.length; index += 1) {
    if (points[index].value === null) {
      if (segment.length) segments.push(segment)
      segment = []
    } else segment.push({ point: points[index], index })
  }
  if (segment.length) segments.push(segment)

  const defaultIndex = validPoints.at(-1).index
  const activeIndex = hover ?? defaultIndex
  const active = points[activeIndex]
  const rising = validPoints.length > 1 && validPoints.at(-1).point.value >= validPoints[0].point.value

  return (
    <div>
      {/* A hover readout, not a headline — the card above already shows the
          current figure, and printing it twice just reads as a mistake. The
          row is always present so the chart doesn't jump on hover. */}
      <div className="mb-1 flex h-5 items-baseline gap-2">
        {hover !== null && (
          <>
            <span className="tnum text-sm font-semibold text-ink-900">
              {active.value === null ? (active.statusLabel ?? 'Gap') : formatValue(active.value)}
            </span>
            <span className="text-xs text-ink-400">{active.label}{active.statusLabel && active.value !== null ? ` · ${active.statusLabel}` : ''}</span>
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

          {segments.map((entries, segmentIndex) => {
            if (entries.length < 2) return null
            const line = entries.map(({ point, index }, entryIndex) => `${entryIndex === 0 ? 'M' : 'L'} ${x(index)} ${y(point.value)}`).join(' ')
            return (
              <path
                key={`segment-${segmentIndex}`}
                d={line}
                fill="none"
                stroke={rising ? 'var(--color-pos-500)' : 'var(--color-neg-500)'}
                strokeWidth="2.5"
                vectorEffect="non-scaling-stroke"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            )
          })}

          {validPoints.map(({ point, index }) => (
            <circle
              key={`point-${point.label}-${index}`}
              cx={x(index)}
              cy={y(point.value)}
              r={point.status === 'provisional' || point.status === 'legacy' ? 3.5 : 2.5}
              fill={point.status === 'provisional' ? 'var(--color-amber-500)' : point.status === 'legacy' ? 'var(--color-ink-400)' : 'var(--color-surface)'}
              stroke={rising ? 'var(--color-pos-500)' : 'var(--color-neg-500)'}
              strokeWidth="1.5"
              vectorEffect="non-scaling-stroke"
            />
          ))}

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

          {active.value !== null && <circle
            cx={x(activeIndex)}
            cy={y(active.value)}
            r="4"
            fill="var(--color-surface)"
            stroke={rising ? 'var(--color-pos-500)' : 'var(--color-neg-500)'}
            strokeWidth="2.5"
            vectorEffect="non-scaling-stroke"
          />}
        </svg>
      </div>

      <div className="mt-1 flex justify-between text-[11px] text-ink-400">
        <span>{points[0].label}</span>
        {points.length > 1 && <span>{points[points.length - 1].label}</span>}
      </div>
    </div>
  )
}
