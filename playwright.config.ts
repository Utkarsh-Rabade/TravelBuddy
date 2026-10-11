import { defineConfig, devices } from '@playwright/test';

/**
 * Read environment variables from file.
 * https://github.com/motdotla/dotenv
 */
// require('dotenv').config();

/**
 * See https://playwright.dev/docs/test-configuration.
 */
export default defineConfig({
  testDir: './tests',
  /* Maximum time one test can run for. */
  timeout: 30 * 1000,
  expect: {
    /**
     * Maximum time expect() should wait for the condition to be met.
     * For example in `await expect(locator).toHaveText('');`
     */
    timeout: 5000
  },
  /* Run tests in files in parallel */
  fullyParallel: true,
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,
  /* Retry on CI only */
  retries: process.env.CI ? 2 : 0,
  /* Opt out of parallel tests on CI. */
  workers: process.env.CI ? 1 : undefined,
  /* Reporter to use. See https://playwright.dev/docs/test-reporters */
  reporter: 'html',
  /* Shared settings for all the projects below. See https://playwright.dev/docs/test-classic */
  use: {
    /* Maximum time each operation such as `click()` can take. */
    actionTimeout: 0,
    /* Base URL to use in actions like `await expect(page).toHaveText('http://')`. */
    baseURL: process.env.TRAVELBUDDY_TEST_BASE_URL || 'http://127.0.0.1:3000',

    /* Collect trace when retrying the failed test. See https://playwright.dev/docs/test-trace */
    trace: 'on-first-retry',
  },
  /* Configure projects for major environments */
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chromium'] },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },
    /* Test against mobile viewports. */
    {
      name: 'Mobile Chromium',
      use: { ...devices['Pixel 5'] },
    },
    {
      name: 'Mobile Safari',
      use: { ...devices['iPhone 12'] },
    },
    /* Test against branded browsers. */
    {
      name: 'Microsoft Edge',
      use: { ...devices['Desktop Edge'], channel: 'msedge' },
    },
    {
      name: 'Google Chrome',
      use: { ...devices['Desktop Chrome'], channel: 'chrome' },
    },
  ],
  webServer: {
    command: `npm run start -- --hostname 127.0.0.1 --port ${new URL(process.env.TRAVELBUDDY_TEST_BASE_URL || 'http://127.0.0.1:3000').port}`,
    url: process.env.TRAVELBUDDY_TEST_BASE_URL || 'http://127.0.0.1:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 60000,
  },
  /* Folder for test artifacts such as screenshots, videos, traces, etc. */
  // outputDir: 'test-results/',
});
