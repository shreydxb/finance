import { expect, test } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

const VIEWPORTS = [
  { name: 'phone', width: 390, height: 844 },
  { name: 'breakpoint', width: 900, height: 900 },
  { name: 'desktop', width: 1440, height: 1200 },
]

async function openShell(page, viewport, dark) {
  await page.setViewportSize(viewport)
  await page.goto('/shell-preview.html')
  await page.evaluate((theme) => localStorage.setItem('ourmoney.theme', theme), dark ? 'dark' : 'light')
  await page.reload()
  await page.evaluate(() => document.fonts.ready)
  await page.addStyleTag({ content: '* { caret-color: transparent !important; }' })
}

test('V6 shell is deterministic across desktop, breakpoint, phone, light, and dark', async ({ page }) => {
  for (const viewport of VIEWPORTS) {
    for (const theme of ['light', 'dark']) {
      await openShell(page, viewport, theme === 'dark')
      await expect(page).toHaveScreenshot(`shell-${viewport.name}-${theme}.png`, {
        animations: 'disabled',
      })
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
    }
  }
})

test('shell landmarks and shared drawer pass automated accessibility checks', async ({ page }) => {
  await openShell(page, VIEWPORTS[0], false)
  await page.locator('.shell-mobile-header .shell-preferences-button').click()
  await expect(page.getByRole('dialog', { name: 'Preferences and account' })).toBeVisible()
  const results = await new AxeBuilder({ page }).analyze()
  expect(results.violations).toEqual([])
})
