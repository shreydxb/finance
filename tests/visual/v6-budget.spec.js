import { expect, test } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

/**
 * Desktop and mobile are both first-class for Budget, so both are asserted
 * rather than one being checked and the other assumed to follow.
 *
 * As in the Overview and Activity specs, pixel baselines are deliberately not
 * committed: this container's Chromium build differs from the pinned
 * Playwright version. Everything below is browser-build independent —
 * computed geometry, overflow, target size, keyboard operation and axe.
 */
const VIEWPORTS = [
  { name: 'phone', width: 390, height: 844 },
  { name: 'breakpoint', width: 900, height: 1000 },
  { name: 'desktop', width: 1440, height: 1200 },
]

async function openBudget(page, viewport, { theme = 'light', query = '' } = {}) {
  await page.setViewportSize({ width: viewport.width, height: viewport.height })
  await page.goto(`/v6-budget-preview.html${query}`)
  await page.evaluate((value) => localStorage.setItem('ourmoney.theme', value), theme)
  await page.reload()
  await page.evaluate(() => document.fonts.ready)
  await page.getByRole('heading', { level: 1 }).waitFor()
  await page.evaluate(() => Promise.all(document.getAnimations().map((animation) => animation.finished.catch(() => {}))))
  await page.addStyleTag({ content: '* { caret-color: transparent !important; }' })
}

/**
 * The Month / Year switch, scoped and exact.
 *
 * `getByRole('button', { name: 'Year' })` matches by substring, so it would
 * also catch the period navigator's "Previous year" and "Next year".
 */
function viewSwitch(page, label) {
  return page.getByRole('group', { name: 'Budget view' }).getByRole('button', { name: label, exact: true })
}

async function hasHorizontalOverflow(page) {
  return page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)
}

test('Budget renders at every reference viewport in both themes', async ({ page }) => {
  for (const viewport of VIEWPORTS) {
    for (const theme of ['light', 'dark']) {
      await openBudget(page, viewport, { theme })
      await expect(page.getByRole('table')).toBeVisible()
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
      const painted = await page.evaluate(() => getComputedStyle(document.body).backgroundColor)
      expect(painted, `${viewport.name}/${theme} must paint its own ground`).not.toBe('rgba(0, 0, 0, 0)')
      expect(await hasHorizontalOverflow(page)).toBe(false)
    }
  }
})

test('neither the month table nor the year grid overflows the page, down to 320px and at 200% zoom', async ({ page }) => {
  for (const query of ['', '?view=year']) {
    for (const width of [1440, 900, 768, 390, 320]) {
      await openBudget(page, { width, height: 900 }, { query })
      expect(await hasHorizontalOverflow(page), `${query || 'month'} overflows at ${width}px`).toBe(false)
      // A dense table may scroll inside its own region; it may not push the page.
      const contained = await page.evaluate(() => Array.from(document.querySelectorAll('.v6-budget-scroll'))
        .every((node) => getComputedStyle(node).overflowX === 'auto'))
      expect(contained).toBe(true)
    }
  }

  for (const query of ['', '?view=year']) {
    await openBudget(page, VIEWPORTS[0], { query })
    await page.addStyleTag({ content: 'html { font-size: 200% }' })
    expect(await hasHorizontalOverflow(page), `${query || 'month'} overflows at 200% zoom`).toBe(false)
  }
})

test('the desktop month table keeps every plan column the prototype shows', async ({ page }) => {
  await openBudget(page, VIEWPORTS[2])
  expect(await page.getByRole('columnheader').allTextContents()).toEqual([
    'Category', 'Spent (AED)', 'Planned', 'Pace', 'Projected close',
  ])
  await expect(page.locator('.v6-col-pace').first()).toBeVisible()
})

test('the desktop year grid keeps twelve month columns plus total and average', async ({ page }) => {
  await openBudget(page, VIEWPORTS[2], { query: '?view=year' })
  const headers = await page.getByRole('columnheader').allTextContents()
  expect(headers).toHaveLength(15)
  expect(headers.slice(1, 13)).toEqual(['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'])
  expect(headers.slice(13)).toEqual(['Total', 'Avg'])
})

test('mobile keeps the plan hierarchy readable and never drops a canonical figure', async ({ page }) => {
  await openBudget(page, VIEWPORTS[0])
  await expect(page.locator('.shell-sidebar')).toBeHidden()
  // The Pace column folds away on a phone; the plan concept it carries is
  // still stated on the screen, so nothing is lost.
  await expect(page.locator('.v6-col-pace').first()).toBeHidden()
  await expect(page.getByRole('columnheader', { name: 'Spent (AED)' })).toBeVisible()
  await expect(page.getByRole('columnheader', { name: 'Planned' })).toBeVisible()
  await expect(page.getByText('6,120.50')).toBeVisible()
  await expect(page.getByText(/Progress against plan is not available yet/).first()).toBeVisible()

  // The plan positions stack rather than clipping.
  const stacked = await page.locator('.v6-budget-positions').evaluate((node) => (
    getComputedStyle(node).justifyContent === 'flex-start'
  ))
  expect(stacked).toBe(true)
})

