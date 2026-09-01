import { Section } from '../primitives/Section'
import { FigureSlot, UnavailableRegion } from '../primitives/Slot'
import { isAvailable } from '../primitives/slotState'
import { formatAed, pluralise } from '../format'

function CategoryRows({ categories }) {
  if (categories.status === 'empty') {
    return (
      <div className="v6-unavailable" role="status">
        <p className="v6-unavailable-label">No category spending was reported.</p>
        <p className="v6-unavailable-detail">{categories.reason}</p>
      </div>
    )
  }
  if (categories.status !== 'available') {
    return (
      <div className="v6-unavailable" role="note">
        <p className="v6-unavailable-label">Category actuals are not available.</p>
        <p className="v6-unavailable-detail">{categories.reason}</p>
      </div>
    )
  }

  return (
    <>
      <ul className="v6-insights-category-list">
        {categories.rows.map((row) => (
          <li key={row.key}>
            <div className="v6-insights-category-head">
              <div>
                <span className="v6-list-primary">{row.label}</span>
                <span className="v6-list-meta">
                  Reported label · {pluralise(row.transactionCount ?? 0, 'entry', 'entries')}
                  {row.quality ? ` · published quality: ${row.quality}` : ' · quality not published'}
                  {row.isUncategorised ? ' · no category recorded; distinct from Other' : ''}
                </span>
              </div>
              <span className="v6-list-value">
                <FigureSlot slot={row.actual} format={(value) => formatAed(value, { precise: true })} />
              </span>
            </div>
            {row.magnitude === null ? null : (
              <span className="v6-bar-track" aria-hidden="true">
                <span className="v6-bar-fill" style={{ width: `${(row.magnitude * 100).toFixed(2)}%` }} />
              </span>
            )}
            <span className="v6-bar-note">
              Current-period magnitude only · comparison and change are not available.
              {!isAvailable(row.actual) ? ' Canonical inputs are incomplete.' : ''}
            </span>
          </li>
        ))}
      </ul>
      {!categories.geometry.drawable ? <p className="v6-section-note">{categories.geometry.reason}</p> : null}
    </>
  )
}

export default function InsightsBreakdown({ model }) {
  return (
    <div className="v6-g2 v6-enter">
      <Section
        className="v6-insights-column-section"
        kicker={`Category spending · ${model.period.label}`}
        note="Canonical actuals · no local shares or averages"
      >
        <CategoryRows categories={model.categories} />
        <div className="v6-insights-gap">
          <UnavailableRegion slot={model.gaps.categoryComparison} inline />
        </div>
        <div className="v6-insights-gap">
          <UnavailableRegion slot={model.gaps.categoryIdentity} inline />
        </div>
      </Section>

      <div>
        <Section
          className="v6-insights-column-section"
          kicker={`Descriptions and payees · ${model.period.label}`}
          note="Recorded labels only when a contract publishes analysis"
        >
          <UnavailableRegion slot={model.gaps.descriptions} />
          <div className="v6-insights-gap">
            <UnavailableRegion slot={model.gaps.merchantIdentity} inline />
          </div>
        </Section>

        <Section className="v6-insights-worth" kicker="Worth knowing">
          <UnavailableRegion slot={model.gaps.explanation} />
        </Section>
      </div>
    </div>
  )
}
