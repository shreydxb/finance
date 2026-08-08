import { useEffect, useRef, useState } from 'react'

/**
 * Counts a figure up to its value on mount and whenever it changes.
 *
 * Uses requestAnimationFrame rather than a CSS transition because the thing
 * being animated is the *formatted text*, not a style — money needs its
 * thousands separators and currency prefix at every frame.
 *
 * Honours prefers-reduced-motion by rendering the final value immediately.
 */
export default function AnimatedNumber({ value, format, duration = 700, className }) {
  const [display, setDisplay] = useState(value)
  const fromRef = useRef(value)
  const frameRef = useRef(0)

  useEffect(() => {
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    const from = fromRef.current
    const to = value

    if (reduced || from === to) {
      setDisplay(to)
      fromRef.current = to
      return
    }

    const start = performance.now()
    // easeOutExpo — fast start, long settle. Reads as the number "landing"
    // rather than crawling linearly to its destination.
    const ease = (t) => (t === 1 ? 1 : 1 - Math.pow(2, -10 * t))

    function tick(now) {
      const t = Math.min(1, (now - start) / duration)
      setDisplay(from + (to - from) * ease(t))
      if (t < 1) {
        frameRef.current = requestAnimationFrame(tick)
      } else {
        fromRef.current = to
      }
    }

    frameRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frameRef.current)
  }, [value, duration])

  return <span className={className}>{format(display)}</span>
}