test('every Budget control meets the 44px target requirement on touch widths', async ({ page }) => {
  for (const query of ['', '?view=year']) {
    await openBudget(page, VIEWPORTS[0], { query })
    const main = page.locator('#main-content')
    const targets = main.getByRole('button').or(main.getByRole('link'))
    const count = await targets.count()
    expect(count).toBeGreaterThan(0)
    for (let index = 0; index < count; index += 1) {
      const box = await targets.nth(index).boundingBox()
      if (!box) continue
      expect(box.height, `${query || 'month'} target ${index} is ${box.height}px tall`).toBeGreaterThanOrEqual(44)
    }
  }
})

test('the period and view controls are keyboard operable and drive the URL', async ({ page }) => {
  await openBudget(page, VIEWPORTS[2])
  await page.getByRole('button', { name: 'Previous month' }).focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Category spending in July 2026.')

  await viewSwitch(page, 'Year').focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Category spending across 2026.')
  await expect(viewSwitch(page, 'Year')).toHaveAttribute('aria-pressed', 'true')

  // Returning to Month reopens the month that was being reviewed, not today's.
  await viewSwitch(page, 'Month').focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Category spending in July 2026.')
})

test('a month/year deep link survives a reload', async ({ page }) => {
  await openBudget(page, VIEWPORTS[2], { query: '?view=year&year=2026&month=3' })
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Category spending across 2026.')
  await page.reload()
  await page.getByRole('heading', { level: 1 }).waitFor()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Category spending across 2026.')

  await openBudget(page, VIEWPORTS[2], { query: '?year=2026&month=3' })
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Category spending in March 2026.')
  await page.reload()
  await page.getByRole('heading', { level: 1 }).waitFor()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Category spending in March 2026.')
})

test('no plan figure is ever stated, and no write control is operable', async ({ page }) => {
  await openBudget(page, VIEWPORTS[2])
  await expect(page.getByRole('button', { name: /Set a budget/ })).toBeDisabled()
  await expect(page.locator('#main-content').getByRole('textbox')).toHaveCount(0)
  await expect(page.locator('#main-content').getByRole('progressbar')).toHaveCount(0)

  // With the honest unavailable regions removed, nothing left on the screen
  // claims a plan, a percentage used, a pace or a projected close.
  const claimed = await page.evaluate(() => {
    const clone = document.querySelector('#main-content').cloneNode(true)
    for (const region of clone.querySelectorAll('.v6-unavailable')) region.remove()
    return clone.textContent
  })
  expect(claimed).not.toMatch(/\d+%\s*(?:used|of budget|of plan)/i)
  expect(claimed).not.toMatch(/under pace|over pace|on track|over by/i)
  // And none of the prototype's non-contractual demo figures.
  for (const demo of ['55,000', '46,120', '14,500', '9,600', '51,700', '349,300']) {
    expect(claimed, `prototype demo value ${demo} must never reach the screen`).not.toContain(demo)
  }
})

test('a withheld canonical actual is stated, never rendered as zero', async ({ page }) => {
  await openBudget(page, VIEWPORTS[2], { query: '?fixture=incomplete' })
  const row = page.getByRole('row', { name: /Travel/ })
  // The withheld amount states itself; the row's quality flag is a separate
  // fact, so the amount cell is asserted specifically.
  await expect(row.locator('.v6-col-amount .v6-missing-figure')).toHaveText('Incomplete')
  await expect(row.getByText(/2 missing FX/)).toBeVisible()
  await expect(row.locator('.v6-col-amount')).not.toHaveText(/^0/)
  expect(await hasHorizontalOverflow(page)).toBe(false)
})

test('a failed canonical read renders an honest state without overflowing', async ({ page }) => {
  await openBudget(page, VIEWPORTS[0], { query: '?fixture=failed' })
  await expect(page.getByText(/could not be read/).first()).toBeVisible()
  await expect(page.getByText(/No legacy or estimated value is substituted/).first()).toBeVisible()
  expect(await hasHorizontalOverflow(page)).toBe(false)
  const results = await new AxeBuilder({ page }).analyze()
  expect(results.violations).toEqual([])
})

test('reduced motion renders the final Budget state immediately', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await openBudget(page, VIEWPORTS[2])
  const animated = await page.evaluate(() => Array.from(document.querySelectorAll('.v6-enter, .v6-bar-fill'))
    .map((node) => ({ opacity: getComputedStyle(node).opacity, animations: node.getAnimations().length })))
  expect(animated.length).toBeGreaterThan(0)
  for (const node of animated) {
    expect(node.animations).toBe(0)
    expect(Number(node.opacity)).toBe(1)
  }
})

test('Budget has no automated accessibility violations on desktop or phone', async ({ page }) => {
  // Sixteen page loads, each followed by a full axe pass.
  test.setTimeout(180_000)
  for (const viewport of [VIEWPORTS[2], VIEWPORTS[0]]) {
    for (const theme of ['light', 'dark']) {
      for (const query of ['', '?view=year', '?fixture=incomplete', '?fixture=unreconciled']) {
        await openBudget(page, viewport, { theme, query })
        const results = await new AxeBuilder({ page }).analyze()
        expect(results.violations, `${viewport.name}/${theme}/${query || 'month'}`).toEqual([])
      }
    }
  }
})
