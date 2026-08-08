import { useState } from 'react'

/**
 * Categorical breakdown, as bars or a donut.
 *
 * Both variants share one `groups` shape and one legend, so switching between
 * them can't change what the numbers say — only how they're shaped. Bars are
 * the default because they compare magnitudes honestly at any count; the donut
 * is for part-of-whole reads (allocation) and is deliberately unavailable when
 * values are mixed-sign, where a "share of total" would be meaningless.
 */
export default function BreakdownBars({
  title,
  groups,
  tabs,
  activeTab,
  onTabChange,
  formatValue,
  emptyMessage,
  shape = 'bars',
  onShapeChange,
}) {
  const [hovered, setHovered] = useState(null)

  const hasNegative = groups.some((g) => g.value < 0)
  const total = groups.reduce((sum, g) => sum + Math.abs(g.value), 0)
  const canDonut = !hasNegative && groups.length > 1

  return (
    <div className="rounded-2xl border border-ink-200 bg-white p-5 shadow-card">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-ink-900">{title}</h2>
        <div className="flex items-center gap-2">
          {tabs && (
            <div className="flex rounded-lg bg-ink-100 p-0.5 text-xs">
              {tabs.map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => onTabChange(tab.key)}
                  className={`rounded-md px-2.5 py-1 font-medium transition-colors ${
                    activeTab === tab.key ? 'bg-white text-ink-900 shadow-card' : 'text-ink-500 hover:text-ink-700'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          )}
          {onShapeChange && canDonut && (
            <div className="flex rounded-lg bg-ink-100 p-0.5 text-xs">
              {[
                { key: 'bars', label: '▤', aria: 'Bar view' },
                { key: 'donut', label: '◕', aria: 'Donut view' },
              ].map((s) => (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => onShapeChange(s.key)}
                  aria-label={s.aria}
                  className={`rounded-md px-2 py-1 font-medium transition-colors ${
                    shape === s.key ? 'bg-white text-ink-900 shadow-card' : 'text-ink-500 hover:text-ink-700'
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {groups.length === 0 ? (
        <p className="py-6 text-center text-sm text-ink-500">{emptyMessage ?? 'Nothing to show yet.'}</p>
      ) : shape === 'donut' && canDonut ? (
        <Donut groups={groups} total={total} formatValue={formatValue} hovered={hovered} setHovered={setHovered} />
      ) : (
        <Bars groups={groups} formatValue={formatValue} hovered={hovered} setHovered={setHovered} />
      )}
    </div>
  )
}

function Bars({ groups, formatValue, hovered, setHovered }) {
  const maxAbs = Math.max(1, ...groups.map((g) => Math.abs(g.value)))

  return (
    <div className="space-y-3">
      {groups.map((g, i) => {
        const widthPct = (Math.abs(g.value) / maxAbs) * 100
        const dimmed = hovered !== null && hovered !== g.key
        return (
          <div
            key={g.key}
            onMouseEnter={() => setHovered(g.key)}
            onMouseLeave={() => setHovered(null)}
            className={`transition-opacity duration-200 ${dimmed ? 'opacity-40' : 'opacity-100'}`}
          >
            <div className="mb-1 flex items-center justify-between text-xs">
              <span className="flex items-center gap-1.5 font-medium text-ink-700">
                <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: g.color }} />
                {g.label}
              </span>
              <span className="tnum font-semibold text-ink-900">{formatValue(g.value)}</span>
            </div>
            <div className="h-2.5 w-full overflow-hidden rounded-full bg-ink-100">
              <div
                className="h-full origin-left rounded-full"
                style={{
                  width: `${widthPct}%`,
                  backgroundColor: g.color,
                  animation: 'grow 0.7s cubic-bezier(0.16, 1, 0.3, 1) both',
                  animationDelay: `${Math.min(i * 50, 300)}ms`,
                }}
              />
            </div>
          </div>
        )
      })}
    </div>
  )
}

/**
 * SVG donut. Arc lengths come from stroke-dasharray on one circle per slice —
 * no charting library, no layout maths, and it scales to any container.
 */
function Donut({ groups, total, formatValue, hovered, setHovered }) {
  const size = 180
  const stroke = 26
  const radius = (size - stroke) / 2
  const circumference = 2 * Math.PI * radius

  let offsetSoFar = 0
  const slices = groups.map((g) => {
    const fraction = total > 0 ? Math.abs(g.value) / total : 0
    const slice = { ...g, fraction, offset: offsetSoFar }
    offsetSoFar += fraction
    return slice
  })

  const active = hovered ? slices.find((s) => s.key === hovered) : null

  return (
    <div className="flex flex-col items-center gap-5 sm:flex-row">
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          {slices.map((s) => {
            const dimmed = hovered !== null && hovered !== s.key
            return (
              <circle
                key={s.key}
                cx={size / 2}
                cy={size / 2}
                r={radius}
                fill="none"
                stroke={s.color}
                strokeWidth={hovered === s.key ? stroke + 4 : stroke}
                strokeDasharray={`${s.fraction * circumference} ${circumference}`}
                strokeDashoffset={-s.offset * circumference}
                onMouseEnter={() => setHovered(s.key)}
                onMouseLeave={() => setHovered(null)}
                className="cursor-pointer transition-all duration-200"
                style={{ opacity: dimmed ? 0.35 : 1 }}
              />
            )
          })}
        </svg>
        {/* Centre reads the hovered slice, or the total when nothing is hovered. */}
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
          <span className="max-w-[100px] truncate text-[11px] font-medium text-ink-500">
            {active ? active.label : 'Total'}
          </span>
          <span className="tnum text-sm font-semibold text-ink-900">
            {formatValue(active ? active.value : total)}
          </span>
          {active && <span className="tnum text-[11px] text-ink-400">{(active.fraction * 100).toFixed(1)}%</span>}
        </div>
      </div>

      <ul className="min-w-0 flex-1 space-y-1.5">
        {slices.map((s) => (
          <li
            key={s.key}
            onMouseEnter={() => setHovered(s.key)}
            onMouseLeave={() => setHovered(null)}
            className={`flex items-center justify-between gap-2 text-xs transition-opacity duration-200 ${
              hovered !== null && hovered !== s.key ? 'opacity-40' : 'opacity-100'
            }`}
          >
            <span className="flex min-w-0 items-center gap-1.5 font-medium text-ink-700">
              <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: s.color }} />
              <span className="truncate">{s.label}</span>
            </span>
            <span className="tnum shrink-0 font-semibold text-ink-900">{formatValue(s.value)}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
