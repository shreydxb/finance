import { forwardRef, useRef } from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { Button, IconButton } from './Button'
import { classes } from './classes'

export const OverlayRoot = DialogPrimitive.Root
export const OverlayTrigger = DialogPrimitive.Trigger

export const OverlayBackdrop = forwardRef(function OverlayBackdrop({ className, ...props }, ref) {
  return <DialogPrimitive.Overlay ref={ref} className={classes('ds-dialog-overlay', className)} {...props} />
})

export const OverlaySurface = forwardRef(function OverlaySurface({ children, className, positionerClassName, ...props }, ref) {
  return (
    <div className={classes('ds-dialog-positioner', positionerClassName)}>
      <DialogPrimitive.Content ref={ref} className={classes('ds-dialog-content', className)} {...props}>
        {children}
      </DialogPrimitive.Content>
    </div>
  )
})

export function Dialog({
  children,
  className,
  closeLabel = 'Close dialog',
  description,
  footer,
  onOpenChange,
  open,
  title,
  trigger,
}) {
  return (
    <OverlayRoot open={open} onOpenChange={onOpenChange}>
      {trigger ? <OverlayTrigger asChild>{trigger}</OverlayTrigger> : null}
      <DialogPrimitive.Portal>
        <OverlayBackdrop />
        <OverlaySurface className={className}>
          <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-5 sm:px-7 sm:py-6">
            <div>
              <DialogPrimitive.Title className="m-0 font-serif text-title-2 font-normal text-text-primary">
                {title}
              </DialogPrimitive.Title>
              {description ? (
                <DialogPrimitive.Description className="mb-0 mt-1 text-body text-text-secondary">
                  {description}
                </DialogPrimitive.Description>
              ) : null}
            </div>
            <DialogPrimitive.Close asChild>
              <IconButton label={closeLabel} size="sm">×</IconButton>
            </DialogPrimitive.Close>
          </div>
          <div className="px-5 py-6 sm:px-7">{children}</div>
          {footer ? <div className="flex flex-wrap justify-end gap-2 border-t border-border px-5 py-5 sm:px-7">{footer}</div> : null}
        </OverlaySurface>
      </DialogPrimitive.Portal>
    </OverlayRoot>
  )
}

export function ConfirmDialog({
  cancelLabel = 'Cancel',
  confirmLabel,
  description,
  onConfirm,
  onOpenChange,
  open,
  pending = false,
  title,
  trigger,
}) {
  const cancelRef = useRef(null)

  return (
    <OverlayRoot open={open} onOpenChange={onOpenChange}>
      {trigger ? <OverlayTrigger asChild>{trigger}</OverlayTrigger> : null}
      <DialogPrimitive.Portal>
        <OverlayBackdrop />
        <OverlaySurface onOpenAutoFocus={(event) => {
          event.preventDefault()
          cancelRef.current?.focus()
        }}>
          <div className="px-4 pb-2 pt-5 sm:px-6 sm:pt-6">
            <DialogPrimitive.Title className="m-0 font-serif text-title-2 font-normal text-text-primary">
              {title}
            </DialogPrimitive.Title>
            <DialogPrimitive.Description className="mb-0 mt-2 text-body text-text-secondary">
              {description}
            </DialogPrimitive.Description>
          </div>
          <div className="flex flex-col-reverse gap-2 px-4 pb-5 pt-4 sm:flex-row sm:justify-end sm:px-6 sm:pb-6">
            <DialogPrimitive.Close asChild>
              <Button ref={cancelRef} intent="secondary" disabled={pending}>{cancelLabel}</Button>
            </DialogPrimitive.Close>
            <Button intent="danger" loading={pending} onClick={onConfirm}>{confirmLabel}</Button>
          </div>
        </OverlaySurface>
      </DialogPrimitive.Portal>
    </OverlayRoot>
  )
}
