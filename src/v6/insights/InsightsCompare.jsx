import { Section } from '../primitives/Section'
import { FigureSlot, UnavailableRegion } from '../primitives/Slot'
import { formatAed } from '../format'

function CurrentActuals({ categories }) {
  if (categories.status !== 'available') {
    return <p className="v6-unavailable-detail">{categories.reason}</p>
  }
  return (
    <ul className="v6-list">
      {categories.rows.map((row) => (
        <li key={row.key}>
          <span>
            <span className="v6-list-primary">{row.label}</span>
            <span className="v6-list-meta">Current period only · comparison withheld</span>
          </span>
          <span className="v6-list-value"><FigureSlot slot={row.actual} format={(value) => formatAed(value, { precise: true })} /></span>
        </li>
      ))}
    </ul>
  )
}

export default function InsightsCompare({ model }) {
  return (
    <div className="v6-g2 v6-enter">
      <Section
        className="v6-insights-column-section"
        kicker={`${model.period.label} vs comparison period`}
        note="Current actuals remain visible; comparison truth is withheld"
      >
        <CurrentActuals categories={model.categories} />
        <div className="v6-insights-gap"><UnavailableRegion slot={model.gaps.categoryComparison} /></div>
      </Section>
      <div>
        <Section className="v6-insights-column-section" kicker="Household scope comparison">
          <UnavailableRegion slot={model.gaps.attribution} />
        </Section>
        <Section className="v6-insights-worth" kicker="Income comparison">
          <UnavailableRegion slot={model.gaps.incomeAnalysis} />
        </Section>
        <Section className="v6-insights-worth" kicker="Worth knowing">
          <UnavailableRegion slot={model.gaps.explanation} />
        </Section>
      </div>
    </div>
  )
}
