import { useState } from 'react'
import { createRoot } from 'react-dom/client'

import AppShell from './shell/AppShell'
import { NavigationSafetyProvider } from './lib/NavigationSafety'
import { PrefsProvider } from './lib/PrefsContext'
import { AuthProvider } from './lib/AuthContext'
import { useNavigationSafety } from './lib/navigationSafetyContext'
import { presentationForRoute, resolveAppHref } from './lib/routes'
import OverviewScreen from './v6/OverviewScreen'
import { FIXTURE_TODAY, fixtureReads } from './v6/fixtures/canonicalFixture'
import './index.css'

/**
 * Deterministic V6 Overview preview.
 *
 * Renders the real screen inside the real shell against the NON-CONTRACTUAL
 * canonical fixtures, so responsive, visual and accessibility runs have a
 * stable target without a Supabase session. Nothing here ships to the
 * application entry point.
 */
function PreviewOverview() {
  const safety = useNavigationSafety()
  const [route, setRoute] = useState(() => resolveAppHref('/overview'))

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
    setRoute(resolveAppHref(search ? `${route.pathname}?${search}` : route.pathname))
    return true
  }

  return (
    <AppShell
      identity="preview@example.com"
      navigate={navigate}
      onSignOut={async () => true}
      presentation={presentationForRoute(route)}
      route={route}
      screenOwnsHeader={route.screen === 'Overview'}
      takePendingFocusTarget={() => null}
    >
      {route.screen === 'Overview' ? (
        <OverviewScreen
          navigate={navigate}
          routeQuery={Object.fromEntries(route.searchParams)}
          onRouteQueryChange={updateQuery}
          today={FIXTURE_TODAY}
          reads={fixtureReads}
        />
      ) : (
        <p>Preview covers the Overview only.</p>
      )}
    </AppShell>
  )
}

createRoot(document.getElementById('root')).render(
  <AuthProvider>
    <PrefsProvider>
      <NavigationSafetyProvider>
        <PreviewOverview />
      </NavigationSafetyProvider>
    </PrefsProvider>
  </AuthProvider>,
)
