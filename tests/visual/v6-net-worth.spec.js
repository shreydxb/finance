import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'

const VIEWPORTS = [
  { name: 'phone-320', width: 320, height: 800 },
  { name: 'phone-390', width: 390, height: 900 },
  { name: 'tablet', width: 768, height: 1000 },
  { name: 'breakpoint', width: 900, height: 1000 },
  { name: 'desktop', width: 1440, height: 1200 },
]

async function openNetWorth(page, viewport, { theme = 'light', query = '' } = {}) {
  await page.setViewportSize({ width: viewport.width, height: viewport.height })
  const join = query ? `${query}&fixture=default` : '?fixture=default'
  await page.goto(`/v6-net-worth-preview.html${join}`)
  await page.evaluate((value) => localStorage.setItem('ourmoney.theme', value), theme)
  await page.reload()
  await page.evaluate(() => document.fonts.ready)
  await page.getByRole('heading', { level: 1, name: 'Net worth' }).waitFor()
  await page.getByText('2,050,000').waitFor()
  await page.evaluate(() => Promise.all(document.getAnimations().map((animation) => animation.finished.catch(() => undefined))))
}

async function hasPageOverflow(page) {
  return page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)
}

test('Net Worth is contained at every established width in light and dark mode', async ({ page }) => {
  test.setTimeout(180_000)
  for (const viewport of VIEWPORTS) {
    for (const theme of ['light', 'dark']) {
      await openNetWorth(page, viewport, { theme })
      expect(await hasPageOverflow(page), `${viewport.name}/${theme}`).toBe(false)
      await expect(page.getByText('Provisional', { exact: true }).first()).toBeVisible()
      await expect(page.getByText('Skipped — incomplete')).toBeVisible()
    }
  }
})

test('320px and 390px preserve mobile reading order and contain the history table', async ({ page }) => {
  for (const width of [320, 390]) {
    await openNetWorth(page, { width, height: 900 })
    expect(await hasPageOverflow(page), `${width}px`).toBe(false)
    const positions = page.locator('.v6-wealth-positions')
    expect(await positions.evaluate((node) => getComputedStyle(node).gridTemplateColumns.split(' ').length)).toBe(1)
    const tableRegion = page.getByRole('region', { name: 'Authoritative net worth history table' })
    await expect(tableRegion).toBeVisible()
    expect(await tableRegion.evaluate((node) => getComputedStyle(node).overflowX)).toBe('auto')
  }
})

test('200% text zoom preserves financial and missing-contract truth without page overflow', async ({ page }) => {
  await openNetWorth(page, VIEWPORTS[1])
  await page.addStyleTag({ content: 'html { font-size: 200% }' })
  expect(await hasPageOverflow(page)).toBe(false)
  await expect(page.getByRole('heading', { level: 1, name: 'Net worth' })).toBeVisible()
  await expect(page.getByText(/SHR-156 \/ SHR-173/)).toBeVisible()
  await expect(page.getByText(/SHR-172 \/ SHR-173/)).toBeVisible()
})

test('range controls meet 44px, operate by keyboard and survive reload', async ({ page }) => {
  await openNetWorth(page, VIEWPORTS[1], { query: '?range=5y' })
  const group = page.getByRole('group', { name: 'Net worth history range' })
  const controls = group.getByRole('button')
  for (let index = 0; index < await controls.count(); index += 1) {
    const box = await controls.nth(index).boundingBox()
    expect(box.height, `range target ${index}`).toBeGreaterThanOrEqual(44)
  }
  await expect(group.getByRole('button', { name: '5Y' })).toHaveAttribute('aria-pressed', 'true')
  await group.getByRole('button', { name: 'All' }).focus()
  await page.keyboard.press('Enter')
  await expect(group.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true')
  await expect(page).toHaveURL(/range=all/)
  await page.reload()
  await expect(page.getByRole('group', { name: 'Net worth history range' }).getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true')
})

test('the screen is read-only and does not expose unsupported financial claims', async ({ page }) => {
  await openNetWorth(page, VIEWPORTS[4])
  const main = page.locator('#main-content')
  await expect(main.locator('form, input, textarea, select')).toHaveCount(0)
  await expect(main.getByRole('button', { name: /Add|Edit|Save|Delete|Create|Refresh|Generate/ })).toHaveCount(0)
  const claimed = await page.evaluate(() => {
    const clone = document.querySelector('#main-content').cloneNode(true)
    for (const region of clone.querySelectorAll('.v6-unavailable')) region.remove()
    return clone.textContent
  })
  expect(claimed).not.toMatch(/[+−-]\d+(?:\.\d+)?%/)
  expect(claimed).not.toMatch(/CAGR|growth rate|average growth|forecast|projection|trending|grew|declined/i)
  expect(claimed).not.toMatch(/fixture-label|50\/50|half of shared|equity share/i)
})

test('empty, incomplete and failed states remain honest and contained', async ({ page }) => {
  for (const fixture of ['empty', 'incomplete', 'failed']) {
    await page.setViewportSize({ width: 390, height: 900 })
    await page.goto(`/v6-net-worth-preview.html?fixture=${fixture}`)
    await page.getByRole('heading', { level: 1, name: 'Net worth' }).waitFor()
    await expect(page.getByText(/Reading canonical wealth contracts/)).toHaveCount(0)
    expect(await hasPageOverflow(page), fixture).toBe(false)
    if (fixture === 'empty') await expect(page.getByText(/No snapshot facts in this range/)).toBeVisible()
    if (fixture === 'incomplete') await expect(page.getByText('Incomplete').first()).toBeVisible()
    if (fixture === 'failed') await expect(page.getByText(/Snapshot history is not available/)).toBeVisible()
  }
})

test('reduced motion renders final Net Worth geometry immediately', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await openNetWorth(page, VIEWPORTS[4])
  const animated = await page.evaluate(() => Array.from(document.querySelectorAll('.v6-enter, .v6-wealth-asset-bar, .v6-wealth-liability-bar, .v6-wealth-net-point'))
    .map((node) => ({ opacity: getComputedStyle(node).opacity, animations: node.getAnimations().length })))
  expect(animated.length).toBeGreaterThan(0)
  for (const node of animated) {
    expect(node.animations).toBe(0)
    expect(Number(node.opacity)).toBe(1)
  }
})

test('Net Worth passes axe for themes, phone, desktop and incomplete state', async ({ page }) => {
  test.setTimeout(180_000)
  for (const viewport of [VIEWPORTS[1], VIEWPORTS[4]]) {
    for (const theme of ['light', 'dark']) {
      await openNetWorth(page, viewport, { theme })
      const results = await new AxeBuilder({ page }).analyze()
      expect(results.violations, `${viewport.name}/${theme}`).toEqual([])
    }
  }
  await page.setViewportSize({ width: 390, height: 900 })
  await page.goto('/v6-net-worth-preview.html?fixture=incomplete')
  await page.getByText('Incomplete').first().waitFor()
  await page.evaluate(() => Promise.all(document.getAnimations().map((animation) => animation.finished.catch(() => undefined))))
  const incomplete = await new AxeBuilder({ page }).analyze()
  expect(incomplete.violations).toEqual([])
})
