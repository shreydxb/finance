import { FigureSlot, SlotNote, UnavailableRegion } from '../primitives/Slot'
import { isAvailable } from '../primitives/slotState'
import { formatAed } from '../format'

function SummaryMetric({ label, slot, source }) {
  return (
    <div className="v6-insights-summary-metric">
      <p className="v6-kicker-text">{label}</p>
      <p className="v6-insights-summary-value">
        {isAvailable(slot)
          ? <FigureSlot slot={slot} prefix="AED" format={(value) => formatAed(value)} label={label} />
          : <FigureSlot slot={slot} label={label} />}
      </p>
      <p className="v6-quality-detail">{source}</p>
      {!isAvailable(slot) ? <SlotNote slot={slot} /> : null}
    </div>
  )
}

export default function InsightsSummary({ model }) {
  return (
    <section className="v6-insights-summary v6-enter" aria-labelledby="v6-insights-summary-heading">
      <h2 id="v6-insights-summary-heading" className="v6-visually-hidden">Selected period summary</h2>
      <SummaryMetric
        label="Consumption spend"
        slot={model.summary.spend}
        source="Directly published by canonical_period_metrics.consumption_spend_aed."
      />
      <SummaryMetric
        label="Posted income"
        slot={model.summary.income}
        source="Directly published by canonical_period_metrics.posted_income_aed; not expected income or an income forecast."
      />
      <div className="v6-insights-summary-gap">
        <UnavailableRegion slot={model.gaps.incomeAnalysis} inline />
      </div>
    </section>
  )
}
