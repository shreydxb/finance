import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'

const VIEWPORTS = [
  { name: 'phone-320', width: 320, height: 800 },
  { name: 'phone-390', width: 390, height: 900 },
  { name: 'tablet', width: 768, height: 1000 },
  { name: 'breakpoint', width: 900, height: 1000 },
  { name: 'desktop', width: 1440, height: 1200 },
]

async function openInvestments(page, viewport, { theme = 'light', query = '' } = {}) {
  await page.setViewportSize({ width: viewport.width, height: viewport.height })
  const join = query ? `${query}&fixture=default` : '?fixture=default'
  await page.goto(`/v6-investments-preview.html${join}`)
  await page.evaluate((value) => localStorage.setItem('ourmoney.theme', value), theme)
  await page.reload()
  await page.evaluate(() => document.fonts.ready)
  await page.getByRole('heading', { level: 1, name: 'Investments' }).waitFor()
  await page.getByRole('button', { name: 'Fixture Index Tracker' }).waitFor()
  await page.evaluate(() => Promise.all(document.getAnimations().map((animation) => animation.finished.catch(() => undefined))))
}

async function hasPageOverflow(page) {
  return page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)
}

test('Investments is contained at every established width in light and dark mode', async ({ page }) => {
  test.setTimeout(180_000)
  for (const viewport of VIEWPORTS) {
    for (const theme of ['light', 'dark']) {
      await openInvestments(page, viewport, { theme })
      expect(await hasPageOverflow(page), `${viewport.name}/${theme}`).toBe(false)
      await expect(page.getByText('179,147.99')).toBeVisible()
      await expect(page.getByText('AED 741,821')).toBeVisible()
      await expect(page.getByText(/Portfolio performance history is not available yet/).first()).toBeVisible()
    }
  }
})

test('320px and 390px keep the holdings table usable inside a contained scroll', async ({ page }) => {
  for (const width of [320, 390]) {
    await openInvestments(page, { width, height: 900 })
    expect(await hasPageOverflow(page), `${width}px`).toBe(false)
    const region = page.getByRole('region', { name: 'Household investment holdings' })
    await expect(region).toBeVisible()
    expect(await region.evaluate((node) => getComputedStyle(node).overflowX)).toBe('auto')
    // The published AED value is the column that must survive the narrowest
    // width: it is the only figure on the row the contract actually stands
    // behind.
    await expect(page.getByText('215,854.86')).toBeVisible()
    await expect(page.getByText(/Holding ownership is not available yet/).first()).toBeVisible()
  }
})

test('the performance and allocation positions stay legible where the prototype drew a chart', async ({ page }) => {
  for (const viewport of [VIEWPORTS[0], VIEWPORTS[1], VIEWPORTS[4]]) {
    await openInvestments(page, viewport)
    const frame = page.locator('.v6-investments-performance-frame')
    await expect(frame).toBeVisible()
    await expect(frame).toHaveAttribute('role', 'img')
    expect(await frame.getAttribute('aria-label')).toMatch(/not available/i)
    // No curve is drawn anywhere on the page: an honest empty frame, not a
    // fabricated track record.
    expect(await page.locator('#main-content svg, #main-content polyline, #main-content canvas').count()).toBe(0)
    await expect(page.getByText(/Portfolio allocation is not available yet/).first()).toBeVisible()
  }
})

test('200% text zoom preserves portfolio truth and named gaps without page overflow', async ({ page }) => {
  await openInvestments(page, VIEWPORTS[1])
  await page.addStyleTag({ content: 'html { font-size: 200% }' })
  expect(await hasPageOverflow(page)).toBe(false)
  await expect(page.getByRole('heading', { level: 1, name: 'Investments' })).toBeVisible()
  await expect(page.getByText('AED 741,821')).toBeVisible()
  await expect(page.getByText(/SHR-174/).first()).toBeVisible()
  await expect(page.getByText(/SHR-176/).first()).toBeVisible()
  await expect(page.getByText(/SHR-156 \/ SHR-173/).first()).toBeVisible()
})

test('every disabled prototype control meets 44px and stays inert under keyboard', async ({ page }) => {
  await openInvestments(page, VIEWPORTS[1])
  for (const name of ['Asset class filter', 'Performance range']) {
    const group = page.getByRole('group', { name })
    const controls = group.getByRole('button')
    for (let index = 0; index < await controls.count(); index += 1) {
      const control = controls.nth(index)
      const box = await control.boundingBox()
      expect(box.height, `${name} target ${index}`).toBeGreaterThanOrEqual(44)
      await expect(control).toHaveAttribute('aria-disabled', 'true')
    }
  }
  const refresh = page.getByRole('button', { name: 'Refresh prices' })
  await expect(refresh).toBeDisabled()
  expect((await refresh.boundingBox()).height).toBeGreaterThanOrEqual(44)
  await page.keyboard.press('Enter')
  await expect(page.getByText(/Portfolio maintenance is not available here/).first()).toBeVisible()
})

test('a holding opens its read-only detail by keyboard and the deep link survives reload', async ({ page }) => {
  await openInvestments(page, VIEWPORTS[4])
  await page.getByRole('button', { name: 'Fixture Global Equity Fund' }).focus()
  await page.keyboard.press('Enter')
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await expect(dialog.getByText('USD 48,780.80')).toBeVisible()
  await expect(dialog.getByText('179,147.99')).toBeVisible()
  await expect(dialog.getByText('143,741.65')).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Update price' })).toBeDisabled()
  await expect(page).toHaveURL(/investment=/)
  await page.reload()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
})

