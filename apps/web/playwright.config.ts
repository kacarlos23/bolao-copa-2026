import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  outputDir: '../../output/playwright/test-results',
  fullyParallel: true,
  retries: 0,
  reporter: [['line'], ['json', { outputFile: '../../output/release-gates/playwright.json' }]],
  projects: [
    {
      name: 'desktop-chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'mobile-chromium',
      use: { ...devices['Pixel 5'] },
    },
  ],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    locale: 'pt-BR',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run serve:e2e',
    env: {
      EXPO_PUBLIC_APP_IA_V2: '1',
      EXPO_PUBLIC_BRASILEIRAO_UI: '1',
      EXPO_PUBLIC_COMPETITION_UI_V2: '1',
      EXPO_PUBLIC_LEGACY_ADMIN_MUTATIONS: '1',
      PORT: '4173',
    },
    port: 4173,
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
