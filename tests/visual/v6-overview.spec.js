import { expect, test } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

/**
 * Desktop and mobile are both first-class for the V6 Overview, so both are
 * captured and asserted rather than one being checked and the other assumed to
 * follow. 1440 × 1200 is the frozen reference viewport; 900px is the
 * prototype's single encoded breakpoint; 390px and 320px are the phone widths
 * the mobile parity matrix names.
 */
const VIEWPORTS = [
  { name: 'phone', width: 390, height: 844 },
  { name: 'breakpoint', width: 900, height: 1000 },
  { name: 'desktop', width: 1440, height: 1200 },
]

async function openOverview(page, viewport, theme) {
  await page.setViewportSize({ width: viewport.width, height: viewport.height })
  await page.goto('/v6-overview-preview.html')
  await page.evaluate((value) => localStorage.setItem('ourmoney.theme', value), theme)
  await page.reload()
  await page.evaluate(() => document.fonts.ready)
  await page.getByRole('heading', { name: 'Net worth' }).waitFor()
  // Let the prototype's entry animations finish before measuring. A partly
  // faded element composites its own colour, which makes contrast results
  // depend on timing rather than on the palette.
  await page.evaluate(() => Promise.all(document.getAnimations().map((animation) => animation.finished.catch(() => {}))))
  await page.addStyleTag({ content: '* { caret-color: transparent !important; }' })
}

async function hasHorizontalOverflow(page) {
  return page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)
}

/*
 * Pixel baselines for this screen are deliberately NOT committed from this
 * session's container: it ships Chromium build 1194 while @playwright/test
 * 1.62.1 expects 1234, and the repository's existing `foundation` and `shell`
 * baselines already differ here by ~3% of pixels for the same reason. Adding
 * baselines captured on the wrong build would turn the suite red everywhere
 * else. Generate them in the canonical environment with:
 *
 *   npm run test:visual -- tests/visual/v6-overview.spec.js --update-snapshots
 *
 * The assertions below are browser-build independent — computed geometry,
 * overflow, target size, keyboard operation, motion and axe — so they run
 * meaningfully in any environment.
 */

test('the Overview renders at every reference viewport in both themes', async ({ page }) => {
  for (const viewport of VIEWPORTS) {
    for (const theme of ['light', 'dark']) {
      await openOverview(page, viewport, theme)
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
      await expect(page.getByRole('heading', { name: 'Net worth' })).toBeVisible()
      await expect(page.getByRole('heading', { name: 'Data quality and freshness' })).toBeVisible()
      const painted = await page.evaluate(() => getComputedStyle(document.body).backgroundColor)
      expect(painted, `${viewport.name}/${theme} must paint its own ground`).not.toBe('rgba(0, 0, 0, 0)')
      expect(await hasHorizontalOverflow(page)).toBe(false)
    }
  }
})

test('the Overview never overflows horizontally, down to 320px and at 200% text zoom', async ({ page }) => {
  for (const width of [1440, 900, 768, 390, 320]) {
    await openOverview(page, { width, height: 900 }, 'light')
    expect(await hasHorizontalOverflow(page), `page overflows at ${width}px`).toBe(false)
    // Every scrolling data region must contain its own overflow rather than
    // pushing the page sideways.
    const contained = await page.evaluate(() => Array.from(document.querySelectorAll('.v6-data-scroll'))
      .every((node) => node.scrollWidth <= node.clientWidth || getComputedStyle(node).overflowX === 'auto'))
    expect(contained).toBe(true)
  }

  await openOverview(page, { width: 390, height: 844 }, 'light')
  await page.addStyleTag({ content: 'html { font-size: 200% }' })
  expect(await hasHorizontalOverflow(page)).toBe(false)
})

test('the desktop composition reproduces the prototype hierarchy and geometry', async ({ page }) => {
  await openOverview(page, VIEWPORTS[2], 'light')

  const sidebar = page.locator('.shell-sidebar')
  await expect(sidebar).toBeVisible()
  expect(await sidebar.evaluate((node) => getComputedStyle(node).width)).toBe('216px')

  const frame = page.locator('.shell-content-frame')
  expect(await frame.evaluate((node) => getComputedStyle(node).padding)).toBe('34px 40px 64px')

  // Five KPI columns separated by rules on desktop.
  const kpiColumns = await page.locator('.v6-kpi-row').evaluate((node) => getComputedStyle(node).gridTemplateColumns)
  expect(kpiColumns.split(' ')).toHaveLength(5)

  // The three-column detail region: top spend, recent activity, accounts.
  const detailColumns = await page.locator('.v6-g3').evaluate((node) => getComputedStyle(node).gridTemplateColumns)
  expect(detailColumns.split(' ')).toHaveLength(3)

  const heroSize = await page.locator('.v6-hero-value').evaluate((node) => getComputedStyle(node).fontSize)
  expect(heroSize).toBe('52px')
})

