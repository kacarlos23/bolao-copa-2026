import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  outputDir: '../../output/playwright/test-results',
  fullyParallel: true,
  retries: 0,
  reporter: [['line']],
  use: {
    ...devices['Desktop Chrome'],
    baseURL: 'http://127.0.0.1:4173',
    locale: 'pt-BR',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run build && npm run serve:dist',
    env: {
      EXPO_PUBLIC_BRASILEIRAO_UI: '1',
      EXPO_PUBLIC_COMPETITION_UI_V2: '1',
      PORT: '4173',
    },
    port: 4173,
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
