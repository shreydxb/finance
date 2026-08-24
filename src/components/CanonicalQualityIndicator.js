import { createElement, useId } from 'react'

import { qualityCopy } from '../lib/canonicalPresentation.js'

const styles = {
  complete: 'bg-pos-50 text-pos-700',
  provisional: 'bg-amber-50 text-amber-800',
  incomplete: 'bg-ink-100 text-ink-600',
}

export default function CanonicalQualityIndicator({ metrics, className = '' }) {
  const copy = qualityCopy(metrics)
  const detailId = useId()

  return createElement(
    'details',
    { className: `group relative inline-flex ${className}` },
    createElement(
      'summary',
      {
        className: `inline-flex cursor-help list-none items-center gap-1.5 rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-wide outline-none ring-offset-2 transition-shadow focus-visible:ring-2 focus-visible:ring-brand-500 [&::-webkit-details-marker]:hidden ${styles[metrics.quality_status]}`,
        tabIndex: 0,
        'aria-describedby': detailId,
      },
      createElement('span', { className: 'h-1.5 w-1.5 rounded-full bg-current', 'aria-hidden': 'true' }),
      copy.label
    ),
    createElement(
      'span',
      {
        id: detailId,
        role: 'tooltip',
        className: 'invisible absolute right-0 top-full z-30 mt-2 w-72 rounded-xl border border-ink-100 bg-white px-3 py-2 text-left text-xs font-normal normal-case leading-relaxed tracking-normal text-ink-700 opacity-0 shadow-lg transition-opacity group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100 group-open:visible group-open:opacity-100',
      },
      copy.detail
    )
  )
}
