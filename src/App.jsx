import { useState } from 'react'
import { AuthProvider, useAuth } from './lib/AuthContext'
import Login from './screens/Login'
import Home from './screens/Home'
import Accounts from './screens/Accounts'
import Transactions from './screens/Transactions'
import CashFlow from './screens/CashFlow'
import Budget from './screens/Budget'
import Recurring from './screens/Recurring'
import Goals from './screens/Goals'
import Settings from './screens/Settings'

const SCREENS = ['Home', 'Accounts', 'Transactions', 'Cash Flow', 'Budget', 'Recurring', 'Goals', 'Settings']

const BUILT_SCREENS = {
  Home,
  Accounts,
  Transactions,
  'Cash Flow': CashFlow,
  Budget,
  Recurring,
  Goals,
  Settings,
}

function Dashboard() {
  const { signOut } = useAuth()
  const [screen, setScreen] = useState('Home')

  const ActiveScreen = BUILT_SCREENS[screen]

  return (
    <div className="min-h-screen bg-ink-50 text-ink-900">
      {/* Sticky so the nav stays a thumb-reach away on a phone; the blur keeps
          content legible as it scrolls underneath. */}
      <div className="sticky top-0 z-40 border-b border-ink-200 bg-white/85 backdrop-blur-md">
        <header className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3 sm:px-6">
          <div className="flex items-center gap-2.5">
            <span
              aria-hidden="true"
              className="flex h-8 w-8 items-center justify-center rounded-lg bg-ink-900 text-sm font-bold text-white shadow-card"
            >
              ◈
            </span>
            <h1 className="text-base font-semibold tracking-tight">Our Money</h1>
          </div>
          <button
            type="button"
            onClick={() => signOut()}
            className="rounded-lg px-3 py-1.5 text-sm font-medium text-ink-500 transition-colors hover:bg-ink-100 hover:text-ink-900"
          >
            Sign out
          </button>
        </header>

        <nav className="mx-auto max-w-5xl px-2 pb-2 sm:px-4">
          <ul className="flex gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {SCREENS.map((s) => (
              <li key={s}>
                <button
                  type="button"
                  onClick={() => setScreen(s)}
                  aria-current={screen === s ? 'page' : undefined}
                  className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition-all duration-200 ${
                    screen === s
                      ? 'bg-ink-900 text-white shadow-card'
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
      <Gate />
    </AuthProvider>
  )
}

export default App
