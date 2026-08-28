import { useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import AppShell from './shell/AppShell'
import RouteDetailShell from './shell/RouteDetailShell'
import { AuthProvider } from './lib/AuthContext'
import { NavigationSafetyProvider } from './lib/NavigationSafety'
import { useNavigationSafety } from './lib/navigationSafetyContext'
import { PrefsProvider } from './lib/PrefsContext'
import { detailHref, parentHrefForDetail, presentationForRoute, resolveAppHref } from './lib/routes'
import ProtectedForm from './components/ProtectedForm'
import './index.css'

const SAMPLE_ID = '123e4567-e89b-42d3-a456-426614174000'
const DETAIL_BY_PARENT = {
  '/money/activity': 'transaction',
  '/money/recurring': 'recurring',
  '/wealth/accounts': 'account',
  '/wealth/investments': 'investment',
  '/planning/goals': 'goal',
  '/planning/debt': 'debt',
}

function PreviewShell() {
  const safety = useNavigationSafety()
  const [route, setRoute] = useState(() => resolveAppHref('/overview'))
  const invokerRef = useRef(null)
  const pendingFocusRef = useRef(null)
  const parentPath = route.detail?.parentPath ?? route.pathname
  const detailKind = route.detail?.kind ?? DETAIL_BY_PARENT[parentPath]

  function navigate(target) {
    const next = resolveAppHref(target)
    if (next.kind !== 'screen' || !safety.confirmLeave()) return false
    safety.clearAll()
    setRoute(next)
    return true
  }

  function openDetail(event) {
    const target = detailHref(detailKind, SAMPLE_ID, route.searchParams)
    if (!target || !safety.confirmLeave()) return
    safety.clearAll()
    invokerRef.current = event.currentTarget
    setRoute(resolveAppHref(target))
  }

  function closeDetail() {
    if (!safety.confirmLeave()) return
    safety.clearAll()
    pendingFocusRef.current = invokerRef.current
    const destination = parentHrefForDetail(route, null)
    if (destination) setRoute(resolveAppHref(destination.href))
  }

  return (
    <AppShell
      identity="preview@example.com"
      navigate={navigate}
      onSignOut={async () => true}
      presentation={presentationForRoute(route)}
      route={route}
      takePendingFocusTarget={() => {
        const target = pendingFocusRef.current
        pendingFocusRef.current = null
        return target
      }}
    >
      <section className="rounded-panel border border-border bg-surface p-5 shadow-elevation-1 sm:p-6" aria-labelledby="preview-body-title">
        <h2 id="preview-body-title" className="m-0 text-title-2 font-semibold text-text-primary">Preserved screen body</h2>
        <p className="mb-0 mt-2 max-w-prose text-body text-text-secondary">
          SHR-116 Shell Preview: representative existing content remains inside the route-owned frame.
        </p>
        {DETAIL_BY_PARENT[parentPath] ? (
          <button type="button" onClick={openDetail} className="mt-5 min-h-control rounded-control bg-action px-4 text-body font-semibold text-action-contrast">
            Open sample {detailKind} detail
          </button>
        ) : null}
      </section>

      <ProtectedForm onSubmit={(event) => event.preventDefault()} className="mt-5 rounded-panel border border-border bg-surface p-5 sm:p-6">
        <label htmlFor="preview-note" className="block text-label font-semibold text-text-secondary">Dirty-navigation fixture</label>
        <input id="preview-note" name="note" defaultValue="" className="mt-2 min-h-control w-full rounded-control border border-border bg-surface px-3 text-body text-text-primary" />
      </ProtectedForm>

      {route.detail ? (
        <RouteDetailShell backLabel={presentationForRoute(route).title} title={`Sample ${route.detail.kind}`} onRequestClose={closeDetail}>
          <p className="mt-0 text-body text-text-secondary">Focused detail preserves immutable UUID identity.</p>
          <code className="text-body-sm text-text-primary">{route.detail.id}</code>
          <label htmlFor="detail-fixture" className="mt-5 block text-label font-semibold text-text-secondary">Detail field</label>
          <input id="detail-fixture" className="mt-2 min-h-control w-full rounded-control border border-border bg-surface px-3" />
        </RouteDetailShell>
      ) : null}
    </AppShell>
  )
}

createRoot(document.getElementById('root')).render(
  <AuthProvider>
    <PrefsProvider>
      <NavigationSafetyProvider>
        <PreviewShell />
      </NavigationSafetyProvider>
    </PrefsProvider>
  </AuthProvider>,
)
