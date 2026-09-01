import { Section } from '../primitives/Section'
import { UnavailableRegion } from '../primitives/Slot'

/**
 * The matching surface, composition preserved and wholly unavailable.
 *
 * The prototype lets a household mark a bill paid and reconcile it against
 * what actually posted. SHR-171 defines that as a deterministic suggestion the
 * household then confirms explicitly — never an automatic conversion of a plan
 * into a fact.
 *
 * Neither half exists yet, so both actions render disabled and every matching
 * position states its gap. Nothing on this screen compares a merchant name,
 * scores an amount-and-date similarity, or calls anything paid. The one action
 * a browser could plausibly fake — "this looks like your DEWA bill" — is the
 * one that would be most damaging to fake, because a household would act on it.
 */
export default function RecurringMatching({ model }) {
  const { matching, capabilities, plan } = model

  return (
    <Section kicker="Matching and status" note="Suggestion plus explicit confirmation — never an automatic link">
      <div className="v6-recurring-actions">
        <button type="button" className="v6-unsupported-action" disabled aria-describedby="v6-recurring-mark-paid-gap">
          Mark paid
        </button>
        <button type="button" className="v6-unsupported-action" disabled aria-describedby="v6-recurring-match-gap">
          Match a posted entry
        </button>
      </div>

      <div className="v6-recurring-gap-stack">
        <div id="v6-recurring-mark-paid-gap">
          <UnavailableRegion slot={capabilities.markPaid} inline />
        </div>
        <div id="v6-recurring-match-gap">
          <UnavailableRegion slot={capabilities.match} inline />
        </div>
        <UnavailableRegion slot={matching.suggestions} inline />
        <UnavailableRegion slot={matching.variance} inline />
        <UnavailableRegion slot={plan.paidStatus} inline />
        <UnavailableRegion slot={plan.attribution} inline />
      </div>
    </Section>
  )
}
