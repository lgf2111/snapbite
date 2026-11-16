import { defineConfig, devices } from '@playwright/test';

/**
 * The gesture tests need a browser that sends real touch, pointer and touchend
 * events, which jsdom cannot. Chromium with `hasTouch` does, and CDP's
 * Input.dispatchTouchEvent makes them trusted, so `input.click()` inside the
 * touchend handler behaves as it does on a phone.
 *
 * The picker spec runs in mobile WebKit, the engine an iPhone actually uses,
 * with the iPhone 15 Pro Max profile. It cannot generate trusted touch moves,
 * so it drives the same handlers with synthetic events; the Chromium project
 * covers the trusted path and the real file chooser.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:5173',
  },
  projects: [
    {
      name: 'chromium-touch',
      testIgnore: /mobile-webkit/,
      use: {
        browserName: 'chromium',
        viewport: { width: 430, height: 932 },
        deviceScaleFactor: 3,
        isMobile: true,
        hasTouch: true,
      },
    },
    {
      name: 'mobile-webkit',
      testMatch: /mobile-webkit/,
      use: {
        ...devices['iPhone 15 Pro Max'],
      },
    },
  ],
  webServer: {
    command: 'pnpm dev --host 127.0.0.1 --port 5173',
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
