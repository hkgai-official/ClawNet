import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  fullyParallel: false, // Electron + fake-server share port; serial is safest
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    actionTimeout: 10_000,
    screenshot: 'only-on-failure',
    trace: process.env.CI ? 'on-first-retry' : 'retain-on-failure',
  },
});
