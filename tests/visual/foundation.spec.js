import { expect, test } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

const VIEWPORTS = [
  { name: 'mobile', width: 390, height: 844 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'desktop', width: 1440, height: 900 },
]

async function openHarness(page, { dark = false, viewport = VIEWPORTS[2] } = {}) {
  await page.setViewportSize({ width: viewport.width, height: viewport.height })
  await page.goto('/design-system.html')
  await page.evaluate(() => document.fonts.ready)
  await page.addStyleTag({ content: '* { caret-color: transparent !important; }' })
  if (dark) await page.getByRole('button', { name: 'Use dark theme' }).click()
}

test('deterministic foundation states at representative widths and themes', async ({ page }) => {
  for (const viewport of VIEWPORTS) {
    for (const theme of ['light', 'dark']) {
      await openHarness(page, { dark: theme === 'dark', viewport })
      await expect(page).toHaveScreenshot(`foundation-${viewport.name}-${theme}.png`, {
        fullPage: true,
        animations: 'disabled',
      })
    }
  }
})

test('light and dark harnesses have no axe violations', async ({ page }) => {
  for (const dark of [false, true]) {
    await openHarness(page, { dark })
    const results = await new AxeBuilder({ page }).analyze()
    expect(results.violations).toEqual([])
  }
})

test('focus, target sizing, long labels, and reduced motion are enforced', async ({ page }) => {
  await openHarness(page, { viewport: VIEWPORTS[0] })

  await page.keyboard.press('Tab')
  const focused = page.locator(':focus-visible')
  await expect(focused).toBeVisible()
  const focusStyle = await focused.evaluate((element) => {
    const style = getComputedStyle(element)
    return { style: style.outlineStyle, width: Number.parseFloat(style.outlineWidth) }
  })
  expect(focusStyle.style).not.toBe('none')
  expect(focusStyle.width).toBeGreaterThanOrEqual(2)

  for (const label of ['Primary action', 'More options']) {
    const box = await page.getByRole('button', { name: label }).boundingBox()
    expect(box.height).toBeGreaterThanOrEqual(44)
    expect(box.width).toBeGreaterThanOrEqual(44)
  }
  const documentFits = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)
  expect(documentFits).toBe(true)

  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.getByRole('button', { name: 'Open dialog' }).click()
  const dialog = page.getByRole('dialog', { name: 'Inspect fixture details' })
  await expect(dialog).toBeVisible()
  await expect(page.getByRole('button', { name: 'Close dialog' })).toBeFocused()
  const duration = await dialog.evaluate((element) => getComputedStyle(element).animationDuration)
  expect(['0s', '1e-05s', '0.00001s', '0.01ms']).toContain(duration)
  await page.keyboard.press('Escape')
  await expect(page.getByRole('button', { name: 'Open dialog' })).toBeFocused()

  const dataDisclosure = page.getByText('View data table')
  await dataDisclosure.focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('table', { name: 'Illustrative history fixture data' })).toBeVisible()
})
