import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests',
  use: {
    baseURL: 'https://home.localhost:8443',
    ignoreHTTPSErrors: true
  },
  retries: 0,
  webServer: undefined
})
