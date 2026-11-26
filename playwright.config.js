import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/browser',
  globalSetup: './tests/browser/setup.js',
  workers: 1,
  fullyParallel: false,
  timeout: 30_000,
  reporter: 'list',
  use: { headless: true, trace: 'off', screenshot: 'off', video: 'off' }
});
