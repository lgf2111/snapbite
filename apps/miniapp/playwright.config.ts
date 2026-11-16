import { defineConfig } from '@playwright/test';

/**
 * The gesture tests need a browser that sends real touch, pointer and touchend
 * events, which jsdom cannot. Chromium with `hasTouch` does, and CDP's
 * Input.dispatchTouchEvent makes them trusted, so `input.click()` inside the
 * touchend handler behaves as it does on a phone.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:5173',
    browserName: 'chromium',
    viewport: { width: 430, height: 932 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
  },
  webServer: {
    command: 'pnpm dev --host 127.0.0.1 --port 5173',
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
