import { prisma } from "@secureledger/db";
import { verifyLedgerChainEntryById, verifyChainContinuity } from "@secureledger/verification";
import { createTestOrganisation, postJournalEntry, runCheckpoint, teardownOrganisation } from "../harness";
import { runTrial, TrialResult } from "../categoryTrial";

/**
 * Category (d) — Reordering of entries within a batch (6 trials).
 *
 * Investigated empirically before writing this file (see the fix's
 * accompanying README section): swapping two rows' createdAt (and/or
 * sequenceNumber) does NOT require any change to buildMerkleTree's leaf
 * construction in packages/crypto. Every reorder tried breaks the
 * previousHash chain relative to whichever ordering column is used to
 * find "the immediately preceding row" — Part 1's per-record
 * isChainLinkIntact check (createdAt-based) and the new organisation-wide
 * verifyChainContinuity (sequenceNumber-based) each independently catch
 * it. No leaf-binding change was made to packages/crypto; this category
 * documents why one wasn't needed rather than adding one redundantly.
 */

async function swap(fieldA: { id: string }, fieldB: { id: string }, field: "createdAt" | "sequenceNumber", valueA: any, valueB: any) {
  if (field === "sequenceNumber") {
    // sequenceNumber is unique per (organisationId, sequenceNumber) — a
    // direct two-step swap would momentarily give both rows the SAME
    // value between the two updates and violate that constraint. Route
    // through a temporary out-of-range placeholder so no intermediate
    // state ever collides.
    await prisma.ledgerChain.update({ where: { id: fieldA.id }, data: { sequenceNumber: -1 } });
    await prisma.ledgerChain.update({ where: { id: fieldB.id }, data: { sequenceNumber: valueA } });
    await prisma.ledgerChain.update({ where: { id: fieldA.id }, data: { sequenceNumber: valueB } });
    return;
  }
  await prisma.ledgerChain.update({ where: { id: fieldA.id }, data: { [field]: valueB } });
  await prisma.ledgerChain.update({ where: { id: fieldB.id }, data: { [field]: valueA } });
}

async function eitherFailed(organisationId: string, ids: string[]) {
  const results = await Promise.all(ids.map((id) => verifyLedgerChainEntryById(id, organisationId)));
  const continuity = await verifyChainContinuity(organisationId);
  const anyPerRecordFailed = results.some((r) => r?.verdict === "failed");
  return {
    detected: anyPerRecordFailed || !continuity.intact,
    detail: `Per-record verdicts: ${results.map((r) => r?.verdict).join(", ")}. Continuity intact: ${continuity.intact}${continuity.gaps.length ? ` (${continuity.gaps.map((g) => g.type).join(", ")})` : ""}.`,
  };
}

