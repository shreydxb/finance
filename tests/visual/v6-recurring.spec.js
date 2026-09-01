import { expect, test } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

/**
 * Desktop and mobile are both first-class for Recurring, so both are asserted
 * rather than one being checked and the other assumed to follow.
 *
 * As in the Overview, Activity and Budget specs, pixel baselines are
 * deliberately not committed: this container's Chromium build differs from the
 * pinned Playwright version. Everything below is browser-build independent —
 * computed geometry, overflow, target size, keyboard operation and axe.
 */
const VIEWPORTS = [
  { name: 'phone', width: 390, height: 844 },
  { name: 'breakpoint', width: 900, height: 1000 },
  { name: 'desktop', width: 1440, height: 1200 },
]

async function openRecurring(page, viewport, { theme = 'light', query = '' } = {}) {
  await page.setViewportSize({ width: viewport.width, height: viewport.height })
  await page.goto(`/v6-recurring-preview.html${query}`)
  await page.evaluate((value) => localStorage.setItem('ourmoney.theme', value), theme)
  await page.reload()
  await page.evaluate(() => document.fonts.ready)
  await page.getByRole('heading', { level: 1 }).waitFor()
  await page.evaluate(() => Promise.all(document.getAnimations().map((animation) => animation.finished.catch(() => {}))))
  await page.addStyleTag({ content: '* { caret-color: transparent !important; }' })
}

/**
 * The switches, scoped and exact.
 *
 * `getByRole('button', { name: 'List' })` would match by substring; scoping to
 * the switch's own group keeps each assertion on the control it names.
 *
 * The type buttons read "Bills" / "Income" but carry the fuller accessible
 * names "Bills and EMIs" / "Expected income", so the helper takes the
 * accessible name — which is what a screen-reader user actually hears.
 */
const TYPE_NAME = { Bills: 'Bills and EMIs', Income: 'Expected income' }

function typeSwitch(page, label) {
  return page.getByRole('group', { name: 'Recurring type' })
    .getByRole('button', { name: TYPE_NAME[label] ?? label, exact: true })
}

function viewSwitch(page, label) {
  return page.getByRole('group', { name: 'Recurring view' }).getByRole('button', { name: label, exact: true })
}

async function hasHorizontalOverflow(page) {
  return page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)
}

test('Recurring renders at every reference viewport in both themes', async ({ page }) => {
  for (const viewport of VIEWPORTS) {
    for (const theme of ['light', 'dark']) {
      await openRecurring(page, viewport, { theme })
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
      await expect(page.getByText('Consumption spend posted this period')).toBeVisible()
      const painted = await page.evaluate(() => getComputedStyle(document.body).backgroundColor)
      expect(painted, `${viewport.name}/${theme} must paint its own ground`).not.toBe('rgba(0, 0, 0, 0)')
      expect(await hasHorizontalOverflow(page)).toBe(false)
    }
  }
})

/* ── 12: no horizontal overflow at 320px / 390px; 13: 200% zoom ─────────── */

test('neither mode nor either view overflows the page, down to 320px and at 200% zoom', async ({ page }) => {
  for (const query of ['', '?type=income', '?view=calendar', '?type=income&view=calendar']) {
    for (const width of [1440, 900, 768, 390, 320]) {
      await openRecurring(page, { width, height: 900 }, { query })
      expect(await hasHorizontalOverflow(page), `${query || 'bills/list'} overflows at ${width}px`).toBe(false)
    }
  }

  for (const query of ['', '?type=income', '?view=calendar']) {
    await openRecurring(page, VIEWPORTS[0], { query })
    await page.addStyleTag({ content: 'html { font-size: 200% }' })
    expect(await hasHorizontalOverflow(page), `${query || 'bills/list'} overflows at 200% zoom`).toBe(false)
    // The stated gaps are what this screen has to say, so they must still be
    // readable at 200% rather than clipped or scrolled away sideways. Every
    // view has at least one, so the assertion holds across the loop.
    await expect(page.getByText(/is not available/).first()).toBeVisible()
  }
})

test('mobile keeps the Recurring hierarchy readable and stacks rather than clipping', async ({ page }) => {
  await openRecurring(page, VIEWPORTS[0])
  await expect(page.locator('.shell-sidebar')).toBeHidden()
  await expect(typeSwitch(page, 'Bills')).toBeVisible()
  await expect(viewSwitch(page, 'List')).toBeVisible()
  await expect(page.getByText('Consumption spend posted this period')).toBeVisible()

  const stacked = await page.locator('.v6-recurring-position-list').evaluate((node) => (
    getComputedStyle(node).gridTemplateColumns.split(' ').length === 1
  ))
  expect(stacked).toBe(true)
  const split = await page.locator('.v6-recurring-split').evaluate((node) => (
    getComputedStyle(node).gridTemplateColumns.split(' ').length === 1
  ))
  expect(split).toBe(true)
})

