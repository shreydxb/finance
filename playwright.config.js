import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/visual',
  outputDir: 'test-results/playwright',
  snapshotPathTemplate: '{testDir}/__screenshots__/{arg}{ext}',
  fullyParallel: false,
  retries: 0,
  use: {
    baseURL: 'http://127.0.0.1:4175',
    colorScheme: 'light',
    trace: 'retain-on-failure',
  },
})