test('the screen is read-only and makes no performance, allocation or ownership claim', async ({ page }) => {
  await openInvestments(page, VIEWPORTS[4])
  const main = page.locator('#main-content')
  await expect(main.locator('form, input, textarea, select')).toHaveCount(0)
  const claimed = await page.evaluate(() => {
    const clone = document.querySelector('#main-content').cloneNode(true)
    for (const region of clone.querySelectorAll('.v6-unavailable')) region.remove()
    return clone.textContent
  })
  // No percentage of any kind is claimed: no weight, no return, no day change.
  expect(claimed).not.toMatch(/\d+(?:\.\d+)?\s?%/)
  expect(claimed).not.toMatch(/\blive\b|\bstale\b|\bfresh\b|just now|up to date|\d+ days? ago/i)
  expect(claimed).not.toMatch(/fixture-owner-label|50\/50|half of shared|\bShared\b|\bJoint\b|\bPrimary\b|\bPartner\b/)
  expect(claimed).not.toMatch(/overweight|underweight|rebalanc|diversif|too concentrated|high risk/i)
  // Prototype demo values must never reach runtime.
  // Anchored to the exact strings the prototype prints. A bare "18.4" would
  // also match a legitimate published price of USD 118.40, which is a real
  // canonical figure and must be allowed through.
  expect(claimed).not.toMatch(/611,200|\+1,840\b|\+0\.38%|\+18\.4%|72,400|166,300|3,409,091/)
  expect(claimed).not.toMatch(/Interactive Brokers|Zerodha|VWRA|CSPX/)
})

test('gains and losses are never signalled by colour alone', async ({ page }) => {
  await openInvestments(page, VIEWPORTS[4])
  const row = page.locator('tr', { has: page.getByRole('button', { name: 'Fixture Global Equity Fund' }) })
  const profit = row.locator('.v6-col-profit')
  await expect(profit).toContainText('+35,406.34')
  await expect(profit).toContainText('gain')
})

test('empty, incomplete, pnl-withheld and failed states remain honest and contained', async ({ page }) => {
  for (const fixture of ['empty', 'incomplete', 'pnl-withheld', 'failed']) {
    await page.setViewportSize({ width: 390, height: 900 })
    await page.goto(`/v6-investments-preview.html?fixture=${fixture}`)
    await page.getByRole('heading', { level: 1, name: 'Investments' }).waitFor()
    await expect(page.getByText(/Reading canonical investment contracts/)).toHaveCount(0)
    expect(await hasPageOverflow(page), fixture).toBe(false)
    if (fixture === 'empty') await expect(page.getByText(/No holdings to show/)).toBeVisible()
    if (fixture === 'incomplete') {
      await expect(page.getByText(/No published FX rate for CHF/).first()).toBeVisible()
      await expect(page.getByText('39,416.50')).toBeVisible()
      // The withheld portfolio total is never backfilled by summing the rows.
      await expect(page.getByText('AED 741,821')).toHaveCount(0)
    }
    if (fixture === 'pnl-withheld') {
      await expect(page.getByText('AED 741,821')).toBeVisible()
      await expect(page.getByText('AED 612,430')).toBeVisible()
      // 741,820.55 − 612,430.18 is available to any component willing to
      // subtract. Nothing does.
      await expect(page.getByText(/129,390/)).toHaveCount(0)
    }
    if (fixture === 'failed') await expect(page.getByText(/Investment positions are not available/)).toBeVisible()
  }
})

test('reduced motion renders the final Investments composition immediately', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await openInvestments(page, VIEWPORTS[4])
  const animated = await page.evaluate(() => Array.from(document.querySelectorAll('.v6-enter'))
    .map((node) => ({ opacity: getComputedStyle(node).opacity, animations: node.getAnimations().length })))
  expect(animated.length).toBeGreaterThan(0)
  for (const node of animated) {
    expect(node.animations).toBe(0)
    expect(Number(node.opacity)).toBe(1)
  }
})

test('Investments passes axe for themes, phone, desktop, detail and incomplete state', async ({ page }) => {
  test.setTimeout(180_000)
  for (const viewport of [VIEWPORTS[1], VIEWPORTS[4]]) {
    for (const theme of ['light', 'dark']) {
      await openInvestments(page, viewport, { theme })
      const results = await new AxeBuilder({ page }).analyze()
      expect(results.violations, `${viewport.name}/${theme}`).toEqual([])
    }
  }

  await openInvestments(page, VIEWPORTS[4])
  await page.getByRole('button', { name: 'Fixture Index Tracker' }).click()
  await page.getByRole('dialog').waitFor()
  const detail = await new AxeBuilder({ page }).analyze()
  expect(detail.violations, 'detail').toEqual([])

  await page.setViewportSize({ width: 390, height: 900 })
  await page.goto('/v6-investments-preview.html?fixture=incomplete')
  await page.getByText(/No published FX rate for CHF/).first().waitFor()
  await page.evaluate(() => Promise.all(document.getAnimations().map((animation) => animation.finished.catch(() => undefined))))
  const incomplete = await new AxeBuilder({ page }).analyze()
  expect(incomplete.violations, 'incomplete').toEqual([])
})