test('the calendar grid stays seven columns wide and never pushes the page sideways', async ({ page }) => {
  for (const width of [1440, 900, 390, 320]) {
    await openRecurring(page, { width, height: 900 }, { query: '?view=calendar' })
    const columns = await page.locator('.v6-calendar-grid').evaluate((node) => (
      getComputedStyle(node).gridTemplateColumns.split(' ').length
    ))
    expect(columns, `calendar at ${width}px`).toBe(7)
    expect(await hasHorizontalOverflow(page)).toBe(false)
  }
})

/* ── 14: keyboard operation and 44px targets ───────────────────────────── */

test('every Recurring control meets the 44px target requirement on touch widths', async ({ page }) => {
  for (const query of ['', '?type=income', '?view=calendar']) {
    await openRecurring(page, VIEWPORTS[0], { query })
    const main = page.locator('#main-content')
    const targets = main.getByRole('button').or(main.getByRole('link'))
    const count = await targets.count()
    expect(count).toBeGreaterThan(0)
    for (let index = 0; index < count; index += 1) {
      const box = await targets.nth(index).boundingBox()
      if (!box) continue
      expect(box.height, `${query || 'bills/list'} target ${index} is ${box.height}px tall`).toBeGreaterThanOrEqual(44)
    }
  }
})

test('the type, view and period controls are keyboard operable and drive the URL', async ({ page }) => {
  await openRecurring(page, VIEWPORTS[2])

  await typeSwitch(page, 'Income').focus()
  await page.keyboard.press('Enter')
  await expect(typeSwitch(page, 'Income')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByText(/Expected income is not available yet/).first()).toBeVisible()

  await viewSwitch(page, 'Calendar').focus()
  await page.keyboard.press('Enter')
  await expect(viewSwitch(page, 'Calendar')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('.v6-calendar-grid')).toBeVisible()
  // The type selection survives the view switch.
  await expect(typeSwitch(page, 'Income')).toHaveAttribute('aria-pressed', 'true')

  await page.getByRole('button', { name: 'Previous month' }).focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('heading', { level: 1 }))
    .toHaveText('Bills, EMIs and expected income for July 2026.')
})

/* ── 3, 4 & 5: route state survives a reload ────────────────────────────── */

test('a type, view and month deep link survives a reload', async ({ page }) => {
  await openRecurring(page, VIEWPORTS[2], { query: '?type=income&view=calendar&year=2026&month=3' })
  await expect(page.getByRole('heading', { level: 1 }))
    .toHaveText('Bills, EMIs and expected income for March 2026.')
  await expect(typeSwitch(page, 'Income')).toHaveAttribute('aria-pressed', 'true')
  await expect(viewSwitch(page, 'Calendar')).toHaveAttribute('aria-pressed', 'true')

  await page.reload()
  await page.getByRole('heading', { level: 1 }).waitFor()
  await expect(page.getByRole('heading', { level: 1 }))
    .toHaveText('Bills, EMIs and expected income for March 2026.')
  await expect(typeSwitch(page, 'Income')).toHaveAttribute('aria-pressed', 'true')
  await expect(viewSwitch(page, 'Calendar')).toHaveAttribute('aria-pressed', 'true')

  // And a bills/list deep link reopens as bills and list, not as whatever was
  // last selected.
  await openRecurring(page, VIEWPORTS[2], { query: '?year=2026&month=7' })
  await expect(typeSwitch(page, 'Bills')).toHaveAttribute('aria-pressed', 'true')
  await expect(viewSwitch(page, 'List')).toHaveAttribute('aria-pressed', 'true')
  await page.reload()
  await page.getByRole('heading', { level: 1 }).waitFor()
  await expect(page.getByRole('heading', { level: 1 }))
    .toHaveText('Bills, EMIs and expected income for July 2026.')
})

/* ── 6, 7, 8, 9 & 10: the truth boundary, in a real browser ─────────────── */

