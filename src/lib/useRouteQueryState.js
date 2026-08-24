import { useEffect, useMemo, useRef, useState } from 'react'

function decode(defaults, query, schema) {
  const result = { ...defaults }
  for (const [stateKey, definition] of Object.entries(schema)) {
    const [queryKey, parse = (value) => value] = Array.isArray(definition) ? definition : [definition]
    if (query[queryKey] !== undefined) result[stateKey] = parse(query[queryKey])
  }
  return result
}

function encode(values, defaults, schema) {
  const result = {}
  for (const [stateKey, definition] of Object.entries(schema)) {
    const [queryKey, , serialize = (value) => String(value)] = Array.isArray(definition) ? definition : [definition]
    const value = values[stateKey]
    if (value !== defaults[stateKey] && value !== '' && value !== false && value !== null && value !== undefined) {
      result[queryKey] = serialize(value)
    }
  }
  return result
}

export function useRouteQueryState(defaults, schema, routeQuery = {}, onRouteQueryChange) {
  const external = useMemo(() => decode(defaults, routeQuery, schema), [defaults, routeQuery, schema])
  const signature = JSON.stringify(external)
  const [state, setState] = useState(external)
  const stateRef = useRef(external)

  useEffect(() => {
    stateRef.current = external
    setState(external)
    // The serialized state is the synchronization boundary for Back/Forward.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature])

  function updateState(update) {
    const next = typeof update === 'function' ? update(stateRef.current) : update
    stateRef.current = next
    setState(next)
    onRouteQueryChange?.(encode(next, defaults, schema))
  }

  return [state, updateState]
}
