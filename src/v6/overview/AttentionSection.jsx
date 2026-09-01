import { Section } from '../primitives/Section'
import { UnavailableRegion } from '../primitives/Slot'

/**
 * Needs attention.
 *
 * The section holds its place in the prototype's hierarchy and states its gap.
 * It deliberately renders nothing else.
 *
 * Canonical read contracts do return data-quality counters, and it is
 * tempting to list them here. That would be a parallel, frontend-authored
 * attention interpretation: putting a counter inside this surface *is* the
 * claim that it warrants attention, which is exactly the judgement SHR-192's
 * producer/condition/lifecycle contract exists to make. Those counters are
 * shown as data-health evidence under "Data quality and freshness" instead,
 * where they claim to be nothing more than what a contract reported.
 */
export default function AttentionSection({ attention }) {
  return (
    <Section kicker="Needs attention">
      <UnavailableRegion slot={attention.registry} />
    </Section>
  )
}
