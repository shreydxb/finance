import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { getSetting } from './settings'
import { useAuth } from './AuthContext'
import { DISPLAY_CURRENCIES, formatMoney, fromAED } from './money'

const PrefsContext = createContext(null)

const STORAGE = { currency: 'ourmoney.currency', theme: 'ourmoney.theme' }

function readStored(key, fallback, allowed) {
  try {
    const v = localStorage.getItem(key)
    return allowed.includes(v) ? v : fallback
  } catch {
    return fallback
  }
}

/**
 * Display preferences: which currency to show every figure in, and light/dark.
 *
 * Both are device-local (localStorage), deliberately not stored in the shared
 * `settings` table — Shrey reading in AED on his laptop shouldn't flip Tarika's
 * phone to AED mid-session. FX rates, by contrast, ARE shared, since those are
 * data rather than preference.
 */
export function PrefsProvider({ children }) {
  const { session } = useAuth()
  const [currency, setCurrencyState] = useState(() => readStored(STORAGE.currency, 'AED', DISPLAY_CURRENCIES))
  const [theme, setThemeState] = useState(() => readStored(STORAGE.theme, 'system', ['light', 'dark', 'system']))
  const [fxRates, setFxRates] = useState({ AED: 1 })
  // Distinguishes "rates not loaded yet" from "loaded, and USD genuinely has no
  // rate". Without it the AED-only starting value is indistinguishable from a
  // real answer, which is what let a fresh login format USD figures as AED.
  const [fxLoaded, setFxLoaded] = useState(false)

  const refreshFx = useCallback(
    () =>
      getSetting('fx_rates')
        .then((rates) => {
          if (rates) setFxRates(rates)
          setFxLoaded(true)
          return rates
        })
        .catch(() => {
          // Leave fxLoaded false: rates are unknown, not known-to-be-AED-only,
          // and `toAED` now returns NaN rather than inventing a 1:1 rate.
          setFxLoaded(false)
          return null
        }),
    []
  )

  // Load rates once there is a session, and again whenever the signed-in user
  // changes.
  //
  // This effect used to run unconditionally at mount. PrefsProvider sits above
  // the auth gate in App.jsx, so that fired before sign-in, when `settings` is
  // still RLS-protected and the read throws. `refreshFx` is a stable
  // useCallback, so the effect never re-ran — rates stayed at the AED-only
  // starting value for the whole session, `toAED` correctly returned NaN for
  // every INR and USD figure, and the Investments screen rendered "—" for
  // portfolio value and every holding's converted value. The only way out was
  // to hit Refresh FX in Settings, which calls refreshFx() again while
  // authenticated.
  //
  // Keyed on the user id rather than the session object because Supabase hands
  // back a fresh session on every token refresh, which would otherwise refetch
  // the rates roughly hourly for no reason.
  const userId = session?.user?.id ?? null
  useEffect(() => {
    if (!userId) return
    refreshFx()
  }, [userId, refreshFx])

  // 'system' follows the OS and must keep following it while selected, so the
  // media query stays subscribed rather than being read once at mount.
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = () => {
      const dark = theme === 'dark' || (theme === 'system' && mq.matches)
      document.documentElement.classList.toggle('dark', dark)
      document.documentElement.style.colorScheme = dark ? 'dark' : 'light'
    }
    apply()
    if (theme === 'system') {
      mq.addEventListener('change', apply)
      return () => mq.removeEventListener('change', apply)
    }
  }, [theme])

  const setCurrency = useCallback((next) => {
    setCurrencyState(next)
    try {
      localStorage.setItem(STORAGE.currency, next)
    } catch {
      /* private browsing — the choice just won't persist */
    }
  }, [])

  const setTheme = useCallback((next) => {
    setThemeState(next)
    try {
      localStorage.setItem(STORAGE.theme, next)
    } catch {
      /* as above */
    }
  }, [])

  const value = useMemo(() => {
    /** Format an AED-denominated figure in the chosen display currency. */
    const fmt = (aed, opts) => formatMoney(fromAED(Number(aed), currency, fxRates), currency, opts)
    return { currency, setCurrency, theme, setTheme, fxRates, fmt, fxLoaded, refreshFx }
  }, [currency, setCurrency, theme, setTheme, fxRates, fxLoaded, refreshFx])

  return <PrefsContext.Provider value={value}>{children}</PrefsContext.Provider>
}

export function usePrefs() {
  const ctx = useContext(PrefsContext)
  if (!ctx) throw new Error('usePrefs must be used inside PrefsProvider')
  return ctx
}
