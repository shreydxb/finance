import { Section } from '../primitives/Section'
import { FigureSlot, UnavailableRegion } from '../primitives/Slot'
import { isAvailable, slotContract, slotReason } from '../primitives/slotState'
import { formatAed } from '../format'

/**
 * The prototype's "Fixed vs variable" card.
 *
 * The prototype draws a two-segment bar, labels it "Fixed 20,860 / Variable
 * 25,260" and concludes "45% of spend is committed before the month starts".
 * The whole of that is plan-versus-fact: the committed half is the recurring
 * plan, the split is the comparison, and the percentage is the judgement.
 *
 * Exactly one half of it is canonical, and it is the same half Budget can
 * state — the period's consumption spend from `canonical_period_metrics`. It
 * is published here as the total the split would be taken *of*, labelled as
 * posted spend for the calendar month, and never as committed, fixed or
 * recurring. The bar is absent rather than drawn empty or drawn against
 * something else, exactly as Budget's plan progress bar is.
 */
export default function RecurringCommitmentSplit({ model }) {
  const { posted, plan, period } = model

  return (
    <Section
      kicker="Fixed vs variable"
      note={`${period.label} · one half of this split is canonical`}
    >
      <div className="v6-recurring-split">
        <div className="v6-recurring-split-figure">
          <p className="v6-kpi-label">Consumption spend posted this period</p>
          <p className="v6-kpi-value">
            {isAvailable(posted.consumptionSpend)
              ? <FigureSlot slot={posted.consumptionSpend} format={(value) => formatAed(value)} prefix="AED" />
              : <span className="v6-missing-figure"><span>{posted.consumptionSpend.status === 'incomplete' ? 'Incomplete' : 'Not available'}</span></span>}
          </p>
          <p className="v6-kpi-hint">
            {isAvailable(posted.consumptionSpend)
              ? 'Whole-period posted spend from canonical_period_metrics. It is not a committed, fixed or recurring figure — it is the total a fixed-versus-variable split would divide.'
              : slotReason(posted.consumptionSpend)}
          </p>
        </div>

        <div className="v6-recurring-split-figure">
          <p className="v6-kpi-label">Committed before the month started</p>
          <p className="v6-kpi-value">
            <span className="v6-missing-figure"><span>Not available</span></span>
          </p>
          <p className="v6-kpi-hint">Awaiting {slotContract(plan.fixedVariable)}</p>
        </div>
      </div>

      <div className="v6-recurring-gap-stack">
        <UnavailableRegion slot={plan.fixedVariable} inline />
        <UnavailableRegion slot={posted.incomePeriod} inline />
      </div>

      {posted.quality ? (
        <p className="v6-section-note" style={{ marginTop: '16px' }}>
          Period quality: {posted.quality}
          {posted.needsReviewCount ? ` · ${posted.needsReviewCount} flagged for review` : ''}
          {posted.missingFxCount
            ? ` · ${posted.missingFxCount} without a canonical FX rate${posted.missingFxCurrencies.length ? ` (${posted.missingFxCurrencies.join(', ')})` : ''}`
            : ''}
        </p>
      ) : null}
    </Section>
  )
}
