import { useState } from 'react'
import { createRoot } from 'react-dom/client'

import AppShell from './shell/AppShell'
import { AuthProvider } from './lib/AuthContext'
import { NavigationSafetyProvider } from './lib/NavigationSafety'
import { useNavigationSafety } from './lib/navigationSafetyContext'
import { PrefsProvider } from './lib/PrefsContext'
import { presentationForRoute, resolveAppHref } from './lib/routes'
import RecurringScreen from './v6/RecurringScreen'
import {
  RECURRING_FIXTURE_MONTH,
  RECURRING_FIXTURE_TODAY,
  recurringFixtureReads,
  recurringFixtureReadsFailed,
  recurringFixtureReadsIncomplete,
  recurringFixtureReadsProvisional,
} from './v6/fixtures/recurringFixture'
import './index.css'

/**
 * Deterministic V6 Recurring preview.
 *
 * Renders the real screen inside the real shell against the NON-CONTRACTUAL
 * period-metrics fixture, so responsive, visual and accessibility runs have a
 * stable target without a Supabase session. Not part of the app entry point.
 *
 * `?fixture=incomplete`, `?fixture=provisional` and `?fixture=failed` select
 * the awkward reads, so a run can assert the fail-closed states as well as the
 * happy path. There is deliberately no fixture that fills the recurring plan:
 * the screen must look exactly as unfinished as the contracts actually are.
 */
function readsFor(kind) {
  if (kind === 'incomplete') return recurringFixtureReadsIncomplete
  if (kind === 'provisional') return recurringFixtureReadsProvisional
  if (kind === 'failed') return recurringFixtureReadsFailed
  return recurringFixtureReads
}

function PreviewRecurring() {
  const safety = useNavigationSafety()
  const [fixture] = useState(() => new URLSearchParams(window.location.search).get('fixture') ?? 'default')
  const [route, setRoute] = useState(() => {
    const incoming = new URLSearchParams(window.location.search)
    incoming.delete('fixture')
    if (!incoming.has('year')) incoming.set('year', String(RECURRING_FIXTURE_MONTH.year))
    if (!incoming.has('month')) incoming.set('month', String(RECURRING_FIXTURE_MONTH.month))
    return resolveAppHref(`/money/recurring?${incoming.toString()}`)
  })

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
    setRoute(resolveAppHref(search ? `/money/recurring?${search}` : '/money/recurring'))
    return true
  }

  return (
    <AppShell
      identity="preview@example.com"
      navigate={navigate}
      onSignOut={async () => true}
      presentation={presentationForRoute(route)}
      route={route}
      screenOwnsHeader={route.screen === 'Recurring'}
      takePendingFocusTarget={() => null}
    >
      {route.screen === 'Recurring' ? (
        <RecurringScreen
          routeQuery={Object.fromEntries(route.searchParams)}
          onRouteQueryChange={updateQuery}
          today={RECURRING_FIXTURE_TODAY}
          reads={readsFor(fixture)}
        />
      ) : (
        <p>Preview covers Recurring only.</p>
      )}
    </AppShell>
  )
}

createRoot(document.getElementById('root')).render(
  <AuthProvider>
    <PrefsProvider>
      <NavigationSafetyProvider>
        <PreviewRecurring />
      </NavigationSafetyProvider>
    </PrefsProvider>
  </AuthProvider>,
)
