import { lazy, Suspense } from 'react'

const DetailShell = lazy(() => import('./DetailShell'))

export default function RouteDetailShell(props) {
  return (
    <Suspense fallback={<p role="status" className="sr-only">Loading detail…</p>}>
      <DetailShell {...props} />
    </Suspense>
  )
}
