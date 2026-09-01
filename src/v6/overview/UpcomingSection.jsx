import AppLink from '../../shell/AppLink'
import { Section } from '../primitives/Section'
import { UnavailableRegion } from '../primitives/Slot'

/**
 * Next 30 days.
 *
 * The prototype fills this strip with bills, autopay flags and an expected
 * salary. Producing that today would mean projecting occurrences from the
 * legacy recurring schedule, which is not a canonical contract — so the region
 * keeps its place in the hierarchy and states the gap instead.
 */
export default function UpcomingSection({ upcoming, navigate }) {
  return (
    <Section className="v6-section-lg" kicker="Next 30 days">
      <UnavailableRegion slot={upcoming}>
        <p style={{ marginTop: '12px' }}>
          <AppLink href="/money/recurring" navigate={navigate} className="v6-outline-link">
            Open Recurring <span aria-hidden="true">→</span>
          </AppLink>
        </p>
      </UnavailableRegion>
    </Section>
  )
}
