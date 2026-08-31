import { useEffect, useId, useRef } from 'react'
import { Button, IconButton } from '../design-system'
import { DISPLAY_CURRENCIES } from '../lib/money'
import { usePrefs } from '../lib/PrefsContext'
import AppLink from './AppLink'

export default function UtilityPanel({ identity, navigate, onSignOut, open, onOpenChange, returnFocusRef }) {
  const dialogRef = useRef(null)
  const titleId = useId()
  const { currency, setCurrency, theme, setTheme } = usePrefs()
  const nextTheme = theme === 'light' ? 'dark' : theme === 'dark' ? 'system' : 'light'
  const themeLabel = theme === 'system' ? 'Theme: following system' : `Theme: ${theme}`

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) {
      if (dialog.showModal) dialog.showModal()
      else dialog.setAttribute('open', '')
      dialog.querySelector('[data-utility-heading]')?.focus()
    } else if (!open && dialog.open) {
      if (dialog.close) dialog.close()
      else dialog.removeAttribute('open')
    }
  }, [open])

  useEffect(() => () => {
    const target = returnFocusRef?.current
    if (target?.isConnected) queueMicrotask(() => target.focus())
  }, [returnFocusRef])

  function requestClose() {
    onOpenChange(false)
    const target = returnFocusRef?.current
    if (target?.isConnected) queueMicrotask(() => target.focus())
  }

  async function handleSignOut() {
    const signedOut = await onSignOut()
    if (signedOut) requestClose()
  }

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      className="utility-dialog m-0 max-w-none overflow-y-auto bg-surface-overlay p-0 text-text-primary"
      onCancel={(event) => {
        event.preventDefault()
        requestClose()
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault()
          requestClose()
        }
      }}
      onClick={(event) => {
        if (event.target === dialogRef.current) requestClose()
      }}
    >
      <div className="border-b border-border px-4 py-4 sm:px-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id={titleId} data-utility-heading tabIndex="-1" className="m-0 font-serif text-title-2 font-normal outline-none">
              Preferences and account
            </h2>
            {identity ? <p className="mb-0 mt-1 truncate text-body-sm text-text-tertiary">{identity}</p> : null}
          </div>
          <IconButton label="Close preferences" size="sm" onClick={requestClose}>×</IconButton>
        </div>
      </div>

      <div className="space-y-5 px-4 py-5 sm:px-5">
        <section aria-labelledby="display-currency-title">
          <h3 id="display-currency-title" className="mb-2 text-label font-semibold text-text-secondary">Display currency</h3>
          <div className="grid grid-cols-3 gap-2">
            {DISPLAY_CURRENCIES.map((currencyCode) => (
              <Button
                key={currencyCode}
                intent={currency === currencyCode ? 'primary' : 'secondary'}
                aria-pressed={currency === currencyCode}
                onClick={() => setCurrency(currencyCode)}
              >
                {currencyCode}
              </Button>
            ))}
          </div>
        </section>

        <section aria-labelledby="appearance-title">
          <h3 id="appearance-title" className="mb-2 text-label font-semibold text-text-secondary">Appearance</h3>
          <Button intent="secondary" className="w-full justify-between" onClick={() => setTheme(nextTheme)} aria-label={themeLabel}>
            {themeLabel}
          </Button>
          <p className="mb-0 mt-2 text-body-sm text-text-tertiary">Activate to cycle light, dark, and system.</p>
        </section>

        <div className="border-t border-border pt-5">
          <AppLink
            href="/settings"
            navigate={navigate}
            onNavigated={requestClose}
            className="flex min-h-control items-center rounded-control border border-border px-4 text-body font-semibold text-text-primary hover:border-border-strong hover:bg-surface-subtle"
          >
            Settings
          </AppLink>
          <Button intent="quiet" className="mt-2 w-full justify-start text-danger" onClick={handleSignOut}>
            Sign out
          </Button>
        </div>
      </div>
    </dialog>
  )
}
