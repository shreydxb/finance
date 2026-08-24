import { createContext, useContext } from 'react'

export const NavigationSafetyContext = createContext(null)

export function useNavigationSafety() {
  const value = useContext(NavigationSafetyContext)
  if (!value) throw new Error('useNavigationSafety must be used inside NavigationSafetyProvider')
  return value
}
