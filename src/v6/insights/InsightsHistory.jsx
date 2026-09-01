import { Section } from '../primitives/Section'
import { UnavailableRegion } from '../primitives/Slot'
import { formatAed, formatMonthShort } from '../format'

function HistoryTable({ history }) {
  return (
    <div className="v6-insights-table-scroll" tabIndex={0} role="region" aria-label="Published monthly facts table">
      <table className="v6-data-table v6-insights-history-table">
        <caption className="v6-visually-hidden">
          Posted income and consumption spend published for each completed calendar month. No trend or comparison is calculated.
        </caption>
        <thead>
          <tr>
            <th scope="col">Month</th>
            <th scope="col" className="v6-numeric">Consumption spend (AED)</th>
            <th scope="col" className="v6-numeric">Posted income (AED)</th>
            <th scope="col">Quality</th>
          </tr>
        </thead>
        <tbody>
          {history.rows.map((row) => (
            <tr key={row.key}>
              <th scope="row">{row.range.label}</th>
              <td className="v6-numeric">{row.spend.status === 'available' ? formatAed(row.spend.value) : row.spend.status}</td>
              <td className="v6-numeric">{row.income.status === 'available' ? formatAed(row.income.value) : row.income.status}</td>
              <td>{row.quality ?? 'Not read'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function HistoryDrawing({ history }) {
  if (!history.geometry.drawable) {
    return (
      <div className="v6-unavailable" role="note">
        <p className="v6-unavailable-label">Monthly drawing is not available.</p>
        <p className="v6-unavailable-detail">{history.reason}</p>
      </div>
    )
  }
  return (
    <div className="v6-insights-history-drawing" aria-hidden="true">
      <div className="v6-chart-plot">
        <div className="v6-chart-grid" data-line="top" />
        <div className="v6-chart-grid" data-line="mid" />
        <div className="v6-chart-grid" data-line="base" />
        <div className="v6-chart-columns">
          {history.geometry.bars.map((bar) => (
            <div key={bar.key} className="v6-chart-column">
              <span className="v6-chart-bar" data-series="spend" style={{ height: `${(bar.spend * 100).toFixed(2)}%` }} />
              <span className="v6-chart-bar" data-series="income" style={{ height: `${(bar.income * 100).toFixed(2)}%` }} />
            </div>
          ))}
        </div>
      </div>
      <ul className="v6-chart-labels">
        {history.rows.map((row) => <li key={row.key}><span className="v6-chart-label">{formatMonthShort(row.range.from)}</span></li>)}
      </ul>
      <ul className="v6-chart-legend">
        <li><span className="v6-legend-swatch" data-series="spend" />Consumption spend</li>
        <li><span className="v6-legend-swatch" data-series="income" />Posted income</li>
      </ul>
    </div>
  )
}

export default function InsightsHistory({ model }) {
  return (
    <div className="v6-enter">
      <Section
        className="v6-section-lg"
        kicker="Published monthly facts"
        note={`Six completed months before ${model.period.label}`}
      >
        <p className="v6-unavailable-detail">
          Each amount is one canonical_period_metrics result. Bar height is drawing-only geometry relative to the largest published amount; it exposes no percentage, average or trend claim.
        </p>
        <HistoryDrawing history={model.history} />
        <HistoryTable history={model.history} />
        <div className="v6-insights-gap">
          <UnavailableRegion slot={model.gaps.categoryTrend} inline />
        </div>
        <div className="v6-insights-gap">
          <UnavailableRegion slot={model.gaps.explanation} inline />
        </div>
      </Section>
    </div>
  )
}
