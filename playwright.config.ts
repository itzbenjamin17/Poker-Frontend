import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1, // Keep it sequential for multiplayer stability
  reporter: 'html',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  // Start local dev server and backend before starting the tests
  webServer: [
    {
      command: 'npm run dev',
      url: 'http://localhost:5173',
      reuseExistingServer: !process.env.CI,
      timeout: 120 * 1000,
    },
    {
      command: `node -e "require('child_process').spawn(process.platform === 'win32' ? 'mvnw.cmd' : './mvnw', ['spring-boot:run', '-Dspring-boot.run.profiles=test'], {stdio: 'inherit', shell: true})"`,
      cwd: '../Poker',
      url: 'http://localhost:8080/actuator/health',
      reuseExistingServer: !process.env.CI,
      timeout: 120 * 1000,
      env: {
        SPRING_PROFILES_ACTIVE: 'test',
      },
    }
  ],
});
