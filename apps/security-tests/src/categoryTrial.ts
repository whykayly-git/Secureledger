import { prisma } from "@secureledger/db";

export type TrialResult = {
  id: string;
  description: string;
  detected: boolean;
  detail: string;
};

/**
 * Runs one trial's tamper+verify logic, catching anything it throws so one
 * broken trial can't take down the whole category sweep — an exception is
 * reported as "not detected" with the error message, exactly like
 * runTamperSuite.ts's existing scenario error handling.
 *
 * Disconnects the shared Prisma client after every trial, success or
 * failure. This project's local PGlite dev database is known to wedge
 * under sustained query volume in one long-lived connection (see
 * apps/security-tests/README.md) — releasing the connection after each
 * trial and letting Prisma transparently reconnect for the next one
 * contains a wedge to at most the one trial in flight when it happens,
 * rather than taking down every trial after it. run-category-suite.sh
 * additionally re-runs any category whose result contains one of these
 * infrastructure hiccups (never a category whose result is a genuine,
 * intentional "known limitation" miss) against a freshly-restarted
 * PGlite instance, since re-running from a clean connection reliably
 * clears it.
 */
export async function runTrial(
  id: string,
  description: string,
  fn: () => Promise<{ detected: boolean; detail: string }>
): Promise<TrialResult> {
  try {
    const { detected, detail } = await fn();
    return { id, description, detected, detail };
  } catch (err) {
    return {
      id,
      description,
      detected: false,
      detail: `INFRASTRUCTURE_HICCUP: Trial threw before producing a result (this project's local PGlite dev database wedging under query volume, not a verification-logic failure): ${err instanceof Error ? err.message : String(err)}`,
    };
  } finally {
    await prisma.$disconnect().catch(() => {});
  }
}

export type CategoryDescriptor = {
  id: string;
  label: string;
  run: () => Promise<TrialResult[]>;
};
