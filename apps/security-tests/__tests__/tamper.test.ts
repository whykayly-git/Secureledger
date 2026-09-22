/**
 * Tamper-detection security test suite.
 *
 * Validates the non-functional requirement: "The system shall detect 100%
 * of simulated unauthorised alterations to a previously posted
 * transaction during security testing."
 *
 * Every scenario mutates rows ALREADY COMMITTED to the database directly
 * via Prisma — bypassing apps/web's API entirely — simulating an attacker
 * or insider with raw database access, then calls the real (unmodified)
 * @secureledger/verification package and asserts the verdict it returns.
 *
 * IMPORTANT: if a scenario's `expect` fails here, that is this suite
 * doing its job — it means the real verification logic did not catch a
 * real tampering scenario. Do not "fix" a failing assertion by weakening
 * it; report the gap. See README.md in this package for the current,
 * honestly-reported detection rate and root-cause analysis of any gaps.
 *
 * Requires a reachable DATABASE_URL (see .env.example) — these are
 * integration tests against a real Postgres-compatible database, not
 * mocked, and are intentionally excluded from the root `npm test` (which
 * stays DB-free) — run them with `npm run test:tamper-detection`.
 */
import { SCENARIOS } from "../src/scenarios";
import { disconnectHarness } from "../src/harness";

afterAll(async () => {
  await disconnectHarness();
});

describe("SecureLedger tamper-detection suite", () => {
  it.each(SCENARIOS)("Scenario $id — $label", async ({ run }) => {
    const result = await run();

    // eslint-disable-next-line no-console
    console.log(
      `[${result.pass ? "PASS" : "FAIL"}] Scenario ${result.id} — ${result.name}\n` +
        `  Tampered: ${result.tamperDescription}\n` +
        `  Expected verdict: "${result.expectedVerdict}" | Actual verdict: "${result.actualVerdict}"\n` +
        `  ${result.detail}`
    );

    expect(result.actualVerdict).toBe(result.expectedVerdict);
  });
});
