import { FigureSlot, UnavailableRegion } from '../primitives/Slot'
import { isAvailable, slotReason } from '../primitives/slotState'
import { formatAed, pluralise } from '../format'

/**
 * The prototype's Category / Spent / Limit / Pace / Projected table.
 *
 * A real `table` rather than the prototype's grid of divs, so the row and
 * column relationships survive for assistive technology, and every plan column
 * the prototype shows is kept in place rather than dropped — the household
 * should see that the product has the idea of a plan, and see exactly why this
 * screen cannot state one yet.
 *
 * Two things this table deliberately does not do:
 *
 *  - It does not sort, colour or annotate a category as over, under or on
 *    track. Every one of those is a statement about a plan.
 *  - The bar beneath each actual is relative magnitude between the canonical
 *    actuals in this period, drawn only when they all reconcile to the
 *    canonical period total. It is not progress towards a limit, it states no
 *    number, and it is hidden from assistive technology because the figure
 *    beside it is the datum.
 */
function RowFlags({ row }) {
  const flags = []
  if (row.quality !== 'complete') flags.push({ key: 'quality', tone: 'review', label: row.quality })
  if (row.needsReviewCount > 0) flags.push({ key: 'review', tone: 'review', label: `${row.needsReviewCount} needs review` })
  if (row.missingFxCount > 0) flags.push({ key: 'fx', tone: 'review', label: `${row.missingFxCount} missing FX` })
  if (row.zeroPlaceholderCount > 0) flags.push({ key: 'zero', tone: 'transfer', label: `${row.zeroPlaceholderCount} zero placeholder` })
  if (!flags.length) return null
  return (
    <span className="v6-row-flags">
      {flags.map((flag) => <span key={flag.key} className="v6-flag" data-tone={flag.tone}>{flag.label}</span>)}
    </span>
  )
}

export default function BudgetCategoryTable({ model }) {
  const { categories, period, gaps } = model

  if (categories.status !== 'available') {
    return (
      <section aria-labelledby="v6-budget-categories-heading" className="v6-section">
        <h2 id="v6-budget-categories-heading" className="v6-kicker-text">Categories · {period.label}</h2>
        <div className="v6-unavailable" role="note" style={{ marginTop: '16px' }}>
          <p className="v6-unavailable-label">
            {categories.status === 'empty' ? 'No category spending in this period.' : 'Category actuals are not available.'}
          </p>
          <p className="v6-unavailable-detail">{categories.reason}</p>
        </div>
      </section>
    )
  }

  return (
    <section aria-labelledby="v6-budget-categories-heading" className="v6-section">
      <h2 id="v6-budget-categories-heading" className="v6-kicker-text">Categories · {period.label}</h2>

      <div className="v6-budget-scroll" role="region" aria-label="Budget categories" tabIndex={0}>
        <table className="v6-budget-table">
          <caption className="v6-visually-hidden">
            Canonical category actuals for {period.label}. Spent is the canonical AED consumption spend the contract
            reported for each label. Planned, pace and projected close have no canonical source for this period and
            are reported as not available. The bar beside each amount shows its size relative to the largest amount in
            this period; it is not progress towards a limit.
          </caption>
          <thead>
            <tr>
              <th scope="col">Category</th>
              <th scope="col" className="v6-col-amount">Spent (AED)</th>
              <th scope="col" className="v6-col-plan" aria-describedby="v6-budget-plan-gap">Planned</th>
              <th scope="col" className="v6-col-pace" aria-describedby="v6-budget-plan-gap">Pace</th>
              <th scope="col" className="v6-col-plan" aria-describedby="v6-budget-plan-gap">Projected close</th>
            </tr>
          </thead>
          <tbody>
            {categories.rows.map((row) => (
              <tr key={row.key}>
                <th scope="row" style={{ fontWeight: 400 }}>
                  <span className="v6-budget-category">{row.label}</span>
                  <span className="v6-budget-category-meta">
                    {pluralise(row.transactionCount, 'canonical entry', 'canonical entries')}
                    {row.isUncategorised ? ' · the contract’s bucket for entries with no category' : ''}
                  </span>
                  <RowFlags row={row} />
                </th>
                <td className="v6-col-amount">
                  <FigureSlot slot={row.actual} format={(value) => formatAed(value, { precise: true })} />
                  {row.magnitude !== null ? (
                    <span className="v6-bar-track v6-budget-magnitude" aria-hidden="true">
                      <span className="v6-bar-fill" style={{ width: `${(row.magnitude * 100).toFixed(2)}%` }} />
                    </span>
                  ) : null}
                  {!isAvailable(row.actual) ? (
                    <span className="v6-bar-note">{slotReason(row.actual)}</span>
                  ) : null}
                </td>
                <td className="v6-col-plan"><FigureSlot slot={row.plan} /></td>
                <td className="v6-col-pace"><FigureSlot slot={row.pace} /></td>
                <td className="v6-col-plan"><FigureSlot slot={row.projectedClose} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {categories.bars && !categories.bars.drawable && categories.bars.reason ? (
        <p className="v6-list-footer"><span>{categories.bars.reason}</span></p>
      ) : (
        <p className="v6-list-footer">
          <span>
            Bar length is relative to the largest canonical category actual in {period.label}. It is not progress
            towards a plan, and it states no share of any total.
          </span>
        </p>
      )}

      <div id="v6-budget-plan-gap" className="v6-budget-plan-gap">
        <UnavailableRegion slot={gaps.plan} inline />
      </div>
      <div className="v6-budget-plan-gap">
        <UnavailableRegion slot={gaps.variance} inline />
      </div>
      {/* Stated beside the column it qualifies: this is where a label is most
          likely to be mistaken for a durable category identity. */}
      <div className="v6-budget-plan-gap">
        <UnavailableRegion slot={gaps.categoryIdentity} inline />
      </div>
      <div className="v6-budget-plan-gap">
        <UnavailableRegion slot={gaps.categoryGroups} inline />
      </div>
    </section>
  )
}
