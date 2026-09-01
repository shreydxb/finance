import { useState } from 'react'
import { createRoot } from 'react-dom/client'

import AppShell from './shell/AppShell'
import { AuthProvider } from './lib/AuthContext'
import { NavigationSafetyProvider } from './lib/NavigationSafety'
import { useNavigationSafety } from './lib/navigationSafetyContext'
import { PrefsProvider } from './lib/PrefsContext'
import { presentationForRoute, resolveAppHref } from './lib/routes'
import InsightsScreen from './v6/InsightsScreen'
import {
  INSIGHTS_FIXTURE_PERIOD,
  INSIGHTS_FIXTURE_TODAY,
  insightsFixtureReadsWith,
} from './v6/fixtures/insightsFixture'
import './index.css'

function directRoute(target) {
  const first = resolveAppHref(target)
  return first.kind === 'redirect' ? resolveAppHref(first.to) : first
}

function PreviewInsights() {
  const safety = useNavigationSafety()
  const [fixture] = useState(() => new URLSearchParams(window.location.search).get('fixture') ?? 'default')
  const [route, setRoute] = useState(() => {
    const incoming = new URLSearchParams(window.location.search)
    incoming.delete('fixture')
    if (!incoming.has('year')) incoming.set('year', String(INSIGHTS_FIXTURE_PERIOD.year))
    if (!incoming.has('month')) incoming.set('month', String(INSIGHTS_FIXTURE_PERIOD.month))
    if (!incoming.has('quarter')) incoming.set('quarter', String(INSIGHTS_FIXTURE_PERIOD.quarter))
    return directRoute(`/money/insights?${incoming.toString()}`)
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
    const next = directRoute(search ? `/money/insights?${search}` : '/money/insights')
    window.history.replaceState({}, '', `/v6-insights-preview.html${search ? `?${search}&fixture=${fixture}` : `?fixture=${fixture}`}`)
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
      screenOwnsHeader={route.screen === 'Insights'}
      takePendingFocusTarget={() => null}
    >
      {route.screen === 'Insights' ? (
        <InsightsScreen
          routeQuery={Object.fromEntries(route.searchParams)}
          onRouteQueryChange={updateQuery}
          today={INSIGHTS_FIXTURE_TODAY}
          reads={insightsFixtureReadsWith(fixture)}
        />
      ) : <p>Preview covers Insights only.</p>}
    </AppShell>
  )
}

createRoot(document.getElementById('root')).render(
  <AuthProvider>
    <PrefsProvider>
      <NavigationSafetyProvider>
        <PreviewInsights />
      </NavigationSafetyProvider>
    </PrefsProvider>
  </AuthProvider>,
)
