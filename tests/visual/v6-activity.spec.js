import { expect, test } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

/**
 * Desktop and mobile are both first-class for Activity, so both are asserted
 * rather than one being checked and the other assumed to follow.
 *
 * As in the Overview spec, pixel baselines are deliberately not committed:
 * this container's Chromium build differs from the pinned Playwright version,
 * and the repository's existing baselines already mismatch here. Everything
 * below is browser-build independent — computed geometry, overflow, target
 * size, keyboard operation, focus management and axe.
 */
const VIEWPORTS = [
  { name: 'phone', width: 390, height: 844 },
  { name: 'breakpoint', width: 900, height: 1000 },
  { name: 'desktop', width: 1440, height: 1200 },
]

const REVIEW_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-000000000001'

async function openActivity(page, viewport, { theme = 'light', query = '' } = {}) {
  await page.setViewportSize({ width: viewport.width, height: viewport.height })
  await page.goto(`/v6-activity-preview.html${query}`)
  await page.evaluate((value) => localStorage.setItem('ourmoney.theme', value), theme)
  await page.reload()
  await page.evaluate(() => document.fonts.ready)
  await page.getByRole('heading', { level: 1 }).waitFor()
  await page.evaluate(() => Promise.all(document.getAnimations().map((animation) => animation.finished.catch(() => {}))))
  await page.addStyleTag({ content: '* { caret-color: transparent !important; }' })
}

async function hasHorizontalOverflow(page) {
  return page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)
}

test('Activity renders at every reference viewport in both themes', async ({ page }) => {
  for (const viewport of VIEWPORTS) {
    for (const theme of ['light', 'dark']) {
      await openActivity(page, viewport, { theme })
      await expect(page.getByRole('table')).toBeVisible()
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
      const painted = await page.evaluate(() => getComputedStyle(document.body).backgroundColor)
      expect(painted, `${viewport.name}/${theme} must paint its own ground`).not.toBe('rgba(0, 0, 0, 0)')
      expect(await hasHorizontalOverflow(page)).toBe(false)
    }
  }
})

test('neither the list nor the calendar overflows the page, down to 320px and at 200% zoom', async ({ page }) => {
  for (const query of ['', '?view=calendar']) {
    for (const width of [1440, 900, 768, 390, 320]) {
      await openActivity(page, { width, height: 900 }, { query })
      expect(await hasHorizontalOverflow(page), `${query || 'list'} overflows at ${width}px`).toBe(false)
      // A dense table may scroll inside its own region; it may not push the page.
      const contained = await page.evaluate(() => Array.from(document.querySelectorAll('.v6-activity-scroll'))
        .every((node) => getComputedStyle(node).overflowX === 'auto'))
      expect(contained).toBe(true)
    }
  }

  await openActivity(page, VIEWPORTS[0])
  await page.addStyleTag({ content: 'html { font-size: 200% }' })
  expect(await hasHorizontalOverflow(page)).toBe(false)
})

test('the desktop table keeps every column and the calendar keeps seven', async ({ page }) => {
  await openActivity(page, VIEWPORTS[2])
  const headers = await page.getByRole('columnheader').allTextContents()
  expect(headers).toEqual([
    'Date', 'Description', 'Category', 'Recorded owner label', 'Account', 'Amount (AED)',
  ])
  await expect(page.locator('.v6-col-owner').first()).toBeVisible()

  await openActivity(page, VIEWPORTS[2], { query: '?view=calendar' })
  const columns = await page.locator('.v6-calendar-grid').evaluate((node) => getComputedStyle(node).gridTemplateColumns)
  expect(columns.split(' ')).toHaveLength(7)
})