export async function runReorderingCategory(): Promise<TrialResult[]> {
  const results: TrialResult[] = [];

  results.push(
    await (async () => {
      const ctx = await createTestOrganisation("d-1-adjacent-pending");
      try {
        return await runTrial("d-1", "(d-1) Swap createdAt of two adjacent rows in a 3-entry chain, pending", async () => {
          const a = await postJournalEntry(ctx, "A", 10);
          const b = await postJournalEntry(ctx, "B", 20);
          await postJournalEntry(ctx, "C", 30);
          await swap(a.chainEntry, b.chainEntry, "createdAt", a.chainEntry.createdAt, b.chainEntry.createdAt);
          return eitherFailed(ctx.organisationId, [a.chainEntry.id, b.chainEntry.id]);
        });
      } finally {
        await teardownOrganisation(ctx.organisationId);
      }
    })()
  );

  results.push(
    await (async () => {
      const ctx = await createTestOrganisation("d-2-adjacent-checkpointed");
      try {
        return await runTrial("d-2", "(d-2) Swap createdAt of two adjacent rows in a 3-entry chain, checkpointed", async () => {
          const a = await postJournalEntry(ctx, "A", 10);
          const b = await postJournalEntry(ctx, "B", 20);
          await postJournalEntry(ctx, "C", 30);
          await runCheckpoint();
          await swap(a.chainEntry, b.chainEntry, "createdAt", a.chainEntry.createdAt, b.chainEntry.createdAt);
          return eitherFailed(ctx.organisationId, [a.chainEntry.id, b.chainEntry.id]);
        });
      } finally {
        await teardownOrganisation(ctx.organisationId);
      }
    })()
  );

  results.push(
    await (async () => {
      const ctx = await createTestOrganisation("d-3-nonadjacent-pending");
      try {
        return await runTrial(
          "d-3",
          "(d-3) Swap createdAt of two non-adjacent rows (positions 1 and 5) in a 5-entry chain, pending",
          async () => {
            const posted = [];
            for (let i = 0; i < 5; i++) posted.push(await postJournalEntry(ctx, `Entry ${i + 1}`, 10 + i));
            const first = posted[0].chainEntry;
            const last = posted[4].chainEntry;
            await swap(first, last, "createdAt", first.createdAt, last.createdAt);
            return eitherFailed(ctx.organisationId, [first.id, last.id]);
          }
        );
      } finally {
        await teardownOrganisation(ctx.organisationId);
      }
    })()
  );

  results.push(
    await (async () => {
      const ctx = await createTestOrganisation("d-4-nonadjacent-checkpointed");
      try {
        return await runTrial(
          "d-4",
          "(d-4) Swap createdAt of two non-adjacent rows (positions 1 and 5) in a 5-entry chain, checkpointed",
          async () => {
            const posted = [];
            for (let i = 0; i < 5; i++) posted.push(await postJournalEntry(ctx, `Entry ${i + 1}`, 10 + i));
            await runCheckpoint();
            const first = posted[0].chainEntry;
            const last = posted[4].chainEntry;
            await swap(first, last, "createdAt", first.createdAt, last.createdAt);
            return eitherFailed(ctx.organisationId, [first.id, last.id]);
          }
        );
      } finally {
        await teardownOrganisation(ctx.organisationId);
      }
    })()
  );

  results.push(
    await (async () => {
      const ctx = await createTestOrganisation("d-5-full-swap");
      try {
        return await runTrial(
          "d-5",
          "(d-5) Swap BOTH createdAt and sequenceNumber of two adjacent rows (thorough attacker), pending",
          async () => {
            const a = await postJournalEntry(ctx, "A", 10);
            const b = await postJournalEntry(ctx, "B", 20);
            await postJournalEntry(ctx, "C", 30);
            await swap(a.chainEntry, b.chainEntry, "createdAt", a.chainEntry.createdAt, b.chainEntry.createdAt);
            await swap(a.chainEntry, b.chainEntry, "sequenceNumber", a.chainEntry.sequenceNumber, b.chainEntry.sequenceNumber);
            return eitherFailed(ctx.organisationId, [a.chainEntry.id, b.chainEntry.id]);
          }
        );
      } finally {
        await teardownOrganisation(ctx.organisationId);
      }
    })()
  );

  results.push(
    await (async () => {
      const ctx = await createTestOrganisation("d-6-three-cycle");
      try {
        return await runTrial(
          "d-6",
          "(d-6) Cyclically rotate three rows' createdAt (A→B's slot, B→C's slot, C→A's slot)",
          async () => {
            const a = await postJournalEntry(ctx, "A", 10);
            const b = await postJournalEntry(ctx, "B", 20);
            const c = await postJournalEntry(ctx, "C", 30);
            const [ca, cb, cc] = [a.chainEntry.createdAt, b.chainEntry.createdAt, c.chainEntry.createdAt];
            await prisma.ledgerChain.update({ where: { id: a.chainEntry.id }, data: { createdAt: cc } });
            await prisma.ledgerChain.update({ where: { id: b.chainEntry.id }, data: { createdAt: ca } });
            await prisma.ledgerChain.update({ where: { id: c.chainEntry.id }, data: { createdAt: cb } });
            return eitherFailed(ctx.organisationId, [a.chainEntry.id, b.chainEntry.id, c.chainEntry.id]);
          }
        );
      } finally {
        await teardownOrganisation(ctx.organisationId);
      }
    })()
  );

  return results;
}
