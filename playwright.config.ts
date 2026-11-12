import { defineConfig, devices } from '@playwright/test';

const PORT = 3100;
const CI = !!process.env['CI'];
/** Locally, use the Chrome that's already installed; CI installs Playwright's own Chromium. */
const channel = CI ? undefined : 'chrome';

/**
 * Browser tests against the production build, served from one port like `npm start`.
 * A fresh in-memory database each run, no rival bidders and no routing service,
 * so every run starts from the same place and only the tests change anything.
 */
export default defineConfig({
  testDir: './e2e',
  // One server and one database: run in order so tests don't bid against each other.
  workers: 1,
  fullyParallel: false,
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  reporter: CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop', testIgnore: /mobile\.spec\.ts/, use: { ...devices['Desktop Chrome'], channel } },
    { name: 'mobile', testMatch: /mobile\.spec\.ts/, use: { ...devices['Pixel 7'], channel } },
  ],
  webServer: {
    command: 'npm start',
    url: `http://localhost:${PORT}/api/vehicles?pageSize=1`,
    reuseExistingServer: !CI,
    timeout: 300_000,
    env: { PORT: String(PORT), DB_PATH: ':memory:', SIMULATE_BIDDING: 'false', ROUTING_URL: 'off' },
  },
});
