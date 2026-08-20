import { useState } from 'react'
import { EVENT_KINDS } from '../lib/forecastEvents'

function eventIcon(kind) {
  return EVENT_KINDS.find((k) => k.value === kind)?.icon ?? '📌'
}

/**
 * Projected net worth over time, with life-event markers along the line —
 * Accounts → Forecast (Taskiv #24). `points` is `projectNetWorth`'s output:
 * `[{ date, netWorth, events }]`, monthly, chronological.
 *
 * Markers are clickable rather than draggable: dragging a pin to a new date
 * needs live pointer tracking and re-snapping against the month grid, which
 * is a lot of extra interaction surface for a number that's an estimate to
 * begin with. Click-to-edit (open the same form used to create the event,
 * pre-filled) gets the same outcome — move an event's date — in one more
 * tap. Worth upgrading later if it turns out to matter.
 */
export default function ForecastChart({ points, formatValue, onEventClick, height = 280 }) {
  const [hover, setHover] = useState(null)

  if (points.length === 0) {
    return <p className="py-10 text-center text-sm text-ink-500">Nothing to project yet.</p>
  }

  const width = 900
  const padY = 20
  const values = points.map((p) => p.netWorth)
  const min = Math.min(...values, 0)
  const max = Math.max(...values, 0)
  const span = max - min || Math.max(Math.abs(max) * 0.1, 1)
  const lo = min - span * 0.05
  const hi = max + span * 0.05

  const x = (i) => (points.length === 1 ? width / 2 : (i / (points.length - 1)) * width)
  const y = (v) => height - padY - ((v - lo) / (hi - lo)) * (height - padY * 2)

  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i)} ${y(p.netWorth)}`).join(' ')
  const area = `${line} L ${x(points.length - 1)} ${height} L ${x(0)} ${height} Z`

  const eventPoints = points.map((p, i) => ({ i, events: p.events })).filter((p) => p.events.length > 0)

  const activeIndex = hover !== null ? hover : points.length - 1
  const active = points[activeIndex]

  return (
    <div>
      <div className="mb-1 flex h-8 items-baseline gap-2">
        <span className="tnum text-lg font-semibold text-ink-900">{formatValue(active.netWorth)}</span>
        <span className="text-xs text-ink-400">{monthLabel(active.date)}</span>
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
            <linearGradient id="forecastFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--color-brand-500)" stopOpacity="0.18" />
              <stop offset="100%" stopColor="var(--color-brand-500)" stopOpacity="0" />
            </linearGradient>
          </defs>

          {/* Zero line, only drawn when the projection actually crosses it. */}
          {min < 0 && max > 0 && (
            <line x1="0" x2={width} y1={y(0)} y2={y(0)} stroke="var(--color-ink-300)" strokeWidth="1" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
          )}

          <path d={area} fill="url(#forecastFill)" />
          <path d={line} fill="none" stroke="var(--color-brand-500)" strokeWidth="2.5" vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round" />

          {points.map((p, i) => (
            <rect
              key={p.date}
              x={x(i) - width / Math.max(points.length, 2) / 2}
              y="0"
              width={width / Math.max(points.length, 2)}
              height={height}
              fill="transparent"
              onMouseEnter={() => setHover(i)}
            />
          ))}

          {eventPoints.map(({ i, events }) => (
            <g key={i}>
              <line x1={x(i)} x2={x(i)} y1="0" y2={height} stroke="var(--color-amber-400, #fbbf24)" strokeWidth="1.5" strokeDasharray="4 3" vectorEffect="non-scaling-stroke" />
              {events.map((ev, j) => (
                <g
                  key={ev.id ?? j}
                  transform={`translate(${x(i)}, ${16 + j * 22})`}
                  className="cursor-pointer"
                  onClick={() => onEventClick?.(ev)}
                >
                  <circle r="9" fill="var(--color-surface)" stroke="var(--color-amber-400, #fbbf24)" strokeWidth="1.5" />
                  <text textAnchor="middle" dominantBaseline="central" fontSize="10">
                    {eventIcon(ev.kind)}
                  </text>
                </g>
              ))}
            </g>
          ))}

          <circle cx={x(activeIndex)} cy={y(active.netWorth)} r="4" fill="var(--color-surface)" stroke="var(--color-brand-500)" strokeWidth="2.5" vectorEffect="non-scaling-stroke" />
        </svg>
      </div>

      <div className="mt-1 flex justify-between text-[11px] text-ink-400">
        <span>{monthLabel(points[0].date)}</span>
        <span>{monthLabel(points[points.length - 1].date)}</span>
      </div>
    </div>
  )
}

function monthLabel(iso) {
  const [y, m] = iso.split('-')
  return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })
}
