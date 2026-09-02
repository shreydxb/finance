import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'

const VIEWPORTS = [
  { name: 'phone-320', width: 320, height: 800 },
  { name: 'phone-390', width: 390, height: 900 },
  { name: 'tablet', width: 768, height: 1000 },
  { name: 'breakpoint', width: 900, height: 1000 },
  { name: 'desktop', width: 1440, height: 1200 },
]

async function openAccounts(page, viewport, { theme = 'light', query = '' } = {}) {
  await page.setViewportSize({ width: viewport.width, height: viewport.height })
  const join = query ? `${query}&fixture=default` : '?fixture=default'
  await page.goto(`/v6-accounts-preview.html${join}`)
  await page.evaluate((value) => localStorage.setItem('ourmoney.theme', value), theme)
  await page.reload()
  await page.evaluate(() => document.fonts.ready)
  await page.getByRole('heading', { level: 1, name: 'Accounts' }).waitFor()
  await page.getByRole('button', { name: 'Fixture Savings' }).waitFor()
  await page.evaluate(() => Promise.all(document.getAnimations().map((animation) => animation.finished.catch(() => undefined))))
}

async function hasPageOverflow(page) {
  return page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)
}

test('Accounts is contained at every established width in light and dark mode', async ({ page }) => {
  test.setTimeout(180_000)
  for (const viewport of VIEWPORTS) {
    for (const theme of ['light', 'dark']) {
      await openAccounts(page, viewport, { theme })
      expect(await hasPageOverflow(page), `${viewport.name}/${theme}`).toBe(false)
      await expect(page.getByText('434,273.13')).toBeVisible()
      await expect(page.getByText(/Account ownership is not available yet/)).toBeVisible()
    }
  }
})

test('320px and 390px keep the account tables usable inside a contained scroll', async ({ page }) => {
  for (const width of [320, 390]) {
    await openAccounts(page, { width, height: 900 })
    expect(await hasPageOverflow(page), `${width}px`).toBe(false)
    const region = page.getByRole('region', { name: 'Household accounts' })
    await expect(region).toBeVisible()
    expect(await region.evaluate((node) => getComputedStyle(node).overflowX)).toBe('auto')
    // Owner is the only column with no canonical value in it, so it is the one
    // that gives way; its missing-contract statement stays on the page.
    // A CSS locator, not a role query: a hidden column header is no longer in
    // the accessibility tree, which is exactly the state being asserted.
    const owner = page.locator('.v6-accounts-table th.v6-col-owner').first()
    expect(await owner.evaluate((node) => getComputedStyle(node).display)).toBe('none')
    await expect(page.getByText(/Account ownership is not available yet/)).toBeVisible()
  }
})

test('200% text zoom preserves valuation truth and named gaps without page overflow', async ({ page }) => {
  await openAccounts(page, VIEWPORTS[1])
  await page.addStyleTag({ content: 'html { font-size: 200% }' })
  expect(await hasPageOverflow(page)).toBe(false)
  await expect(page.getByRole('heading', { level: 1, name: 'Accounts' })).toBeVisible()
  await expect(page.getByText(/SHR-154 \/ SHR-156/).first()).toBeVisible()
  await expect(page.getByText(/SHR-156 \/ SHR-173/)).toBeVisible()
  await expect(page.getByText(/SHR-172 \/ SHR-173/).first()).toBeVisible()
})

test('grouping controls meet 44px, are keyboard operable and survive reload', async ({ page }) => {
  await openAccounts(page, VIEWPORTS[1])
  const group = page.getByRole('group', { name: 'Account grouping' })
  const controls = group.getByRole('button')
  for (let index = 0; index < await controls.count(); index += 1) {
    const box = await controls.nth(index).boundingBox()
    expect(box.height, `grouping target ${index}`).toBeGreaterThanOrEqual(44)
  }
  await expect(group.getByRole('button', { name: /By type/ })).toHaveAttribute('aria-pressed', 'true')
  const owner = group.getByRole('button', { name: /By owner/ })
  await expect(owner).toHaveAttribute('aria-disabled', 'true')
  await owner.focus()
  await page.keyboard.press('Enter')
  await expect(page).not.toHaveURL(/group=owner/)
  await expect(page.getByText(/Grouping by owner is not available yet/)).toBeVisible()
})

