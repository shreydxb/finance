import { useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'

import AppShell from './shell/AppShell'
import { AuthProvider } from './lib/AuthContext'
import { NavigationSafetyProvider } from './lib/NavigationSafety'
import { useNavigationSafety } from './lib/navigationSafetyContext'
import { PrefsProvider } from './lib/PrefsContext'
import { detailHref, parentHrefForDetail, presentationForRoute, resolveAppHref } from './lib/routes'
import ActivityScreen from './v6/ActivityScreen'
import { ACTIVITY_FIXTURE_MONTH, ACTIVITY_FIXTURE_TODAY, activityFixtureReads } from './v6/fixtures/activityFixture'
import './index.css'

/**
 * Deterministic V6 Activity preview.
 *
 * Renders the real screen inside the real shell against the NON-CONTRACTUAL
 * Activity fixtures, so responsive, visual and accessibility runs have a
 * stable target without a Supabase session. Not part of the app entry point.
 */
function PreviewActivity() {
  const safety = useNavigationSafety()
  const [route, setRoute] = useState(() => {
    // Honour the address bar so a responsive/accessibility run can open the
    // calendar, a filter or a row's drawer directly by URL.
    const incoming = new URLSearchParams(window.location.search)
    if (!incoming.has('year')) incoming.set('year', String(ACTIVITY_FIXTURE_MONTH.year))
    if (!incoming.has('month')) incoming.set('month', String(ACTIVITY_FIXTURE_MONTH.month))
    const detail = incoming.get('detail')
    incoming.delete('detail')
    const path = detail ? `/money/activity/${detail}` : '/money/activity'
    return resolveAppHref(`${path}?${incoming.toString()}`)
  })
  const invokerRef = useRef(null)
  const pendingFocusRef = useRef(null)

  function navigate(target) {
    const next = resolveAppHref(target)
    if (next.kind !== 'screen' || !safety.confirmLeave()) return false
    safety.clearAll()
    setRoute(next)
    return true
  }

  function updateQuery(values) {
    const query = new URLSearchParams()
    for (const [key, value] of Object.entries(values ?? {})) {
      if (value !== undefined && value !== null && value !== '') query.set(key, String(value))
    }
    const search = query.toString()
    const parent = route.detail?.parentPath ?? route.pathname
    setRoute(resolveAppHref(search ? `${parent}?${search}` : parent))
    return true
  }

  function openDetail(kind, id) {
    const target = detailHref(kind, id, route.searchParams)
    if (!target || !safety.confirmLeave()) return false
    safety.clearAll()
    invokerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setRoute(resolveAppHref(target))
    return true
  }

  function closeDetail() {
    if (!safety.confirmLeave()) return false
    safety.clearAll()
    pendingFocusRef.current = invokerRef.current
    const destination = parentHrefForDetail(route, null)
    if (destination) setRoute(resolveAppHref(destination.href))
    return true
  }

  return (
    <AppShell
      identity="preview@example.com"
      navigate={navigate}
      onSignOut={async () => true}
      presentation={presentationForRoute(route)}
      route={route}
      screenOwnsHeader={route.screen === 'Activity'}
      takePendingFocusTarget={() => {
        const target = pendingFocusRef.current
        pendingFocusRef.current = null
        return target
      }}
    >
      {route.screen === 'Activity' ? (
        <ActivityScreen
          routeQuery={Object.fromEntries(route.searchParams)}
          onRouteQueryChange={updateQuery}
          detailId={route.detail?.id ?? null}
          onOpenDetail={openDetail}
          onCloseDetail={closeDetail}
          today={ACTIVITY_FIXTURE_TODAY}
          reads={activityFixtureReads}
        />
      ) : (
        <p>Preview covers Activity only.</p>
      )}
    </AppShell>
  )
}

createRoot(document.getElementById('root')).render(
  <AuthProvider>
    <PrefsProvider>
      <NavigationSafetyProvider>
        <PreviewActivity />
      </NavigationSafetyProvider>
    </PrefsProvider>
  </AuthProvider>,
)