test('mobile hides the wide columns while keeping their information reachable', async ({ page }) => {
  await openActivity(page, VIEWPORTS[0])
  await expect(page.locator('.shell-sidebar')).toBeHidden()
  await expect(page.locator('.v6-col-owner').first()).toBeHidden()
  await expect(page.locator('.v6-col-account').first()).toBeHidden()
  await expect(page.getByRole('columnheader', { name: 'Description' })).toBeVisible()

  // The hidden columns are not lost: the row's drawer still carries them.
  await page.getByRole('button', { name: 'Fixture grocery run' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await expect(dialog.getByText('Fixture Current Account')).toBeVisible()
  await expect(dialog.getByText('Household', { exact: true })).toBeVisible()

  await openActivity(page, VIEWPORTS[0], { query: '?view=calendar' })
  const cellHeight = await page.locator('.v6-calendar-cell').first().evaluate((node) => getComputedStyle(node).minHeight)
  expect(cellHeight).toBe('64px')
})

test('every Activity control meets the 44px target requirement on touch widths', async ({ page }) => {
  await openActivity(page, VIEWPORTS[0])
  const main = page.locator('#main-content')
  const targets = main.getByRole('button').or(main.getByRole('link')).or(main.getByRole('combobox'))
  const count = await targets.count()
  expect(count).toBeGreaterThan(0)
  for (let index = 0; index < count; index += 1) {
    const box = await targets.nth(index).boundingBox()
    if (!box) continue
    expect(box.height, `target ${index} is ${box.height}px tall`).toBeGreaterThanOrEqual(44)
  }
})

test('the drawer traps focus, closes on Escape and returns focus to its row', async ({ page }) => {
  await openActivity(page, VIEWPORTS[2])
  const trigger = page.getByRole('button', { name: 'Fixture grocery run' })
  await trigger.click()

  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  // Focus moves into the drawer, onto its title.
  await expect(dialog.getByText('Fixture grocery run')).toBeFocused()

  // Tab stays inside the drawer rather than reaching the page behind it.
  for (let step = 0; step < 12; step += 1) {
    await page.keyboard.press('Tab')
    const insideDialog = await page.evaluate(() => {
      const surface = document.querySelector('[role="dialog"]')
      return Boolean(surface && document.activeElement && surface.contains(document.activeElement))
    })
    expect(insideDialog, `focus escaped the drawer after ${step + 1} tabs`).toBe(true)
  }

  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(trigger).toBeFocused()
})

test('a deep-linked drawer opens full width on a phone and closes back to the list', async ({ page }) => {
  await openActivity(page, VIEWPORTS[0], { query: `?detail=${REVIEW_ID}` })
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()

  const width = await dialog.evaluate((node) => node.getBoundingClientRect().width)
  expect(Math.round(width)).toBe(390)
  expect(await hasHorizontalOverflow(page)).toBe(false)

  // The drawer stacks: its header sits above the scrolling body, not beside it.
  const stacked = await dialog.evaluate((node) => {
    const [header, body] = node.children
    return header.getBoundingClientRect().bottom <= body.getBoundingClientRect().top + 1
      && Math.round(body.getBoundingClientRect().width) === Math.round(node.getBoundingClientRect().width)
  })
  expect(stacked).toBe(true)

  await dialog.getByRole('button', { name: /Back to Activity/ }).click()
  await expect(dialog).toBeHidden()
  await expect(page.getByRole('table')).toBeVisible()
})

test('the recorded owner label is never presented as authoritative ownership', async ({ page }) => {
  await openActivity(page, VIEWPORTS[2])
  await expect(page.getByRole('columnheader', { name: 'Recorded owner label' })).toBeVisible()
  await expect(page.getByLabel('Recorded owner label')).toBeVisible()
  await expect(page.getByRole('option', { name: 'All recorded labels' })).toHaveCount(1)

  const text = await page.locator('#main-content').innerText()
  expect(text).not.toMatch(/\bAll owners\b/)
  expect(text).not.toMatch(/\bUnassigned\b/)
  expect(text).toMatch(/recorded text label, not household ownership/)
  expect(text).toMatch(/SHR-195/)
})

test('an entry outside the loaded month states the SHR-163 limit, not absence', async ({ page }) => {
  // July is loaded; the entry belongs to August.
  await openActivity(page, VIEWPORTS[2], { query: `?year=2026&month=7&detail=${REVIEW_ID}` })
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()

  const text = await dialog.innerText()
  expect(text).toMatch(/not in the period being reviewed/)
  expect(text).toMatch(/SHR-163/)
  expect(text).toMatch(/not missing/)
  expect(text).not.toMatch(/Record unavailable/)
  expect(text).not.toMatch(/does not exist|not found/i)

  // Back still returns to the list.
  await dialog.getByRole('button', { name: /Back to Activity/ }).click()
  await expect(dialog).toBeHidden()
})

test('no write control on the screen or in the drawer is operable', async ({ page }) => {
  await openActivity(page, VIEWPORTS[2])
  await expect(page.getByRole('button', { name: /Add transaction/ })).toBeDisabled()

  await page.getByRole('button', { name: 'Fixture grocery run' }).click()
  const dialog = page.getByRole('dialog')
  for (const label of ['Edit', 'Split by category', 'Mark reviewed', 'Delete']) {
    await expect(dialog.getByRole('button', { name: label })).toBeDisabled()
  }
})

test('reduced motion renders the final Activity state immediately', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await openActivity(page, VIEWPORTS[2])
  const animated = await page.evaluate(() => Array.from(document.querySelectorAll('.v6-enter'))
    .map((node) => ({ opacity: getComputedStyle(node).opacity, animations: node.getAnimations().length })))
  expect(animated.length).toBeGreaterThan(0)
  for (const node of animated) {
    expect(node.animations).toBe(0)
    expect(Number(node.opacity)).toBe(1)
  }
  const results = await new AxeBuilder({ page }).analyze()
  expect(results.violations).toEqual([])
})

test('Activity has no automated accessibility violations on desktop or phone', async ({ page }) => {
  for (const viewport of [VIEWPORTS[2], VIEWPORTS[0]]) {
    for (const theme of ['light', 'dark']) {
      for (const query of ['', '?view=calendar', `?detail=${REVIEW_ID}`, `?year=2026&month=7&detail=${REVIEW_ID}`]) {
        await openActivity(page, viewport, { theme, query })
        const results = await new AxeBuilder({ page }).analyze()
        expect(results.violations, `${viewport.name}/${theme}/${query || 'list'}`).toEqual([])
      }
    }
  }
})
