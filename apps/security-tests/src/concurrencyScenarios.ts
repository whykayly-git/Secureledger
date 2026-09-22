import { prisma } from "@secureledger/db";
import { createTestOrganisation, postJournalEntry, teardownOrganisation } from "./harness";
import {
  attemptFailingInvoicePost,
  attemptFailingJournalEntryPost,
  getChainRows,
  validateLinearChain,
} from "./concurrency";

export type ConcurrencyScenarioResult = {
  id: string;
  name: string;
  pass: boolean;
  detail: string;
  metrics?: Record<string, string | number>;
};

/**
 * Scenario A — same-organisation concurrency.
 *
 * Fires N journal-entry postings for the SAME organisation truly
 * concurrently (Promise.all, no artificial staggering) and asserts the
 * resulting LedgerChain is a single valid linear chain: no forks, no
 * dropped/orphaned records. This is exactly the race the advisory lock
 * (packages/ledger/src/hashChain.ts) exists to prevent.
 */
export async function scenarioA_sameOrgConcurrency(concurrency = 15): Promise<ConcurrencyScenarioResult> {
  const ctx = await createTestOrganisation("concurrency-a-same-org");
  try {
    const results = await Promise.allSettled(
      Array.from({ length: concurrency }, (_, i) => postJournalEntry(ctx, `Concurrent entry #${i}`, 10 + i))
    );
    const failures = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");

    const rows = await getChainRows(ctx.organisationId);
    const integrity = validateLinearChain(rows);

    const noneDropped = rows.length === concurrency;
    const pass = failures.length === 0 && noneDropped && integrity.valid;

    const detailParts = [
      `${concurrency} concurrent postings for one organisation -> ${rows.length} LedgerChain rows written`,
      `${failures.length} posting(s) threw an error`,
      integrity.valid
        ? "chain is a single valid linear sequence (no forks, no orphans)"
        : `chain integrity issues: ${integrity.issues.join("; ")}`,
    ];
    if (failures.length > 0) {
      detailParts.push(`first error: ${String(failures[0].reason)}`);
    }

    return {
      id: "A",
      name: "Same-organisation concurrent postings produce a single valid chain",
      pass,
      detail: detailParts.join(". "),
      metrics: { postingsFired: concurrency, chainRowsWritten: rows.length, postingErrors: failures.length },
    };
  } finally {
    await teardownOrganisation(ctx.organisationId);
  }
}

/**
 * Scenario B — cross-organisation concurrency + throughput.
 *
 * Measures wall-clock time for `totalPosts` postings funneled through ONE
 * organisation (fully serialized by the advisory lock, by design) versus
 * the same `totalPosts` total spread across `orgCount` DIFFERENT
 * organisations posting concurrently (should NOT serialize against each
 * other). Asserts both correctness (every org's chain is independently
 * valid) and that cross-org throughput measurably beats the same-org
 * baseline — evidence the lock is scoped per-organisation, not global.
 */
export async function scenarioB_crossOrgConcurrency(
  orgCount = 8,
  postsPerOrg = 5
): Promise<ConcurrencyScenarioResult> {
  const totalPosts = orgCount * postsPerOrg;

  const baselineCtx = await createTestOrganisation("concurrency-b-baseline");
  const crossOrgs = await Promise.all(
    Array.from({ length: orgCount }, (_, i) => createTestOrganisation(`concurrency-b-org${i}`))
  );

  try {
    const sameOrgStart = Date.now();
    await Promise.all(
      Array.from({ length: totalPosts }, (_, i) => postJournalEntry(baselineCtx, `same-org baseline #${i}`, 5))
    );
    const sameOrgMs = Date.now() - sameOrgStart;

    const crossOrgStart = Date.now();
    await Promise.all(
      crossOrgs.flatMap((ctx, orgIdx) =>
        Array.from({ length: postsPerOrg }, (_, i) => postJournalEntry(ctx, `cross-org #${orgIdx}-${i}`, 5))
      )
    );
    const crossOrgMs = Date.now() - crossOrgStart;

    const baselineRows = await getChainRows(baselineCtx.organisationId);
    const baselineIntegrity = validateLinearChain(baselineRows);
    const baselineCorrect = baselineRows.length === totalPosts && baselineIntegrity.valid;

    let allCrossOrgsCorrect = true;
    const perOrgIssues: string[] = [];
    for (const ctx of crossOrgs) {
      const rows = await getChainRows(ctx.organisationId);
      const integrity = validateLinearChain(rows);
      if (rows.length !== postsPerOrg || !integrity.valid) {
        allCrossOrgsCorrect = false;
        perOrgIssues.push(
          `org ${ctx.organisationId}: ${rows.length}/${postsPerOrg} rows, valid=${integrity.valid} (${integrity.issues.join("; ")})`
        );
      }
    }

    const speedup = sameOrgMs / Math.max(crossOrgMs, 1);
    // Cross-org concurrency should measurably beat the fully-serialized
    // same-org baseline for identical total volume. A lenient 1.2x
    // threshold avoids flaking on measurement noise while still catching
    // an accidentally-global lock (which would show speedup ~= 1.0 or
    // worse, since it would serialize everything just like the baseline).
    const speedupHeldUp = speedup >= 1.2;

    const pass = baselineCorrect && allCrossOrgsCorrect && speedupHeldUp;

    const detail = [
      `Same-org baseline: ${totalPosts} postings to 1 organisation in ${sameOrgMs}ms (fully serialized by design)`,
      `Cross-org: same ${totalPosts} total postings across ${orgCount} organisations in ${crossOrgMs}ms`,
      `Speedup: ${speedup.toFixed(2)}x`,
      baselineCorrect ? "baseline org chain valid" : "baseline org chain INVALID",
      allCrossOrgsCorrect ? "all cross-org chains valid" : `cross-org chain issues: ${perOrgIssues.join(" | ")}`,
      speedupHeldUp
        ? "cross-org throughput held up — lock is correctly scoped per-organisation, not global"
        : `cross-org throughput did NOT clearly beat the same-org baseline (${speedup.toFixed(2)}x < 1.2x threshold) — investigate whether the lock is accidentally serializing across organisations, or whether this environment's database itself limits query concurrency regardless of locking (see apps/security-tests/README.md)`,
    ].join(". ");

    return {
      id: "B",
      name: "Cross-organisation postings are correct and not serialized against each other",
      pass,
      detail,
      metrics: {
        totalPosts,
        orgCount,
        sameOrgMs,
        crossOrgMs,
        speedup: `${speedup.toFixed(2)}x`,
      },
    };
  } finally {
    await teardownOrganisation(baselineCtx.organisationId);
    for (const ctx of crossOrgs) {
      await teardownOrganisation(ctx.organisationId);
    }
  }
}

