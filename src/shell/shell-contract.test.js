import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const shellCss = readFileSync(new URL('./shell.css', import.meta.url), 'utf8')
const tokensCss = readFileSync(new URL('../design-system/tokens.css', import.meta.url), 'utf8')

test('V6 shell keeps the frozen desktop and responsive geometry', () => {
  assert.match(tokensCss, /--ds-sidebar-width:\s*216px/)
  assert.match(tokensCss, /--ds-content-width:\s*1240px/)
  assert.match(shellCss, /padding:\s*34px 40px 64px/)
  assert.match(shellCss, /@media \(max-width:\s*900px\)/)
  assert.match(shellCss, /padding:\s*22px 18px 80px/)
  assert.match(shellCss, /grid-template-columns:\s*repeat\(5, minmax\(110px, 1fr\)\)/)
  assert.doesNotMatch(shellCss, /bottom-nav/)
})

test('V6 tokens retain exact light and dark semantic roles and restrained motion', () => {
  for (const value of ['#f8f5ef', '#1a1712', '#0d0c0a', '#f2ede4', '#9c5d26', '#c98b52']) {
    assert.ok(tokensCss.includes(value), `missing ${value}`)
  }
  assert.match(tokensCss, /--ds-duration-micro:\s*120ms/)
  assert.match(tokensCss, /--ds-duration-standard:\s*140ms/)
  assert.match(tokensCss, /--radius-control:\s*2px/)
  assert.match(tokensCss, /--shadow-elevation-3:\s*none/)
})
