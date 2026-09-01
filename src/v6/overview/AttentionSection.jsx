import AppLink from '../../shell/AppLink'
import { Section } from '../primitives/Section'
import { UnavailableRegion } from '../primitives/Slot'

/**
 * Needs attention.
 *
 * There is no ranked attention feed: the condition/producer registry is a
 * named gap and is stated as one. What is shown instead are the data-quality
 * counts the canonical read contracts already return, listed verbatim with the
 * field each came from. Nothing here is scored, prioritised or inferred.
 */
export default function AttentionSection({ attention, navigate }) {
  const { registry, signals, signalsRead } = attention

  return (
    <Section
      kicker="Needs attention"
      note={signals.length ? `${signals.length} canonical quality signal${signals.length === 1 ? '' : 's'}` : null}
    >
      <UnavailableRegion slot={registry} />

      <div style={{ marginTop: '18px' }}>
        <p className="v6-kicker-text">Reported by the canonical read contracts</p>
        {!signalsRead ? (
          <p className="v6-unavailable-detail">
            No canonical contract responded, so no quality signal can be listed.
          </p>
        ) : signals.length === 0 ? (
          <p className="v6-unavailable-detail">
            Every canonical read for this period reports complete inputs: no review flags, no missing FX rates,
            no unresolved placeholders.
          </p>
        ) : (
          <ul>
            {signals.map((item) => (
              <li key={item.id} className="v6-attention-item">
                <span className="v6-attention-kind">{item.kind}</span>
                <span className="v6-attention-body">
                  <span className="v6-attention-title">{item.title}</span>
                  <span className="v6-attention-meta">
                    {item.meta}
                    <br />
                    <span className="v6-tone-muted">Source: {item.source}</span>
                  </span>
                </span>
                {item.action ? (
                  <span className="v6-attention-action">
                    <AppLink href={item.action.href} navigate={navigate} className="v6-outline-link">
                      {item.action.label}
                    </AppLink>
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Section>
  )
}
