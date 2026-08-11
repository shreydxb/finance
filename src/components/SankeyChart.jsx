import { useState } from 'react'

/**
 * A 3-column Sankey: sources → a single hub node → destinations. Built for
 * "where did the money come from, and where did it go" — the shape Monarch's
 * Cash Flow report uses, and the one Shrey specifically asked for.
 *
 * Not a general Sankey (no N-column DAG, no cycles) — three fixed columns is
 * all this app's income→spend flow needs, and a real graph-layout Sankey is a
 * lot of code for a shape this data never actually takes.
 *
 * `sources` / `destinations`: [{ key, label, value, color }]. `hubLabel` /
 * `hubValue` describe the middle node (normally "Income", total inflow).
 */
export default function SankeyChart({ sources, destinations, hubLabel, hubValue, formatValue, height = 380, onSourceClick, onDestClick }) {
  const [hover, setHover] = useState(null) // { side: 'source'|'dest', key }

  if (sources.length === 0 && destinations.length === 0) {
    return <p className="py-10 text-center text-sm text-ink-500">Nothing to show for this period yet.</p>
  }

  // Label columns need real room outside the node area, and the hub's own
  // label/value text needs vertical room too — without these margins, text
  // clips against the viewBox edge whenever a node fills most of the height.
  const padX = 170
  const padTop = 30
  const padBottom = 30
  const plotW = 900
  const nodeW = 14
  const gapY = 6

  const totalW = plotW + padX * 2
  const totalH = height + padTop + padBottom
  const colX = { source: padX, hub: padX + plotW / 2 - nodeW / 2, dest: padX + plotW - nodeW }

  const sourceTotal = sources.reduce((s, n) => s + n.value, 0) || 1
  const destTotal = destinations.reduce((s, n) => s + n.value, 0) || 1
  const hub = hubValue ?? sourceTotal

  function layout(nodes, total) {
    const usableH = height - gapY * Math.max(0, nodes.length - 1)
    let y = padTop
    return nodes.map((n) => {
      const h = Math.max(2, (n.value / total) * usableH)
      const node = { ...n, y, h }
      y += h + gapY
      return node
    })
  }

  const sourceNodes = layout(sources, sourceTotal)
  const destNodes = layout(destinations, destTotal)
  const hubH = Math.max(2, (hub / Math.max(sourceTotal, destTotal, 1)) * height)
  const hubY = padTop + (height - hubH) / 2

  // Ribbon = cubic-bezier band between two verticals of given widths, using
  // two mirrored curves so the band's thickness reads as the flow's size.
  function ribbon(x1, y1a, y1b, x2, y2a, y2b) {
    const mx = (x1 + x2) / 2
    return `M ${x1} ${y1a} C ${mx} ${y1a} ${mx} ${y2a} ${x2} ${y2a} L ${x2} ${y2b} C ${mx} ${y2b} ${mx} ${y1b} ${x1} ${y1b} Z`
  }

  // Source → hub ribbons, stacked to match each source's slice of the hub.
  let hubCursorIn = hubY
  const sourceLinks = sourceNodes.map((n) => {
    const frac = n.value / sourceTotal
    const h = hubH * frac
    const link = { key: n.key, color: n.color, y1a: n.y, y1b: n.y + n.h, y2a: hubCursorIn, y2b: hubCursorIn + h }
    hubCursorIn += h
    return link
  })

  // Hub → destination ribbons.
  let hubCursorOut = hubY
  const destLinks = destNodes.map((n) => {
    const frac = n.value / destTotal
    const h = hubH * frac
    const link = { key: n.key, color: n.color, y1a: hubCursorOut, y1b: hubCursorOut + h, y2a: n.y, y2b: n.y + n.h }
    hubCursorOut += h
    return link
  })

  function dim(side, key) {
    if (!hover) return false
    return !(hover.side === side && hover.key === key)
  }

  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${totalW} ${totalH}`} className="w-full" style={{ minWidth: 720, height: totalH }}>
        {sourceLinks.map((l) => (
          <path
            key={l.key}
            d={ribbon(colX.source + nodeW, l.y1a, l.y1b, colX.hub, l.y2a, l.y2b)}
            fill={l.color}
            opacity={dim('source', l.key) ? 0.12 : 0.32}
            className="transition-opacity duration-200"
          />
        ))}
        {destLinks.map((l) => (
          <path
            key={l.key}
            d={ribbon(colX.hub + nodeW, l.y1a, l.y1b, colX.dest, l.y2a, l.y2b)}
            fill={l.color}
            opacity={dim('dest', l.key) ? 0.12 : 0.32}
            className="transition-opacity duration-200"
          />
        ))}

        {/* Hub node */}
        <rect x={colX.hub} y={hubY} width={nodeW} height={hubH} rx="3" fill="var(--color-ink-700)" />
        <text x={colX.hub + nodeW / 2} y={hubY - 10} textAnchor="middle" className="fill-ink-900 text-[13px] font-semibold">
          {hubLabel}
        </text>
        <text x={colX.hub + nodeW / 2} y={hubY + hubH + 18} textAnchor="middle" className="tnum fill-ink-500 text-[11px]">
          {formatValue(hub)}
        </text>

        {sourceNodes.map((n) => (
          <g
            key={n.key}
            onMouseEnter={() => setHover({ side: 'source', key: n.key })}
            onMouseLeave={() => setHover(null)}
            onClick={onSourceClick ? () => onSourceClick(n) : undefined}
            className={onSourceClick ? 'cursor-pointer' : 'cursor-default'}
          >
            <rect x={colX.source} y={n.y} width={nodeW} height={n.h} rx="3" fill={n.color} opacity={dim('source', n.key) ? 0.4 : 1} />
            <text x={colX.source - 8} y={n.y + n.h / 2 - 6} textAnchor="end" className="fill-ink-700 text-[12px] font-medium">
              {n.label}
            </text>
            <text x={colX.source - 8} y={n.y + n.h / 2 + 8} textAnchor="end" className="tnum fill-ink-400 text-[11px]">
              {formatValue(n.value)}
            </text>
          </g>
        ))}

        {destNodes.map((n) => (
          <g
            key={n.key}
            onMouseEnter={() => setHover({ side: 'dest', key: n.key })}
            onMouseLeave={() => setHover(null)}
            onClick={onDestClick ? () => onDestClick(n) : undefined}
            className={onDestClick ? 'cursor-pointer' : 'cursor-default'}
          >
            <rect x={colX.dest} y={n.y} width={nodeW} height={n.h} rx="3" fill={n.color} opacity={dim('dest', n.key) ? 0.4 : 1} />
            <text x={colX.dest + nodeW + 8} y={n.y + n.h / 2 - 6} className="fill-ink-700 text-[12px] font-medium">
              {n.label}
            </text>
            <text x={colX.dest + nodeW + 8} y={n.y + n.h / 2 + 8} className="tnum fill-ink-400 text-[11px]">
              {formatValue(n.value)}
            </text>
          </g>
        ))}
      </svg>
    </div>
  )
}