test('the mobile composition stacks rather than shrinking the desktop layout', async ({ page }) => {
  await openOverview(page, VIEWPORTS[0], 'light')

  await expect(page.locator('.shell-sidebar')).toBeHidden()
  await expect(page.locator('.shell-mobile-region')).toBeVisible()

  const frame = page.locator('.shell-content-frame')
  expect(await frame.evaluate((node) => getComputedStyle(node).padding)).toBe('22px 18px 80px')

  for (const selector of ['.v6-kpi-row', '.v6-g2', '.v6-g3']) {
    const columns = await page.locator(selector).first().evaluate((node) => getComputedStyle(node).gridTemplateColumns)
    expect(columns.split(' '), `${selector} must be one column on mobile`).toHaveLength(1)
  }

  const heroSize = await page.locator('.v6-hero-value').evaluate((node) => getComputedStyle(node).fontSize)
  expect(heroSize).toBe('38px')

  // Reading order is preserved: hero, KPIs, cash flow, attention, obligations.
  const headings = await page.getByRole('heading').allTextContents()
  expect(headings.indexOf('Net worth')).toBeLessThan(headings.indexOf('Cash flow'))
  expect(headings.indexOf('Cash flow')).toBeLessThan(headings.indexOf('Needs attention'))
  expect(headings.indexOf('Needs attention')).toBeLessThan(headings.indexOf('Next 30 days'))
})

test('every Overview control meets the 44px target requirement on touch widths', async ({ page }) => {
  await openOverview(page, VIEWPORTS[0], 'light')
  const targets = page.locator('#main-content').getByRole('button').or(page.locator('#main-content').getByRole('link'))
  const count = await targets.count()
  expect(count).toBeGreaterThan(0)
  for (let index = 0; index < count; index += 1) {
    const box = await targets.nth(index).boundingBox()
    if (!box) continue
    expect(box.height, `target ${index} is ${box.height}px tall`).toBeGreaterThanOrEqual(44)
  }
})

test('the period control is keyboard operable and deep-links the selection', async ({ page }) => {
  await openOverview(page, VIEWPORTS[2], 'light')
  const group = page.getByRole('group', { name: 'Overview period' })
  await expect(group.getByRole('button', { name: 'Month to date' })).toHaveAttribute('aria-pressed', 'true')

  await group.getByRole('button', { name: 'Year to date' }).focus()
  await page.keyboard.press('Enter')
  await expect(group.getByRole('button', { name: 'Year to date' })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('heading', { level: 1 })).toContainText('year to date')
})

test('reduced motion renders the final Overview state immediately', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await openOverview(page, VIEWPORTS[2], 'light')
  const animated = await page.evaluate(() => Array.from(document.querySelectorAll('.v6-enter, .v6-chart-bar, .v6-bar-fill'))
    .map((node) => ({
      entry: node.classList.contains('v6-enter'),
      opacity: getComputedStyle(node).opacity,
      transform: getComputedStyle(node).transform,
      animations: node.getAnimations().length,
    })))
  expect(animated.length).toBeGreaterThan(0)
  for (const node of animated) {
    // No animation is running, and nothing is left mid-fade or mid-grow.
    expect(node.animations).toBe(0)
    expect(node.transform === 'none' || node.transform === 'matrix(1, 0, 0, 1, 0, 0)').toBe(true)
    // The tiered opacity on top-spend bars is static styling, not an entry
    // animation, so only the fade-in regions must be fully opaque.
    if (node.entry) expect(Number(node.opacity)).toBe(1)
  }
  const results = await new AxeBuilder({ page }).analyze()
  expect(results.violations).toEqual([])
})

test('the Overview has no automated accessibility violations on desktop or phone', async ({ page }) => {
  for (const viewport of [VIEWPORTS[2], VIEWPORTS[0]]) {
    for (const theme of ['light', 'dark']) {
      await openOverview(page, viewport, theme)
      const results = await new AxeBuilder({ page }).analyze()
      expect(results.violations, `${viewport.name}/${theme}`).toEqual([])
    }
  }
})
