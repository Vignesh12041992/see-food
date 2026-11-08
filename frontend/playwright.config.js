const { defineConfig, devices } = require('@playwright/test');

/**
 * End-to-end tests run a real browser against the real Next.js app and the real
 * FastAPI backend. Only OpenRouter is replaced, by a local stub started by
 * ../backend/tests/e2e_server.py, so no API key or network access is needed.
 *
 * Optional environment variables:
 *   E2E_PYTHON        Python executable for the backend (default: python3)
 *   E2E_BROWSER_PATH  Path to an existing Chrome/Chromium binary. If unset,
 *                     Playwright's own Chromium is used (npx playwright install chromium).
 */
const python = process.env.E2E_PYTHON || 'python3';
const browserPath = process.env.E2E_BROWSER_PATH;

module.exports = defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  workers: 1, // tests share one backend and one stub request log
  fullyParallel: false,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        ...(browserPath ? { launchOptions: { executablePath: browserPath } } : {}),
      },
    },
  ],
  webServer: [
    {
      command: `${python} ../backend/tests/e2e_server.py`,
      url: 'http://127.0.0.1:8000/',
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: 'npm run build && npx next start -p 3000',
      url: 'http://localhost:3000',
      reuseExistingServer: false,
      timeout: 180_000,
    },
  ],
});
