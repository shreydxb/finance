import { useId } from 'react'
import { classes } from '../../design-system/classes'

/**
 * The prototype's editorial section: an uppercase kicker acting as the
 * section's accessible heading, an optional trailing note or control, and
 * rules rather than a filled card.
 */
export function Section({ children, className, kicker, note, trailing, headingLevel = 2 }) {
  const id = useId().replaceAll(':', '')
  const Heading = `h${headingLevel}`
  return (
    <section className={classes('v6-section', className)} aria-labelledby={`v6-section-${id}`}>
      <div className="v6-section-head">
        <Heading id={`v6-section-${id}`} className="v6-kicker-text">{kicker}</Heading>
        {note ? <p className="v6-section-note">{note}</p> : null}
        {trailing ?? null}
      </div>
      {children}
    </section>
  )
}
