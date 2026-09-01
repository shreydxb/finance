import { Section } from '../primitives/Section'
import { formatAed, formatMonthShort, formatPercent } from '../format'

const QUALITY_LABELS = {
  complete: 'Complete',
  provisional: 'Provisional',
  incomplete: 'Incomplete',
}

function DataTable({ columns }) {
  return (
    <details className="v6-data-toggle">
      <summary>Cash-flow data table</summary>
      <div className="v6-data-scroll" tabIndex={0} role="region" aria-label="Cash-flow data table">
        <table className="v6-data-table">
          <caption className="v6-visually-hidden">
            Posted income, consumption spend and savings rate for each completed month, from the canonical period contract.
          </caption>
          <thead>
            <tr>
              <th scope="col">Month</th>
              <th scope="col" className="v6-numeric">Income (AED)</th>
              <th scope="col" className="v6-numeric">Spend (AED)</th>
              <th scope="col" className="v6-numeric">Savings rate</th>
              <th scope="col">Quality</th>
            </tr>
          </thead>
          <tbody>
            {columns.map((column) => (
              <tr key={column.key}>
                <th scope="row">{formatMonthShort(column.from)} {column.from.slice(0, 4)}</th>
                <td className="v6-numeric">{formatAed(column.income) ?? 'Incomplete'}</td>
                <td className="v6-numeric">{formatAed(column.spend) ?? 'Incomplete'}</td>
                <td className="v6-numeric">{formatPercent(column.rate) ?? 'Unavailable'}</td>
                <td>{column.note ?? QUALITY_LABELS[column.quality] ?? 'Not read'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  )
}

/**
 * Cash-flow composition and the savings-rate series.
 *
 * Every column is one `canonical_period_metrics` read over one completed
 * calendar month. Bar heights and the polyline are drawing geometry derived in
 * `overviewModel.js`; a month whose canonical inputs are incomplete draws no
 * bar and breaks the line rather than drawing a false slope to zero.
 */
export default function CashFlowSection({ cashFlow, monthsLabel }) {
  const { status, reason, columns, geometry } = cashFlow

  if (status !== 'available') {
    return (
      <Section kicker="Cash flow" note={monthsLabel}>
        <div className="v6-unavailable" role="note">
          <p className="v6-unavailable-label">Cash-flow series is not available.</p>
          <p className="v6-unavailable-detail">{reason}</p>
        </div>
        {columns.length ? <DataTable columns={columns} /> : null}
      </Section>
    )
  }

  const axisTop = formatAed(geometry.peak)
  const axisMid = formatAed(geometry.peak / 2)

  return (
    <Section kicker="Cash flow" note={monthsLabel}>
      <div className="v6-chart">
        <div className="v6-chart-axis" aria-hidden="true">
          <span>{axisTop}</span>
          <span>{axisMid}</span>
          <span>0</span>
        </div>
        <div className="v6-chart-body">
          <div className="v6-chart-plot" aria-hidden="true">
            <div className="v6-chart-grid" data-line="top" />
            <div className="v6-chart-grid" data-line="mid" />
            <div className="v6-chart-grid" data-line="base" />
            <div className="v6-chart-columns">
              {geometry.bars.map((bar) => (
                <div key={bar.key} className="v6-chart-column">
                  {bar.income === null ? null : (
                    <span className="v6-chart-bar" data-series="income" style={{ height: `${(bar.income * 100).toFixed(2)}%` }} />
                  )}
                  {bar.spend === null ? null : (
                    <span className="v6-chart-bar" data-series="spend" style={{ height: `${(bar.spend * 100).toFixed(2)}%` }} />
                  )}
                </div>
              ))}
            </div>
            {geometry.polyline ? (
              <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="v6-chart-line" focusable="false">
                <polyline points={geometry.polyline} vectorEffect="non-scaling-stroke" />
              </svg>
            ) : null}
          </div>
          <ul className="v6-chart-labels" aria-hidden="true">
            {columns.map((column) => (
              <li key={column.key}>
                <span className="v6-chart-label">{formatMonthShort(column.from)}</span>
                <span className="v6-chart-sublabel">{formatPercent(column.rate) ?? '—'}</span>
              </li>
            ))}
          </ul>
          <ul className="v6-chart-legend">
            <li><span className="v6-legend-swatch" data-series="income" aria-hidden="true" />Income</li>
            <li><span className="v6-legend-swatch" data-series="spend" aria-hidden="true" />Spend</li>
            <li><span className="v6-legend-swatch" data-series="rate" aria-hidden="true" />Savings rate</li>
          </ul>
        </div>
      </div>
      <DataTable columns={columns} />
    </Section>
  )
}
