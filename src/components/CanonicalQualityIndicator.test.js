import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import CanonicalQualityIndicator from './CanonicalQualityIndicator.js'

function metrics(overrides = {}) {
  return {
    quality_status: 'complete',
    missing_fx_count: 0,
    needs_review_count: 0,
    zero_placeholder_count: 0,
    quality_metadata: {
      fx_basis: 'current_rate_aed',
      fx_updated_at: '2026-07-31T12:00:00Z',
      missing_fx_currencies: [],
      income_incomplete_count: 0,
      consumption_incomplete_count: 0,
      savings_movement_incomplete_count: 0,
      provisional_transaction_count: 0,
      zero_placeholder_count: 0,
    },
    ...overrides,
  }
}

function render(metricsValue) {
  return renderToStaticMarkup(createElement(CanonicalQualityIndicator, { metrics: metricsValue }))
}

test('quality indicator is a keyboard-focusable disclosure with rendered accessible detail', () => {
  const html = render(metrics())
  assert.match(html, /^<details/)
  assert.match(html, /<summary[^>]*tabindex="0"[^>]*aria-describedby="([^"]+)"/)
  assert.match(html, /role="tooltip"/)
  assert.match(html, /All required canonical inputs are complete/)
  assert.match(html, /Current-rate AED basis/)
  assert.match(html, /FX updated 2026-07-31 12:00:00 UTC/)
  assert.doesNotMatch(html, /title=/)
})

test('quality indicator renders provisional and incomplete evidence in its disclosure', () => {
  const provisional = render(metrics({
    quality_status: 'provisional',
    needs_review_count: 4,
    quality_metadata: { ...metrics().quality_metadata, provisional_transaction_count: 3 },
  }))
  assert.match(provisional, /4 needs_review transactions/)
  assert.match(provisional, /3 provisional canonical transactions/)

  const incomplete = render(metrics({
    quality_status: 'incomplete',
    missing_fx_count: 1,
    zero_placeholder_count: 2,
    quality_metadata: {
      ...metrics().quality_metadata,
      missing_fx_currencies: ['USD'],
      consumption_incomplete_count: 2,
      zero_placeholder_count: 2,
    },
  }))
  assert.match(incomplete, /2 unresolved zero placeholders/)
  assert.match(incomplete, /1 entry missing required FX \(USD\)/)
  assert.match(incomplete, /2 incomplete consumption inputs/)
})
