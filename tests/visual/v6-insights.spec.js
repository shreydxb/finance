import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'

const VIEWPORTS = [
  { name: 'phone-320', width: 320, height: 760 },
  { name: 'phone-390', width: 390, height: 844 },
  { name: 'tablet', width: 768, height: 1000 },
  { name: 'breakpoint', width: 900, height: 1000 },
  { name: 'desktop', width: 1440, height: 1200 },
  { name: 'wide', width: 1920, height: 1200 },
]

async function openInsights(page, viewport, { theme = 'light', query = '' } = {}) {
  await page.setViewportSize({ width: viewport.width, height: viewport.height })
  const join = query ? `${query}&fixture=default` : '?fixture=default'
  await page.goto(`/v6-insights-preview.html${join}`)
  await page.evaluate((value) => localStorage.setItem('ourmoney.theme', value), theme)
  await page.reload()
  await page.evaluate(() => document.fonts.ready)
  await page.getByRole('heading', { level: 1 }).waitFor()
  await page.getByRole('status').filter({ hasText: 'Showing' }).waitFor()
  await page.evaluate(() => Promise.all(document.getAnimations().map((animation) => animation.finished.catch(() => {}))))
}

async function hasPageOverflow(page) {
  return page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)
}

function viewButton(page, label) {
  return page.getByRole('group', { name: 'Insights view' }).getByRole('button', { name: label, exact: true })
}

test('Insights renders without page overflow across all established viewports and both themes', async ({ page }) => {
  test.setTimeout(180_000)
  for (const viewport of VIEWPORTS) {
    for (const theme of ['light', 'dark']) {
      await openInsights(page, viewport, { theme })
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Insights for August 2026.')
      expect(await hasPageOverflow(page), `${viewport.name}/${theme}`).toBe(false)
    }
  }
})

test('Breakdown, History and Compare stay contained at 320px and 390px', async ({ page }) => {
  for (const width of [320, 390]) {
    for (const query of ['', '?view=trends', '?view=compare']) {
      await openInsights(page, { width, height: 900 }, { query })
      expect(await hasPageOverflow(page), `${width}/${query || 'breakdown'}`).toBe(false)
      await expect(page.getByText(/SHR-169/).first()).toBeVisible()
      await expect(page.getByText(/SHR-195 \/ SHR-156/).first()).toBeVisible()
    }
  }
})

test('200% text zoom keeps essential truth and gap information visible without page overflow', async ({ page }) => {
  for (const query of ['', '?view=trends', '?view=compare']) {
    await openInsights(page, { width: 390, height: 1000 }, { query })
    await page.addStyleTag({ content: 'html { font-size: 200% }' })
    expect(await hasPageOverflow(page), query || 'breakdown').toBe(false)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    await expect(page.getByText(/SHR-169/).first()).toBeVisible()
  }
})

test('the two-column prototype composition stacks in reading order on mobile', async ({ page }) => {
  await openInsights(page, VIEWPORTS[1])
  const grid = page.locator('.v6-g2')
  expect(await grid.evaluate((node) => getComputedStyle(node).gridTemplateColumns.split(' ').length)).toBe(1)
  const category = page.getByRole('heading', { name: /Category spending/ })
  const descriptions = page.getByRole('heading', { name: /Descriptions and payees/ })
  const positions = await Promise.all([category, descriptions].map(async (locator) => (await locator.boundingBox()).y))
  expect(positions[0]).toBeLessThan(positions[1])
})

test('dense monthly facts scroll only inside their labelled region', async ({ page }) => {
  await openInsights(page, VIEWPORTS[0], { query: '?view=trends' })
  expect(await hasPageOverflow(page)).toBe(false)
  const region = page.getByRole('region', { name: 'Published monthly facts table' })
  await expect(region).toBeVisible()
  expect(await region.evaluate((node) => getComputedStyle(node).overflowX)).toBe('auto')
  await expect(page.getByRole('table')).toBeVisible()
})

test('all Insights controls meet the 44px touch target requirement', async ({ page }) => {
  await openInsights(page, VIEWPORTS[1])
  const main = page.locator('#main-content')
  const targets = main.getByRole('button').or(main.getByRole('link'))
  const count = await targets.count()
  expect(count).toBeGreaterThan(0)
  for (let index = 0; index < count; index += 1) {
    const box = await targets.nth(index).boundingBox()
    if (!box) continue
    expect(box.height, `target ${index} is ${box.height}px`).toBeGreaterThanOrEqual(44)
  }
})

