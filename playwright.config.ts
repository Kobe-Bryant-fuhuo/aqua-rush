import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:5188';
const serverCommand =
  process.env.PLAYWRIGHT_SERVER_COMMAND ??
  'node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5188 --strictPort';
const useExternalServer = process.env.PLAYWRIGHT_EXTERNAL_SERVER === '1';

export default defineConfig({
  testDir: './tests',
  // One worker: parallel headless WebGL contexts contend for the GPU, and the
  // frame-time collapse makes game time drift from wall time, flaking timed
  // gameplay phases and screenshot baselines.
  workers: 1,
  timeout: 30_000,
  expect: {
    timeout: 5_000,
  },
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: useExternalServer
    ? undefined
    : {
        command: serverCommand,
        url: baseURL,
        reuseExistingServer: false,
        timeout: 20_000,
      },
  projects: [
    {
      name: 'desktop-chrome',
      use: {
        ...devices['Desktop Chrome'],
        // devices['Desktop Chrome'] sets no channel, so Playwright launches the
        // bundled headless shell, which has no GPU backend and falls back to
        // SwiftShader (CPU) — roughly 4x slower raster and meaningless FPS.
        // The full Chromium build renders headless on the real GPU.
        channel: 'chromium',
        viewport: { width: 1280, height: 720 },
      },
    },
    {
      name: 'mobile-chrome',
      use: {
        ...devices['iPhone 13'],
        browserName: 'chromium',
        channel: 'chromium',
      },
    },
  ],
});
