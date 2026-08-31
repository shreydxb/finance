import { Button } from './Button'
import { Panel } from './Surface'

export function EmptyState({ action, description, title = 'Nothing here yet' }) {
  return (
    <Panel className="grid min-h-40 place-items-center border-x-0 text-center">
      <div className="max-w-copy">
        <div className="mx-auto mb-3 grid size-10 place-items-center rounded-full bg-surface-subtle" aria-hidden="true">
          <span className="size-3 rounded-full border-2 border-border-strong" />
        </div>
        <h3 className="m-0 text-title-3 font-semibold text-text-primary">{title}</h3>
        {description ? <p className="mx-auto mb-0 mt-2 max-w-md text-body text-text-secondary">{description}</p> : null}
        {action ? <div className="mt-4">{action}</div> : null}
      </div>
    </Panel>
  )
}

export function LoadingState({ label = 'Loading' }) {
  return (
    <div role="status" aria-live="polite" className="flex min-h-28 items-center justify-center gap-3 border-y border-border p-6 text-body font-medium text-text-secondary">
      <span className="ds-spinner" aria-hidden="true" />
      <span>{label}</span>
    </div>
  )
}

export function ErrorState({ actionLabel = 'Try again', description, onAction, title = 'Something went wrong' }) {
  return (
    <Panel role="alert" className="border-danger/40 bg-danger-soft">
      <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="m-0 text-title-3 font-semibold text-text-primary">{title}</h3>
          {description ? <p className="mb-0 mt-1 text-body text-text-secondary">{description}</p> : null}
        </div>
        {onAction ? <Button intent="secondary" onClick={onAction}>{actionLabel}</Button> : null}
      </div>
    </Panel>
  )
}
