import { Button } from './Button'
import { Badge, Status } from './Status'
import { classes } from './classes'

const QUALITY_PRESENTATION = {
  complete: { label: 'Complete', tone: 'success' },
  provisional: { label: 'Provisional', tone: 'warning' },
  incomplete: { label: 'Incomplete', tone: 'danger' },
}

export function QualityIndicator({ detail, reason, status }) {
  const presentation = QUALITY_PRESENTATION[status]
  if (!presentation) throw new Error(`Unsupported supplied quality status: ${status}`)

  return (
    <details className="group inline-block text-left">
      <summary className="min-h-6 cursor-pointer list-none rounded-full [&::-webkit-details-marker]:hidden">
        <Badge tone={presentation.tone}>
          <span className="mr-1" aria-hidden="true">{status === 'complete' ? '✓' : status === 'provisional' ? '◐' : '!'}</span>
          {presentation.label}
        </Badge>
      </summary>
      <div className="mt-2 max-w-sm rounded-panel border border-border bg-surface-overlay p-3 text-body-sm text-text-secondary shadow-elevation-2">
        {reason ? <p className="m-0 font-medium text-text-primary">{reason}</p> : null}
        {detail ? <p className={classes('mb-0', reason ? 'mt-1' : 'mt-0')}>{detail}</p> : null}
      </div>
    </details>
  )
}

const FRESHNESS_TONES = {
  current: 'success',
  stale: 'warning',
  unknown: 'neutral',
}

export function FreshnessIndicator({ dateTime, detail, label, state, timestamp }) {
  const tone = FRESHNESS_TONES[state]
  if (!tone) throw new Error(`Unsupported supplied freshness state: ${state}`)

  return (
    <div className="inline-flex flex-wrap items-center gap-x-2 gap-y-1 text-body-sm">
      <Status tone={tone} label={label} />
      {timestamp ? <time dateTime={dateTime} className="text-text-tertiary">{timestamp}</time> : null}
      {detail ? <span className="basis-full text-text-secondary">{detail}</span> : null}
    </div>
  )
}

export function ProvenanceDisclosure({ children, label = 'How this was determined' }) {
  return (
    <details className="rounded-control border border-border bg-surface-subtle px-3 py-2 text-body-sm">
      <summary className="min-h-6 cursor-pointer font-semibold text-text-primary">{label}</summary>
      <div className="mt-2 border-t border-border pt-2 text-text-secondary">{children}</div>
    </details>
  )
}

const ATTENTION_TONES = {
  info: 'border-info/40 bg-info-soft',
  review: 'border-attention/40 bg-attention-soft',
  warning: 'border-warning/40 bg-warning-soft',
  danger: 'border-danger/40 bg-danger-soft',
}

export function AttentionIndicator({ actionLabel, className, description, label, onAction, tone = 'review' }) {
  return (
    <div className={classes('flex flex-col gap-3 rounded-panel border p-4 sm:flex-row sm:items-center sm:justify-between', ATTENTION_TONES[tone] ?? ATTENTION_TONES.review, className)}>
      <div className="flex gap-3">
        <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full border border-current text-label font-bold" aria-hidden="true">!</span>
        <div>
          <p className="m-0 text-body font-semibold text-text-primary">{label}</p>
          {description ? <p className="mb-0 mt-1 text-body-sm text-text-secondary">{description}</p> : null}
        </div>
      </div>
      {onAction && actionLabel ? <Button intent="secondary" onClick={onAction}>{actionLabel}</Button> : null}
    </div>
  )
}
