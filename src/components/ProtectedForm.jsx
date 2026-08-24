import { useEffect, useId } from 'react'
import { useNavigationSafety } from '../lib/navigationSafetyContext'

export default function ProtectedForm({ onChangeCapture, ...props }) {
  const id = useId()
  const { setFormDirty } = useNavigationSafety()

  useEffect(() => () => setFormDirty(id, false), [id, setFormDirty])

  function handleChange(event) {
    setFormDirty(id, true)
    onChangeCapture?.(event)
  }

  return <form {...props} onChangeCapture={handleChange} />
}
