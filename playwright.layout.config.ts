import { defineConfig, devices } from '@playwright/test';

// Layout-only config: boots just the Vite dev server (the mocked layout specs need no backend).
export default defineConfig({
  testDir: './scripts/layout',
  testMatch: /layout-.*\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:5173',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 120 * 1000,
  },
});
