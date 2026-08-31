import { useId } from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import {
  Button,
  ErrorState,
  LoadingState,
  OverlayBackdrop,
  OverlayRoot,
  OverlaySurface,
} from '../design-system'

export default function DetailShell({
  backLabel,
  children,
  error,
  loading = false,
  onRequestClose,
  title,
  unavailable = false,
}) {
  const titleId = useId()

  return (
    <OverlayRoot open onOpenChange={(nextOpen) => {
      if (!nextOpen) onRequestClose()
    }}>
      <DialogPrimitive.Portal>
        <OverlayBackdrop />
        <OverlaySurface
          positionerClassName="detail-shell-positioner"
          className="detail-shell-content"
          aria-labelledby={titleId}
          onOpenAutoFocus={(event) => {
            event.preventDefault()
            document.getElementById(titleId)?.focus()
          }}
          onCloseAutoFocus={(event) => event.preventDefault()}
        >
          <header className="sticky top-0 z-10 border-b border-border bg-surface-overlay px-5 pb-4 pt-[calc(1.25rem+env(safe-area-inset-top))] sm:px-7 sm:pt-6">
            <Button intent="quiet" size="sm" className="-ml-3 mb-1" onClick={onRequestClose}>
              ← Back to {backLabel}
            </Button>
            <DialogPrimitive.Title id={titleId} tabIndex="-1" className="m-0 font-serif text-title-2 font-normal text-text-primary outline-none">
              {title}
            </DialogPrimitive.Title>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))] sm:px-7">
            {loading ? <LoadingState label="Loading…" /> : null}
            {!loading && error ? <ErrorState title={error} /> : null}
            {!loading && !error && unavailable ? (
              <ErrorState
                title="Record unavailable"
                description="This record is not available in the current view. It may not match the active filters or may no longer exist."
              />
            ) : null}
            {!loading && !error && !unavailable ? children : null}
          </div>
        </OverlaySurface>
      </DialogPrimitive.Portal>
    </OverlayRoot>
  )
}
