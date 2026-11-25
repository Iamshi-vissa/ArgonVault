import { defineConfig } from '@playwright/test';

/**
 * End-to-end tests against the production build (npm run build), served by
 * vite preview. CI installs Playwright's Chromium; locally, set CHROME_PATH to
 * use an installed Chrome instead.
 */
export default defineConfig({
  testDir: 'e2e',
  timeout: 90_000,
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://localhost:4173',
    acceptDownloads: true,
    launchOptions: process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}
  },
  webServer: {
    command: 'npm run preview',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000
  }
});
