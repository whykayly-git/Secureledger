import path from "path";
import { defineConfig, devices } from "@playwright/test";

/**
 * Runs against an already-running instance (app + database) — see
 * apps/e2e-tests/README.md. Not started automatically here, since this
 * repo's local dev database (PGlite) isn't a plain `npm run dev` process
 * Playwright's webServer option could reliably manage.
 */
export default defineConfig({
  testDir: "./tests",
  fullyParallel: false, // tests share one seeded organisation/session in sequence
  workers: 1,
  retries: 0,
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  globalSetup: require.resolve("./global-setup"),
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    // Every spec starts already logged in (see global-setup.ts); register.spec.ts
    // explicitly clears this to test the real, unauthenticated registration flow.
    storageState: path.join(__dirname, "playwright/.auth/user.json"),
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
