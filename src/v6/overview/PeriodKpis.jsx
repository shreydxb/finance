import { Section } from '../primitives/Section'
import { FigureSlot, SlotNote } from '../primitives/Slot'
import { isAvailable } from '../primitives/slotState'
import { formatAed, formatPercent } from '../format'

function formatFor(kpi) {
  return kpi.key === 'rate' ? (value) => formatPercent(value) : (value) => formatAed(value)
}

/**
 * The five period KPIs. Equal columns with vertical rules on desktop; on
 * mobile they stack with top rules, per the prototype's own breakpoint.
 */
export default function PeriodKpis({ kpis, period, rangeLabel }) {
  return (
    <Section kicker={period.title} note={rangeLabel}>
      <div className="v6-kpi-row">
        {kpis.map((kpi) => (
          <div key={kpi.key} className="v6-kpi-cell">
            <p className="v6-kpi-label">{kpi.label}</p>
            <strong className="v6-kpi-value">
              <FigureSlot
                slot={kpi.slot}
                format={formatFor(kpi)}
                tone={kpi.key === 'rate' && isAvailable(kpi.slot) && kpi.slot.value > 0 ? 'positive' : undefined}
              />
            </strong>
            {isAvailable(kpi.slot)
              ? (kpi.hint ? <span className="v6-kpi-hint">{kpi.hint}</span> : null)
              : <SlotNote slot={kpi.slot} />}
          </div>
        ))}
      </div>
    </Section>
  )
}
