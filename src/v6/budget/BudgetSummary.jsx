import { FigureSlot, SlotNote, UnavailableRegion } from '../primitives/Slot'
import { isAvailable, slotReason } from '../primitives/slotState'
import { formatAed, pluralise } from '../format'

/**
 * The prototype's "Spent of budget" summary, kept whole.
 *
 * The prototype composes one sentence out of two numbers — "46,120 of 55,000"
 * — then a progress bar, a pace marker and a projected close. Exactly one of
 * those numbers is canonical. So the composition survives intact and each
 * position states what it is:
 *
 *   - **Spent** is `canonical_period_metrics.consumption_spend_aed`.
 *   - **Plan**, **Budget left** and **Projected close** are the positions the
 *     prototype fills from a plan. They render as unavailable, naming SHR-166.
 *   - The **progress bar** is deliberately absent rather than drawn empty or
 *     drawn against something else. A bar in this position means actual over
 *     plan, and drawing one from anything else would be a proportion of
 *     nothing wearing the prototype's clothes.
 */
function PlanPosition({ label, slot, describedBy }) {
  return (
    <div className="v6-budget-position">
      <p className="v6-budget-position-label">{label}</p>
      <p className="v6-budget-position-value">
        <FigureSlot slot={slot} format={(value) => formatAed(value)} label={label} />
      </p>
      <p className="v6-budget-position-note" id={describedBy}>{slotReason(slot)}</p>
    </div>
  )
}

export default function BudgetSummary({ model }) {
  const { summary, period } = model
  const evidence = []
  if (summary.needsReviewCount) evidence.push(`${pluralise(summary.needsReviewCount, 'entry', 'entries')} flagged for review`)
  if (summary.zeroPlaceholderCount) evidence.push(`${pluralise(summary.zeroPlaceholderCount, 'zero placeholder')}`)
  if (summary.missingFxCount) {
    const currencies = summary.missingFxCurrencies.length ? ` (${summary.missingFxCurrencies.join(', ')})` : ''
    evidence.push(`${pluralise(summary.missingFxCount, 'entry', 'entries')} with no canonical FX rate${currencies}`)
  }

  return (
    <section className="v6-hero-section v6-enter" aria-labelledby="v6-budget-summary-heading">
      <div className="v6-hero-row">
        <div className="v6-hero-main">
          <h2 id="v6-budget-summary-heading" className="v6-kicker-text">Spent of plan · {period.label}</h2>
          <p className="v6-hero-value">
            {isAvailable(summary.actual)
              ? <FigureSlot slot={summary.actual} prefix="AED" format={(value) => formatAed(value)} label="Consumption spend" />
              : <FigureSlot slot={summary.actual} label="Consumption spend" />}
            <span className="v6-hero-currency"> of </span>
            <span className="v6-hero-currency">
              <FigureSlot slot={summary.plan} format={(value) => formatAed(value)} label="Planned amount" />
            </span>
          </p>
          <p className="v6-hero-annotations">
            <span className="v6-tone-muted">
              Spend is canonical consumption spend for the whole calendar month. Transfers and savings movements are
              excluded by the contract.
            </span>
          </p>
          {!isAvailable(summary.actual) ? <SlotNote slot={summary.actual} /> : null}
        </div>

        <div className="v6-budget-positions" role="group" aria-label="Plan positions">
          <PlanPosition label="Planned" slot={summary.plan} />
          <PlanPosition label="Budget left" slot={summary.remaining} />
          <PlanPosition label="Projected close" slot={summary.projectedClose} />
        </div>
      </div>

      <div className="v6-budget-plan-gap">
        <UnavailableRegion slot={summary.progress} inline />
      </div>

      <div className="v6-budget-plan-gap">
        <UnavailableRegion slot={summary.pace} inline />
      </div>

      {evidence.length ? (
        <p className="v6-section-note v6-budget-evidence">
          Reported by the canonical period contract: {evidence.join(' · ')}.
        </p>
      ) : null}
    </section>
  )
}
