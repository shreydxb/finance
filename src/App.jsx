import { useState } from 'react'
import { AuthProvider, useAuth } from './lib/AuthContext'
import { PrefsProvider, usePrefs } from './lib/PrefsContext'
import { DISPLAY_CURRENCIES } from './lib/money'
import Login from './screens/Login'
import Home from './screens/Home'
import Accounts from './screens/Accounts'
import Investments from './screens/Investments'
import Transactions from './screens/Transactions'
import Reports from './screens/Reports'
import Budget from './screens/Budget'
import Recurring from './screens/Recurring'
import Goals from './screens/Goals'
import Debts from './screens/Debts'
import Settings from './screens/Settings'

const SCREENS = [
  'Home',
  'Accounts',
  'Investments',
  'Transactions',
  'Reports',
  'Budget',
  'Recurring',
  'Goals',
  'Debts',
  'Settings',
]

const BUILT_SCREENS = {
  Home,
  Accounts,
  Investments,
  Transactions,
  Reports,
  Budget,
  Recurring,
  Goals,
  Debts,
  Settings,
}

/** Currency + light/dark, in the header so they're reachable from any screen. */
function DisplayControls() {
  const { currency, setCurrency, theme, setTheme } = usePrefs()

  // Cycles light → dark → system, so "follow the OS" stays reachable without
  // hiding it behind a menu.
  const nextTheme = theme === 'light' ? 'dark' : theme === 'dark' ? 'system' : 'light'
  const themeIcon = theme === 'light' ? '☀' : theme === 'dark' ? '☾' : '◐'
  const themeLabel = theme === 'system' ? 'Theme: following system' : `Theme: ${theme}`

  return (
    <div className="flex items-center gap-1.5">
      <div className="flex rounded-lg bg-ink-100 p-0.5 text-xs">
        {DISPLAY_CURRENCIES.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setCurrency(c)}
            aria-pressed={currency === c}
            className={`rounded-md px-2 py-1 font-medium transition-colors ${
              currency === c ? 'bg-surface text-ink-900 shadow-card' : 'text-ink-500 hover:text-ink-900'
            }`}
          >
            {c}
          </button>
        ))}
      </div>
      <button
        type="button"
        onClick={() => setTheme(nextTheme)}
        title={themeLabel}
        aria-label={themeLabel}
        className="rounded-lg px-2 py-1.5 text-sm text-ink-500 transition-colors hover:bg-ink-100 hover:text-ink-900"
      >
        {themeIcon}
      </button>
    </div>
  )
}

function Dashboard() {
  const { signOut } = useAuth()
  const [screen, setScreen] = useState('Home')

  const ActiveScreen = BUILT_SCREENS[screen]

  return (
    <div className="min-h-screen bg-ink-50 text-ink-900">
      <div className="sticky top-0 z-40 border-b border-ink-200 bg-surface/85 backdrop-blur-md">
        <header className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-2.5">
            <span
              aria-hidden="true"
              className="flex h-8 w-8 items-center justify-center rounded-lg bg-ink-900 text-sm font-bold text-ink-50 shadow-card"
            >
              ◈
            </span>
            <h1 className="text-base font-semibold tracking-tight">Our Money</h1>
          </div>
          <div className="flex items-center gap-1.5">
            <DisplayControls />
            <button
              type="button"
              onClick={() => signOut()}
              className="rounded-lg px-3 py-1.5 text-sm font-medium text-ink-500 transition-colors hover:bg-ink-100 hover:text-ink-900"
            >
              Sign out
            </button>
          </div>
        </header>

        <nav className="mx-auto max-w-6xl px-2 pb-2 sm:px-4">
          <ul className="flex gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {SCREENS.map((s) => (
              <li key={s}>
                <button
                  type="button"
                  onClick={() => setScreen(s)}
                  aria-current={screen === s ? 'page' : undefined}
                  className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition-all duration-200 ${
                    screen === s
                      ? 'bg-ink-900 text-ink-50 shadow-card'
                      : 'text-ink-500 hover:bg-ink-100 hover:text-ink-900'
                  }`}
                >
                  {s}
                </button>
              </li>
            ))}
          </ul>
        </nav>
      </div>

      {/* Keyed on the screen name so switching tabs remounts and replays the
          entrance animation — that transition is most of what makes the app
          feel responsive rather than static. */}
      <main key={screen} className="animate-fade">
        {ActiveScreen ? (
          // Home's "see all" links jump between tabs; other screens ignore it.
          <ActiveScreen onNavigate={setScreen} />
        ) : (
          <p className="mx-auto max-w-3xl px-6 py-10 text-center text-sm text-ink-500">
            {screen} is coming in a later epic.
          </p>
        )}
      </main>
    </div>
  )
}

function Gate() {
  const { session, loading } = useAuth()

  if (loading) return null
  return session ? <Dashboard /> : <Login />
}

function App() {
  return (
    <AuthProvider>
      <PrefsProvider>
        <Gate />
      </PrefsProvider>
    </AuthProvider>
  )
}

export default App
