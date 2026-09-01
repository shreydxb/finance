import { Section } from '../primitives/Section'
import { UnavailableRegion } from '../primitives/Slot'
import { slotContract, slotReason } from '../primitives/slotState'

/**
 * The prototype's Bills & EMIs / Expected income list.
 *
 * There are no rows, and there is no read that could produce one: the plan
 * contract is missing, and a commitment reconstructed from posted transactions
 * would be a schedule the household never declared. So the list renders its
 * own composition — the columns the prototype gives each row, in order — as
 * named positions rather than as a table of invented values.
 *
 * This is deliberately not an empty table with a "no data" caption. An empty
 * table says the household has no bills. These positions say the screen cannot
 * yet know, and which contract would tell it.
 */
export default function RecurringPlanList({ model }) {
  const { type, plan, rowPositions, period, capabilities } = model
  const listSlot = type === 'income' ? plan.income : plan.bills
  const kicker = type === 'income' ? 'Expected income' : 'Bills & EMIs'
  const totalSlot = type === 'income' ? plan.expectedIncomeTotal : plan.committedTotal

  return (
    <Section
      kicker={kicker}
      note={`${period.label} · no commitment is published for this period`}
    >
      <UnavailableRegion slot={listSlot} />

      <div className="v6-recurring-positions" aria-label={`${kicker} positions`}>
        <h3 className="v6-recurring-positions-title">
          What each {type === 'income' ? 'expected income' : 'commitment'} row would carry
        </h3>
        <dl className="v6-recurring-position-list">
          {rowPositions.map((position) => (
            <div key={position.key} className="v6-recurring-position">
              <dt>{position.label}</dt>
              <dd>
                <span className="v6-missing-figure"><span>Not available</span></span>
                <span className="v6-kpi-hint">
                  {slotReason(position.slot)}
                  <br />
                  {slotContract(position.slot)}
                </span>
              </dd>
            </div>
          ))}
        </dl>
      </div>

      <div className="v6-recurring-actions">
        <button type="button" className="v6-unsupported-action" disabled aria-describedby="v6-recurring-edit-gap">
          Edit a commitment
        </button>
        <button type="button" className="v6-unsupported-action" disabled aria-describedby="v6-recurring-archive-gap">
          Archive a commitment
        </button>
      </div>

      <div className="v6-recurring-gap-stack">
        <div id="v6-recurring-edit-gap">
          <UnavailableRegion slot={capabilities.edit} inline />
        </div>
        <div id="v6-recurring-archive-gap">
          <UnavailableRegion slot={capabilities.archive} inline />
        </div>
        <UnavailableRegion slot={totalSlot} inline />
        <UnavailableRegion slot={plan.effectiveWindow} inline />
      </div>
    </Section>
  )
}
