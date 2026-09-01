import { useState } from 'react'
import { createRoot } from 'react-dom/client'

import AppShell from './shell/AppShell'
import { AuthProvider } from './lib/AuthContext'
import { NavigationSafetyProvider } from './lib/NavigationSafety'
import { useNavigationSafety } from './lib/navigationSafetyContext'
import { PrefsProvider } from './lib/PrefsContext'
import { presentationForRoute, resolveAppHref } from './lib/routes'
import BudgetScreen from './v6/BudgetScreen'
import {
  BUDGET_FIXTURE_INCOMPLETE_MONTH,
  BUDGET_FIXTURE_MONTH,
  BUDGET_FIXTURE_TODAY,
  budgetFixtureReads,
  budgetFixtureReadsWith,
} from './v6/fixtures/budgetFixture'
import './index.css'

/**
 * Deterministic V6 Budget preview.
 *
 * Renders the real screen inside the real shell against the NON-CONTRACTUAL
 * Budget fixtures, so responsive, visual and accessibility runs have a stable
 * target without a Supabase session. Not part of the app entry point.
 *
 * `?fixture=incomplete` and `?fixture=unreconciled` select the awkward reads,
 * so a run can assert the fail-closed states as well as the happy path.
 */
function readsFor(kind) {
  if (kind === 'incomplete') return budgetFixtureReadsWith(BUDGET_FIXTURE_INCOMPLETE_MONTH)
  if (kind === 'unreconciled') return budgetFixtureReadsWith(null, { breakReconciliation: true })
  if (kind === 'failed') {
    return Object.freeze({
      async listBudgetActuals() { throw new Error('category actuals offline') },
      async getPeriodMetrics() { throw new Error('period metrics offline') },
    })
  }
  return budgetFixtureReads
}

function PreviewBudget() {
  const safety = useNavigationSafety()
  const [fixture] = useState(() => new URLSearchParams(window.location.search).get('fixture') ?? 'default')
  const [route, setRoute] = useState(() => {
    const incoming = new URLSearchParams(window.location.search)
    incoming.delete('fixture')
    if (!incoming.has('year')) incoming.set('year', String(BUDGET_FIXTURE_MONTH.year))
    if (!incoming.has('month')) incoming.set('month', String(BUDGET_FIXTURE_MONTH.month))
    return resolveAppHref(`/money/budget?${incoming.toString()}`)
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
    setRoute(resolveAppHref(search ? `/money/budget?${search}` : '/money/budget'))
    return true
  }

  return (
    <AppShell
      identity="preview@example.com"
      navigate={navigate}
      onSignOut={async () => true}
      presentation={presentationForRoute(route)}
      route={route}
      screenOwnsHeader={route.screen === 'Budget'}
      takePendingFocusTarget={() => null}
    >
      {route.screen === 'Budget' ? (
        <BudgetScreen
          routeQuery={Object.fromEntries(route.searchParams)}
          onRouteQueryChange={updateQuery}
          today={BUDGET_FIXTURE_TODAY}
          reads={readsFor(fixture)}
        />
      ) : (
        <p>Preview covers Budget only.</p>
      )}
    </AppShell>
  )
}

createRoot(document.getElementById('root')).render(
  <AuthProvider>
    <PrefsProvider>
      <NavigationSafetyProvider>
        <PreviewBudget />
      </NavigationSafetyProvider>
    </PrefsProvider>
  </AuthProvider>,
)
