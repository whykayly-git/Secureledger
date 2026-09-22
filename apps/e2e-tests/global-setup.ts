import { request, FullConfig } from "@playwright/test";
import fs from "fs";
import path from "path";

/**
 * Registers one real organisation/user via the actual API (not a UI
 * flow — that's what register.spec.ts tests) and saves the resulting
 * session cookie as Playwright storage state, so every other spec file
 * starts already logged in rather than re-registering per test.
 */
async function globalSetup(config: FullConfig): Promise<void> {
  const baseURL = config.projects[0]?.use?.baseURL ?? process.env.E2E_BASE_URL ?? "http://localhost:3000";
  const context = await request.newContext({ baseURL });

  const email = `e2e+${Date.now()}@example.com`;
  const password = "e2e-test-password-123";

  const res = await context.post("/api/auth/register", {
    data: {
      organisationName: "Playwright E2E Org",
      name: "Playwright Tester",
      email,
      password,
    },
  });

  if (!res.ok()) {
    throw new Error(`Global setup: registration failed (${res.status()}): ${await res.text()}`);
  }

  const authDir = path.join(__dirname, "playwright", ".auth");
  fs.mkdirSync(authDir, { recursive: true });

  await context.storageState({ path: path.join(authDir, "user.json") });
  fs.writeFileSync(path.join(authDir, "credentials.json"), JSON.stringify({ email, password }, null, 2));

  await context.dispose();
}

export default globalSetup;
