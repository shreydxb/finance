import { FigureSlot, UnavailableRegion } from '../primitives/Slot'
import { formatAed } from '../format'

/**
 * The prototype's year grid: categories down, twelve months across, Total and
 * Avg on the right.
 *
 * Every cell is one canonical monthly read — `canonical_budget_actuals` for
 * that month, that label. The grid navigates monthly versions; it never
 * collapses them. So the Total and Avg columns, the income rows the prototype
 * opens with, its planned Sep–Dec cells and its Net saved line are all slots
 * naming their contracts rather than sums computed across the row.
 *
 * A cell for a label the contract did not report in a month is an em dash
 * meaning "no canonical consumption spend recorded", not a zero the household
 * can read as "nothing was spent" and not a plan of nothing.
 */
export default function BudgetYearGrid({ model }) {
  const { year, period, gaps } = model

  if (!year || year.status === 'unavailable' || year.status === 'empty') {
    return (
      <section aria-labelledby="v6-budget-year-heading" className="v6-section">
        <h2 id="v6-budget-year-heading" className="v6-kicker-text">Categories by month · {period.label}</h2>
        <div className="v6-unavailable" role="note" style={{ marginTop: '16px' }}>
          <p className="v6-unavailable-label">
            {year?.status === 'empty' ? 'No category spending in this year.' : 'Category actuals are not available.'}
          </p>
          <p className="v6-unavailable-detail">{year?.reason ?? 'The canonical actuals contract has not been read.'}</p>
        </div>
      </section>
    )
  }

  return (
    <section aria-labelledby="v6-budget-year-heading" className="v6-section">
      <h2 id="v6-budget-year-heading" className="v6-kicker-text">Categories by month · {period.label}</h2>

      <div className="v6-budget-scroll" role="region" aria-label="Budget categories by month" tabIndex={0}>
        <table className="v6-budget-year-table">
          <caption className="v6-visually-hidden">
            Canonical category actuals for each month of {period.label}, read one month at a time. An em dash means the
            canonical contract reported no consumption spend for that label in that month. Total and average columns
            have no canonical source and are reported as not available.
          </caption>
          <thead>
            <tr>
              <th scope="col">Category</th>
              {year.months.map((month) => (
                <th
                  key={month.key}
                  scope="col"
                  className="v6-col-month"
                  data-current={month.isCurrentMonth ? 'true' : undefined}
                >
                  <abbr title={month.label}>{month.short}</abbr>
                </th>
              ))}
              <th scope="col" className="v6-col-plan" aria-describedby="v6-budget-year-gap">Total</th>
              <th scope="col" className="v6-col-plan" aria-describedby="v6-budget-year-gap">Avg</th>
            </tr>
          </thead>
          <tbody>
            {year.rows.map((row) => (
              <tr key={row.key}>
                <th scope="row" style={{ fontWeight: 400 }}>
                  {row.label}
                  {row.isUncategorised ? (
                    <span className="v6-budget-category-meta">No category recorded on these entries</span>
                  ) : null}
                </th>
                {row.cells.map((cell) => (
                  <td key={cell.key} className="v6-col-month">
                    {cell.slot === null ? (
                      <span className="v6-tone-muted" title={`No canonical consumption spend reported for ${row.label} in ${cell.month.label}`}>
                        <span aria-hidden="true">—</span>
                        <span className="v6-visually-hidden">Not reported</span>
                      </span>
                    ) : (
                      <FigureSlot slot={cell.slot} format={(value) => formatAed(value)} />
                    )}
                  </td>
                ))}
                <td className="v6-col-plan"><FigureSlot slot={row.total} /></td>
                <td className="v6-col-plan"><FigureSlot slot={row.average} /></td>
              </tr>
            ))}
            <tr className="v6-budget-year-total">
              <th scope="row" style={{ fontWeight: 400 }}>
                Consumption spend
                <span className="v6-budget-category-meta">Published per month by the canonical period contract</span>
              </th>
              {year.spendRow.map((cell) => (
                <td key={cell.key} className="v6-col-month">
                  <FigureSlot slot={cell.slot} format={(value) => formatAed(value)} />
                </td>
              ))}
              <td className="v6-col-plan"><FigureSlot slot={year.total} /></td>
              <td className="v6-col-plan"><FigureSlot slot={year.total} /></td>
            </tr>
          </tbody>
        </table>
      </div>

      <div id="v6-budget-year-gap" className="v6-budget-plan-gap">
        <UnavailableRegion slot={gaps.yearAggregate} inline />
      </div>
      {/* The prototype's year grid opens with income rows and closes with net
          saved. Both are kept as product concepts and both name their gap. */}
      <div className="v6-budget-plan-gap">
        <UnavailableRegion slot={gaps.income} inline />
      </div>
      <div className="v6-budget-plan-gap">
        <UnavailableRegion slot={gaps.savings} inline />
      </div>
      <div className="v6-budget-plan-gap">
        <UnavailableRegion slot={gaps.plan} inline />
      </div>
    </section>
  )
}