/** Scenario C — mid-transaction failure rolls back the whole journal-entry posting transaction. */
export async function scenarioC_journalEntryRollback(): Promise<ConcurrencyScenarioResult> {
  const ctx = await createTestOrganisation("concurrency-c-rollback-je");
  try {
    const { recordId, error } = await attemptFailingJournalEntryPost(ctx);

    const entry = recordId ? await prisma.journalEntry.findUnique({ where: { id: recordId } }) : null;
    const lines = recordId ? await prisma.journalLine.findMany({ where: { journalEntryId: recordId } }) : [];
    const chainRows = recordId ? await prisma.ledgerChain.findMany({ where: { recordId } }) : [];

    const pass = !!recordId && entry === null && lines.length === 0 && chainRows.length === 0;

    return {
      id: "C",
      name: "Mid-transaction failure rolls back journal-entry posting entirely",
      pass,
      detail: [
        `Injected failure: ${error.message}`,
        `JournalEntry ${recordId} after rollback: ${entry === null ? "absent (correctly rolled back)" : "STILL PRESENT (orphaned!)"}`,
        `JournalLine rows for it: ${lines.length}`,
        `LedgerChain rows for it: ${chainRows.length}`,
      ].join(". "),
      metrics: { orphanedJournalEntry: entry === null ? 0 : 1, orphanedLines: lines.length, orphanedChainRows: chainRows.length },
    };
  } finally {
    await teardownOrganisation(ctx.organisationId);
  }
}

/** Scenario D — same as C, for the invoice posting transaction. */
export async function scenarioD_invoiceRollback(): Promise<ConcurrencyScenarioResult> {
  const ctx = await createTestOrganisation("concurrency-d-rollback-invoice");
  try {
    const { recordId, error } = await attemptFailingInvoicePost(ctx);

    const invoice = recordId ? await prisma.invoice.findUnique({ where: { id: recordId } }) : null;
    const chainRows = recordId ? await prisma.ledgerChain.findMany({ where: { recordId } }) : [];

    const pass = !!recordId && invoice === null && chainRows.length === 0;

    return {
      id: "D",
      name: "Mid-transaction failure rolls back invoice posting entirely",
      pass,
      detail: [
        `Injected failure: ${error.message}`,
        `Invoice ${recordId} after rollback: ${invoice === null ? "absent (correctly rolled back)" : "STILL PRESENT (orphaned!)"}`,
        `LedgerChain rows for it: ${chainRows.length}`,
      ].join(". "),
      metrics: { orphanedInvoice: invoice === null ? 0 : 1, orphanedChainRows: chainRows.length },
    };
  } finally {
    await teardownOrganisation(ctx.organisationId);
  }
}

export type ConcurrencyScenarioDescriptor = {
  id: string;
  label: string;
  run: () => Promise<ConcurrencyScenarioResult>;
};

export const CONCURRENCY_SCENARIOS: ConcurrencyScenarioDescriptor[] = [
  { id: "A", label: "Same-organisation concurrent postings -> single valid chain", run: () => scenarioA_sameOrgConcurrency() },
  { id: "B", label: "Cross-organisation concurrency correctness + throughput", run: () => scenarioB_crossOrgConcurrency() },
  { id: "C", label: "Mid-transaction failure rollback (journal entry)", run: scenarioC_journalEntryRollback },
  { id: "D", label: "Mid-transaction failure rollback (invoice)", run: scenarioD_invoiceRollback },
];
