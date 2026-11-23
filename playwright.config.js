import { defineConfig } from '@playwright/test';

// Сквозные тесты: поднимаем реальный сервер (API + собранный dist) на временной БД.
// Перед запуском нужна сборка: npm run build (скрипт test:e2e делает это сам).
const PORT = 3111;
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  retries: 0,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    launchOptions: process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {},
    locale: 'ru-RU',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'node --disable-warning=ExperimentalWarning server/src/index.js',
    url: `http://127.0.0.1:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      PORT: String(PORT),
      NODE_ENV: 'development',
      DATA_DIR: './server/.e2e-data',
      JWT_SECRET: 'e2e-secret',
      API_RATE_LIMIT: '100000',
    },
  },
});