test('period and view controls operate from the keyboard and update the screen', async ({ page }) => {
  await openInsights(page, VIEWPORTS[4])
  await viewButton(page, 'History').focus()
  await page.keyboard.press('Enter')
  await expect(viewButton(page, 'History')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('heading', { name: 'Published monthly facts' })).toBeVisible()

  await page.getByRole('group', { name: 'Insights period type' }).getByRole('button', { name: 'Quarter' }).focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Insights for Q3 2026.')

  await page.getByRole('button', { name: 'Previous quarter' }).focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Insights for Q2 2026.')
})

test('deep-linked period and view state survives reload', async ({ page }) => {
  await openInsights(page, VIEWPORTS[4], { query: '?period=quarter&year=2026&month=8&quarter=2&view=compare' })
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Insights for Q2 2026.')
  await expect(viewButton(page, 'Compare')).toHaveAttribute('aria-pressed', 'true')
  await page.reload()
  await page.getByRole('heading', { level: 1 }).waitFor()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Insights for Q2 2026.')
  await expect(viewButton(page, 'Compare')).toHaveAttribute('aria-pressed', 'true')
})

test('no write surface or unsupported analytical number is exposed', async ({ page }) => {
  for (const query of ['', '?view=trends', '?view=compare']) {
    await openInsights(page, VIEWPORTS[4], { query })
    const main = page.locator('#main-content')
    await expect(main.locator('form, input, textarea, select')).toHaveCount(0)
    await expect(main.getByRole('button', { name: /Add|Edit|Save|Delete|Create|Apply/ })).toHaveCount(0)
    const claimed = await page.evaluate(() => {
      const clone = document.querySelector('#main-content').cloneNode(true)
      for (const region of clone.querySelectorAll('.v6-unavailable')) region.remove()
      return clone.textContent
    })
    expect(claimed).not.toMatch(/[+−-]\d+(?:\.\d+)?%/)
    expect(claimed).not.toMatch(/rolling average|moving average|increased this month|trending upward|unusually high|could save AED/i)
  }
})

test('incomplete, empty and failed states stay honest and contained', async ({ page }) => {
  for (const fixture of ['incomplete', 'empty', 'failed']) {
    await page.setViewportSize({ width: 390, height: 900 })
    await page.goto(`/v6-insights-preview.html?fixture=${fixture}`)
    await page.getByRole('heading', { level: 1 }).waitFor()
    await expect(page.getByText(/Reading canonical contracts/)).toHaveCount(0)
    expect(await hasPageOverflow(page), fixture).toBe(false)
    if (fixture === 'incomplete') await expect(page.getByText('Travel')).toBeVisible()
    if (fixture === 'empty') await expect(page.getByText(/No category spending was reported/)).toBeVisible()
    if (fixture === 'failed') await expect(page.getByText(/No legacy or estimated value is substituted/).first()).toBeVisible()
  }
})

test('reduced motion renders final Insights geometry immediately', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await openInsights(page, VIEWPORTS[4], { query: '?view=trends' })
  const animated = await page.evaluate(() => Array.from(document.querySelectorAll('.v6-enter, .v6-chart-bar, .v6-bar-fill'))
    .map((node) => ({ opacity: getComputedStyle(node).opacity, animations: node.getAnimations().length })))
  expect(animated.length).toBeGreaterThan(0)
  for (const node of animated) {
    expect(node.animations).toBe(0)
    expect(Number(node.opacity)).toBe(1)
  }
})

test('Insights passes axe across views, themes, desktop and phone', async ({ page }) => {
  test.setTimeout(240_000)
  for (const viewport of [VIEWPORTS[1], VIEWPORTS[4]]) {
    for (const theme of ['light', 'dark']) {
      for (const query of ['', '?view=trends', '?view=compare', '?fixture=incomplete']) {
        if (query.startsWith('?fixture=')) {
          await page.setViewportSize({ width: viewport.width, height: viewport.height })
          await page.goto(`/v6-insights-preview.html${query}`)
          await page.evaluate((value) => localStorage.setItem('ourmoney.theme', value), theme)
          await page.reload()
          await page.getByRole('heading', { level: 1 }).waitFor()
          await page.getByText('Travel').waitFor()
        } else {
          await openInsights(page, viewport, { theme, query })
        }
        await page.evaluate(() => Promise.all(
          document.getAnimations().map((animation) => animation.finished.catch(() => undefined)),
        ))
        const results = await new AxeBuilder({ page }).analyze()
        expect(results.violations, `${viewport.name}/${theme}/${query || 'breakdown'}`).toEqual([])
      }
    }
  }
})