test('no plan, cadence, due date, paid status or match is ever stated', async ({ page }) => {
  for (const query of ['', '?type=income', '?view=calendar']) {
    await openRecurring(page, VIEWPORTS[2], { query })

    // With the honest unavailable regions and their hints removed, nothing
    // left on the screen claims a plan, a schedule, a status or a person.
    const claimed = await page.evaluate(() => {
      const clone = document.querySelector('#main-content').cloneNode(true)
      for (const region of clone.querySelectorAll('.v6-unavailable, .v6-kpi-hint')) region.remove()
      return clone.textContent
    })
    expect(claimed).not.toMatch(/\b(?:overdue|unpaid|past due|paid on|missed (?:bill|payment))\b/i)
    expect(claimed).not.toMatch(/\brepeats (?:monthly|weekly|quarterly|annually)\b/i)
    expect(claimed).not.toMatch(/\d+%\s*(?:of spend|committed|fixed|variable)/i)
    expect(claimed).not.toMatch(/\b(?:Shrey|Tarika|Joint|Partner)\b/)
    for (const demo of ['29,400', '78,400', '20,860', '25,260', '6,850', '8,940', '9,600']) {
      expect(claimed, `prototype demo value ${demo} must never reach the screen`).not.toContain(demo)
    }
    expect(claimed).not.toMatch(/Mortgage|NBD credit card|DEWA|Etisalat|School fee/)
  }
})

test('every write affordance is present and inert', async ({ page }) => {
  await openRecurring(page, VIEWPORTS[2])
  for (const name of ['Add a bill', 'Edit a commitment', 'Archive a commitment', 'Mark paid', 'Match a posted entry']) {
    await expect(page.getByRole('button', { name, exact: true })).toBeDisabled()
  }
  await expect(page.locator('#main-content').getByRole('textbox')).toHaveCount(0)
  await expect(page.locator('#main-content').getByRole('progressbar')).toHaveCount(0)
  await expect(page.locator('#main-content').locator('form')).toHaveCount(0)
})

test('the calendar places nothing on any day and invents no amount', async ({ page }) => {
  await openRecurring(page, VIEWPORTS[2], { query: '?view=calendar' })
  await expect(page.locator('.v6-calendar-cell[data-outside="false"]')).toHaveCount(31)
  const gridText = await page.locator('.v6-calendar-grid').innerText()
  expect(gridText).not.toMatch(/AED|\d{1,3},\d{3}|\d+\.\d{2}/)
  await expect(page.getByText(/Expected recurring events are not available on the calendar/)).toBeVisible()
})

test('a withheld canonical spend states itself, and a failed read stays honest', async ({ page }) => {
  await openRecurring(page, VIEWPORTS[2], { query: '?fixture=incomplete' })
  await expect(page.locator('.v6-recurring-split-figure .v6-missing-figure').first()).toHaveText('Incomplete')
  await expect(page.getByText(/without a canonical FX rate/)).toBeVisible()
  expect(await hasHorizontalOverflow(page)).toBe(false)

  await openRecurring(page, VIEWPORTS[0], { query: '?fixture=failed' })
  await expect(page.getByText(/could not be read/).first()).toBeVisible()
  await expect(page.getByText(/No legacy or estimated value is substituted/).first()).toBeVisible()
  expect(await hasHorizontalOverflow(page)).toBe(false)
  const results = await new AxeBuilder({ page }).analyze()
  expect(results.violations).toEqual([])
})

test('reduced motion renders the final Recurring state immediately', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await openRecurring(page, VIEWPORTS[2])
  const animated = await page.evaluate(() => Array.from(document.querySelectorAll('.v6-enter'))
    .map((node) => ({ opacity: getComputedStyle(node).opacity, animations: node.getAnimations().length })))
  expect(animated.length).toBeGreaterThan(0)
  for (const node of animated) {
    expect(node.animations).toBe(0)
    expect(Number(node.opacity)).toBe(1)
  }
})

/* ── 15: axe across the relevant modes and themes ──────────────────────── */

test('Recurring has no automated accessibility violations on desktop or phone', async ({ page }) => {
  // Twenty page loads, each followed by a full axe pass.
  test.setTimeout(240_000)
  for (const viewport of [VIEWPORTS[2], VIEWPORTS[0]]) {
    for (const theme of ['light', 'dark']) {
      for (const query of ['', '?type=income', '?view=calendar', '?type=income&view=calendar', '?fixture=provisional']) {
        await openRecurring(page, viewport, { theme, query })
        const results = await new AxeBuilder({ page }).analyze()
        expect(results.violations, `${viewport.name}/${theme}/${query || 'bills/list'}`).toEqual([])
      }
    }
  }
})
