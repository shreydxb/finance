import { qualityCopy } from '../lib/canonicalPresentation'

const styles = {
  complete: 'bg-pos-50 text-pos-700',
  provisional: 'bg-amber-50 text-amber-800',
  incomplete: 'bg-ink-100 text-ink-600',
}

export default function CanonicalQualityIndicator({ metrics, className = '' }) {
  const copy = qualityCopy(metrics)
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-wide ${styles[metrics.quality_status]} ${className}`}
      title={copy.detail}
      aria-label={`${copy.label}: ${copy.detail}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />
      {copy.label}
    </span>
  )
}
