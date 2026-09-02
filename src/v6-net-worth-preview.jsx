import { useState } from 'react'
import { createRoot } from 'react-dom/client'

import AppShell from './shell/AppShell'
import { AuthProvider } from './lib/AuthContext'
import { NavigationSafetyProvider } from './lib/NavigationSafety'
import { useNavigationSafety } from './lib/navigationSafetyContext'
import { PrefsProvider } from './lib/PrefsContext'
import { presentationForRoute, resolveAppHref } from './lib/routes'
import NetWorthScreen from './v6/NetWorthScreen'
import { NET_WORTH_FIXTURE_TODAY, netWorthFixtureReadsWith } from './v6/fixtures/netWorthFixture'
import './index.css'

function directRoute(target) {
  const first = resolveAppHref(target)
  return first.kind === 'redirect' ? resolveAppHref(first.to) : first
}

function PreviewNetWorth() {
  const safety = useNavigationSafety()
  const [fixture] = useState(() => new URLSearchParams(window.location.search).get('fixture') ?? 'default')
  const [route, setRoute] = useState(() => {
    const incoming = new URLSearchParams(window.location.search)
    incoming.delete('fixture')
    return directRoute(`/wealth/net-worth${incoming.toString() ? `?${incoming}` : ''}`)
  })

  function navigate(target) {
    const next = directRoute(target)
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
    const next = directRoute(search ? `/wealth/net-worth?${search}` : '/wealth/net-worth')
    window.history.replaceState({}, '', `/v6-net-worth-preview.html${search ? `?${search}&fixture=${fixture}` : `?fixture=${fixture}`}`)
    setRoute(next)
    return true
  }

  return (
    <AppShell
      identity="preview@example.com"
      navigate={navigate}
      onSignOut={async () => true}
      presentation={presentationForRoute(route)}
      route={route}
      screenOwnsHeader={route.screen === 'NetWorth'}
      takePendingFocusTarget={() => null}
    >
      {route.screen === 'NetWorth' ? (
        <NetWorthScreen
          routeQuery={Object.fromEntries(route.searchParams)}
          onRouteQueryChange={updateQuery}
          today={NET_WORTH_FIXTURE_TODAY}
          reads={netWorthFixtureReadsWith(fixture)}
        />
      ) : <p>Preview covers Net Worth only.</p>}
    </AppShell>
  )
}

createRoot(document.getElementById('root')).render(
  <AuthProvider>
    <PrefsProvider>
      <NavigationSafetyProvider>
        <PreviewNetWorth />
      </NavigationSafetyProvider>
    </PrefsProvider>
  </AuthProvider>,
)
