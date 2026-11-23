import { defineConfig, devices } from '@playwright/test';
import { PLAYTEST_BACKEND_ENV } from './scripts/playtest/timings';

const backendDir = process.env.BACKEND_DIR || '../Poker';
const mvnw = process.platform === 'win32' ? '.\\mvnw.cmd' : './mvnw';

// Playtest config: real backend (no mocks) with short timers, so timeouts, grace periods and the
// ready gate can be exercised in minutes. global-setup refuses to run against a backend that was
// started with other timings.
export default defineConfig({
    testDir: './scripts/playtest',
    testMatch: /\.playtest\.spec\.ts$/,
    globalSetup: './scripts/playtest/global-setup.ts',
    fullyParallel: true,
    workers: 3,
    timeout: 120_000,
    expect: { timeout: 10_000 },
    reporter: [['list'], ['html', { outputFolder: 'playwright-report/playtest', open: 'never' }]],
    outputDir: 'test-results/playtest',
    use: {
        baseURL: 'http://localhost:5173',
        trace: 'retain-on-failure',
        screenshot: 'only-on-failure',
    },
    projects: [
        {
            name: 'chromium',
            use: { ...devices['Desktop Chrome'], viewport: { width: 1366, height: 768 } },
        },
        {
            // Safari on an iPhone 14 held sideways: 750x340 after the notch and browser bars.
            name: 'iphone-14-landscape',
            use: { ...devices['iPhone 14 landscape'] },
        },
    ],
    webServer: [
        {
            command: 'npm run dev',
            url: 'http://localhost:5173',
            reuseExistingServer: true,
            timeout: 120_000,
        },
        {
            command: `${mvnw} spring-boot:test-run -Dspring-boot.run.profiles=test,frontend-e2e`,
            cwd: backendDir,
            url: 'http://localhost:8080/actuator/health',
            env: { ...process.env, ...PLAYTEST_BACKEND_ENV } as Record<string, string>,
            reuseExistingServer: true,
            timeout: 180_000,
            stdout: 'pipe',
            stderr: 'pipe',
        },
    ],
});
