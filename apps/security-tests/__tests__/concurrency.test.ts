/**
 * Concurrent-transaction and database-rollback stress tests.
 *
 * Separate from tamper.test.ts (which tests detection of tampering after
 * the fact). This file validates the advisory-lock concurrency fix in
 * packages/ledger/src/hashChain.ts directly: that concurrent postings for
 * one organisation can no longer fork the hash chain, that the lock does
 * not accidentally serialize different organisations against each other,
 * and that a mid-transaction failure rolls back the accounting write and
 * the hash-chain write together, atomically.
 *
 * Requires a reachable DATABASE_URL — same as tamper.test.ts, and
 * likewise excluded from the root `npm test`. Run with
 * `npm run test:concurrency-stress` (or `npm run test --workspace=apps/security-tests`
 * for the Jest form, which runs alongside tamper.test.ts).
 */
import { CONCURRENCY_SCENARIOS } from "../src/concurrencyScenarios";
import { disconnectHarness } from "../src/harness";

afterAll(async () => {
  await disconnectHarness();
});

describe("SecureLedger concurrency & rollback stress suite", () => {
  it.each(CONCURRENCY_SCENARIOS)(
    "Scenario $id — $label",
    async ({ run }) => {
      const result = await run();

      // eslint-disable-next-line no-console
      console.log(
        `[${result.pass ? "PASS" : "FAIL"}] Scenario ${result.id} — ${result.name}\n` +
          `  ${result.detail}` +
          (result.metrics ? `\n  metrics: ${JSON.stringify(result.metrics)}` : "")
      );

      expect(result.pass).toBe(true);
    },
    120000
  );
});
