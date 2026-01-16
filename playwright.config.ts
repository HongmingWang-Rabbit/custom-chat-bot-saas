import { defineConfig, devices } from '@playwright/test';
import { DEFAULT_BASE_URL, TIMEOUTS } from './e2e/fixtures/test-data';

/**
 * Playwright E2E Configuration
 *
 * Tests run against real database with demo-company tenant.
 * Run `npm run seed` before tests to ensure test data exists.
 */
export default defineConfig({
  testDir: './e2e',

  // Run tests sequentially for database consistency
  fullyParallel: false,
  workers: 1,

  // Fail fast on CI
  forbidOnly: !!process.env.CI,

  // Retry once on CI
  retries: process.env.CI ? 1 : 0,

  // Reporter
  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report' }],
  ],

  // Global timeout for tests (streaming responses need longer)
  timeout: TIMEOUTS.streaming,

  // Expect timeout
  expect: {
    timeout: TIMEOUTS.default,
  },

  // Global setup/teardown
  globalSetup: './e2e/global-setup.ts',
  globalTeardown: './e2e/global-teardown.ts',

  use: {
    // Base URL for navigation
    baseURL: process.env.BASE_URL || DEFAULT_BASE_URL,

    // Screenshot on failure
    screenshot: 'only-on-failure',

    // Trace on failure
    trace: 'on-first-retry',

    // Video on failure
    video: 'on-first-retry',
  },

  // Only Chromium for speed
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  // Start dev server before running tests (optional, can be disabled in CI)
  webServer: process.env.CI ? undefined : {
    command: 'npm run dev',
    url: DEFAULT_BASE_URL,
    reuseExistingServer: true,
    timeout: 120000,
  },
});
