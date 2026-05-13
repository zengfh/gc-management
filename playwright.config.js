import { defineConfig, devices } from '@playwright/test';

const clientPort = Number(process.env.E2E_CLIENT_PORT || 5173);
const apiPort = Number(process.env.E2E_API_PORT || 3001);
const appOrigin = `http://127.0.0.1:${clientPort}`;
const dbPath = process.env.E2E_DB_PATH || 'test/e2e-data/gcmanager.db';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: appOrigin,
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: [
      'rm -rf test/e2e-data',
      'mkdir -p test/e2e-data',
      [
        `APP_ORIGIN=${appOrigin},http://localhost:${clientPort}`,
        `GC_DB_PATH=${dbPath}`,
        `PORT=${apiPort}`,
        `VITE_API_TARGET=http://127.0.0.1:${apiPort}`,
        `concurrently -k -n server,client "npm run dev:server" "npm run dev:client -- --port ${clientPort} --strictPort"`,
      ].join(' '),
    ].join(' && '),
    url: appOrigin,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