test('a row opens its read-only detail by keyboard and the deep link survives reload', async ({ page }) => {
  await openAccounts(page, VIEWPORTS[4])
  await page.getByRole('button', { name: 'Fixture Brokerage · Global' }).focus()
  await page.keyboard.press('Enter')
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await expect(dialog.getByText('USD 118,250.00')).toBeVisible()
  await expect(dialog.getByText('434,273.13')).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Update valuation' })).toBeDisabled()
  await expect(page).toHaveURL(/account=/)
  await page.reload()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
})

test('the screen is read-only and makes no freshness or ownership claim', async ({ page }) => {
  await openAccounts(page, VIEWPORTS[4])
  const main = page.locator('#main-content')
  await expect(main.locator('form, input, textarea, select')).toHaveCount(0)
  const claimed = await page.evaluate(() => {
    const clone = document.querySelector('#main-content').cloneNode(true)
    for (const region of clone.querySelectorAll('.v6-unavailable')) region.remove()
    return clone.textContent
  })
  expect(claimed).not.toMatch(/all valued today|up to date|\bstale\b|\bfresh\b|needs attention|live price|market price/i)
  expect(claimed).not.toMatch(/fixture-label|50\/50|half of shared|\bShared\b|\bJoint\b/)
  expect(claimed).not.toMatch(/cost basis|unrealis|unrealiz|allocation|day change|CAGR/i)
  expect(claimed).not.toMatch(/2,847,300|2,450,000|212,400|84,300|460,060/)
})

test('empty, incomplete and failed states remain honest and contained', async ({ page }) => {
  for (const fixture of ['empty', 'incomplete', 'failed']) {
    await page.setViewportSize({ width: 390, height: 900 })
    await page.goto(`/v6-accounts-preview.html?fixture=${fixture}`)
    await page.getByRole('heading', { level: 1, name: 'Accounts' }).waitFor()
    await expect(page.getByText(/Reading canonical account contracts/)).toHaveCount(0)
    expect(await hasPageOverflow(page), fixture).toBe(false)
    if (fixture === 'empty') await expect(page.getByText(/No accounts to show/)).toBeVisible()
    if (fixture === 'incomplete') {
      await expect(page.getByText(/No published FX rate for CHF/)).toBeVisible()
      await expect(page.getByText('39,415.00')).toBeVisible()
    }
    if (fixture === 'failed') await expect(page.getByText(/Account positions are not available/)).toBeVisible()
  }
})

test('reduced motion renders the final Accounts composition immediately', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await openAccounts(page, VIEWPORTS[4])
  const animated = await page.evaluate(() => Array.from(document.querySelectorAll('.v6-enter'))
    .map((node) => ({ opacity: getComputedStyle(node).opacity, animations: node.getAnimations().length })))
  expect(animated.length).toBeGreaterThan(0)
  for (const node of animated) {
    expect(node.animations).toBe(0)
    expect(Number(node.opacity)).toBe(1)
  }
})

test('Accounts passes axe for themes, phone, desktop, detail and incomplete state', async ({ page }) => {
  test.setTimeout(180_000)
  for (const viewport of [VIEWPORTS[1], VIEWPORTS[4]]) {
    for (const theme of ['light', 'dark']) {
      await openAccounts(page, viewport, { theme })
      const results = await new AxeBuilder({ page }).analyze()
      expect(results.violations, `${viewport.name}/${theme}`).toEqual([])
    }
  }

  await openAccounts(page, VIEWPORTS[4])
  await page.getByRole('button', { name: 'Fixture Savings' }).click()
  await page.getByRole('dialog').waitFor()
  const detail = await new AxeBuilder({ page }).analyze()
  expect(detail.violations, 'detail').toEqual([])

  await page.setViewportSize({ width: 390, height: 900 })
  await page.goto('/v6-accounts-preview.html?fixture=incomplete')
  await page.getByText(/No published FX rate for CHF/).waitFor()
  await page.evaluate(() => Promise.all(document.getAnimations().map((animation) => animation.finished.catch(() => undefined))))
  const incomplete = await new AxeBuilder({ page }).analyze()
  expect(incomplete.violations, 'incomplete').toEqual([])
})
