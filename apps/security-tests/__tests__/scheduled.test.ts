/**
 * Scheduled verification and alerts, against a real database.
 *
 * Uses the checkpoint worker's real runVerificationCycle with the real
 * verifier. The cycle visits every organisation, so the verifier and the
 * recorder are wrapped to act only on this test's organisation. "Time" is
 * moved forward by passing `now`, so no test waits for an interval.
 */
import { prisma } from "@secureledger/db";
import { acknowledgeAlert, getAlertState, recordVerificationRun, verifyOrganisation } from "@secureledger/verification";
import { runVerificationCycle } from "@secureledger/checkpoint-worker/verificationCycle";
import {
  createTestOrganisation,
  disconnectHarness,
  postJournalEntry,
  runCheckpoint,
  teardownOrganisation,
  TestOrgContext,
} from "../src/harness";

const HOUR = 60 * 60 * 1000;
let ctx: TestOrgContext;

beforeEach(async () => {
  ctx = await createTestOrganisation("scheduled");
});
afterEach(async () => {
  await teardownOrganisation(ctx.organisationId);
});
afterAll(async () => {
  await disconnectHarness();
});

const emptyResult = {
  totalRecords: 0,
  checkedRecords: 0,
  truncated: false,
  counts: { verified: 0, pending: 0, failed: 0 },
  failures: [],
  continuity: { intact: true, totalRows: 0, gaps: [] },
  durationMs: 0,
};

/** One scheduled cycle at a chosen moment, acting only on the test organisation. */
function cycleAt(now: Date) {
  return runVerificationCycle(prisma, {
    intervalMs: HOUR,
    now,
    verify: (id, max) => (id === ctx.organisationId ? verifyOrganisation(id, max) : Promise.resolve(emptyResult)),
    record: async (id, v) => (id === ctx.organisationId ? recordVerificationRun(id, "SCHEDULED", v) : undefined),
  });
}

const runs = () => prisma.verificationRun.findMany({ where: { organisationId: ctx.organisationId }, orderBy: { createdAt: "asc" } });
const later = (hours: number) => new Date(Date.now() + hours * HOUR);

async function seedAndCheckpoint(n = 3) {
  const entries = [];
  for (let i = 0; i < n; i++) entries.push(await postJournalEntry(ctx, `entry ${i}`, 10 + i));
  await runCheckpoint();
  return entries;
}
const tamper = async (entryId: string, amount: number) => {
  const line = await prisma.journalLine.findFirstOrThrow({ where: { journalEntryId: entryId, debit: { gt: 0 } } });
  await prisma.journalLine.update({ where: { id: line.id }, data: { debit: amount } });
};

describe("scheduled verification", () => {
  it("records a clean scheduled run and raises no alert", async () => {
    await seedAndCheckpoint();
    await cycleAt(later(0));

    const [run] = await runs();
    expect(run).toMatchObject({ source: "SCHEDULED", verifiedCount: 3, failedCount: 0, continuityIntact: true, problemSignature: null });
    expect((await getAlertState(ctx.organisationId)).active).toBe(false);
  });

  it("does not run again until the interval has passed", async () => {
    await seedAndCheckpoint();
    await cycleAt(later(0));
    await cycleAt(later(0.5));
    expect(await runs()).toHaveLength(1);

    await cycleAt(later(1.5));
    expect(await runs()).toHaveLength(2);
  });

  it("raises an alert when a record has been altered", async () => {
    const [first] = await seedAndCheckpoint();
    await tamper(first.entry.id, 9999);
    await cycleAt(later(0));

    const [run] = await runs();
    expect(run.failedCount).toBe(1);
    expect(run.problemSignature).not.toBeNull();
    const state = await getAlertState(ctx.organisationId);
    expect(state.active).toBe(true);
    expect(state.latest?.failedCount).toBe(1);
  });

  it("raises an alert when a chain row has been deleted", async () => {
    const entries = await seedAndCheckpoint(4);
    await prisma.ledgerChain.delete({ where: { id: entries[1].chainEntry.id } });
    await cycleAt(later(0));

    const [run] = await runs();
    expect(run.continuityIntact).toBe(false);
    expect(run.gapCount).toBeGreaterThan(0);
    expect((await getAlertState(ctx.organisationId)).active).toBe(true);
  });

  it("stays quiet after an acknowledgement while the same problem persists, and alerts again for a new one", async () => {
    const [first, second] = await seedAndCheckpoint();
    await tamper(first.entry.id, 9999);
    await cycleAt(later(0));
    expect((await getAlertState(ctx.organisationId)).active).toBe(true);

    await acknowledgeAlert(ctx.organisationId, ctx.userId);
    expect((await getAlertState(ctx.organisationId)).active).toBe(false);

    await cycleAt(later(2)); // same tampering, found again
    expect(await runs()).toHaveLength(2);
    expect((await getAlertState(ctx.organisationId)).active).toBe(false);

    await tamper(second.entry.id, 8888); // something new
    await cycleAt(later(4));
    expect((await getAlertState(ctx.organisationId)).active).toBe(true);
  });

  it("clears the alert when a later run is clean", async () => {
    const [first] = await seedAndCheckpoint();
    const line = await prisma.journalLine.findFirstOrThrow({ where: { journalEntryId: first.entry.id, debit: { gt: 0 } } });
    const original = line.debit;
    await prisma.journalLine.update({ where: { id: line.id }, data: { debit: 5555 } });
    await cycleAt(later(0));
    expect((await getAlertState(ctx.organisationId)).active).toBe(true);

    await prisma.journalLine.update({ where: { id: line.id }, data: { debit: original } });
    await cycleAt(later(2));
    expect((await getAlertState(ctx.organisationId)).active).toBe(false);
  });
});
