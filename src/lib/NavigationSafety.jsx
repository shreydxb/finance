import { useCallback, useEffect, useMemo, useState } from 'react'
import { confirmNavigation, UNSAVED_CHANGES_MESSAGE } from './navigationGuards'
import { NavigationSafetyContext } from './navigationSafetyContext'

export function NavigationSafetyProvider({ children }) {
  const [dirtyForms, setDirtyForms] = useState(() => new Set())
  const dirty = dirtyForms.size > 0

  useEffect(() => {
    if (!dirty) return undefined
    function handleBeforeUnload(event) {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [dirty])

  const setFormDirty = useCallback((id, nextDirty) => {
    setDirtyForms((current) => {
      const next = new Set(current)
      if (nextDirty) next.add(id)
      else next.delete(id)
      return next
    })
  }, [])

  const clearAll = useCallback(() => setDirtyForms(new Set()), [])
  const confirmLeave = useCallback(
    () => confirmNavigation(dirty, (message) => window.confirm(message ?? UNSAVED_CHANGES_MESSAGE)),
    [dirty],
  )

  const value = useMemo(() => ({
    dirty,
    setFormDirty,
    clearAll,
    confirmLeave,
  }), [clearAll, confirmLeave, dirty, setFormDirty])

  return <NavigationSafetyContext.Provider value={value}>{children}</NavigationSafetyContext.Provider>
}
