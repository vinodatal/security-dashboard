import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  timeout: 180_000, // 3 min per test (workflows call real APIs)
  expect: { timeout: 30_000 },
  fullyParallel: false, // workflows share MCP server state
  retries: 0,
  workers: 1, // sequential — single MCP server
  reporter: [
    ["html", { open: "never", outputFolder: "test-results/html" }],
    ["list"],
  ],
  outputDir: "test-results/artifacts",

  use: {
    baseURL: "http://localhost:3001",
    channel: "msedge",
    headless: false, // visible for demo recording
    screenshot: "on",
    trace: "retain-on-failure",
    actionTimeout: 15_000,
  },

  // Auth state reused across tests
  projects: [
    {
      name: "auth",
      testMatch: /auth\.setup\.ts/,
    },
    {
      name: "workflows",
      dependencies: ["auth"],
      use: {
        storageState: "test-results/.auth/state.json",
      },
    },
  ],

  webServer: {
    command: "npx next dev --port 3001",
    port: 3001,
    reuseExistingServer: true,
    timeout: 30_000,
  },
});
