import { summariseVerification } from "../lib/verifyAll";

const at = new Date("2026-01-01T00:00:00.000Z");
const result = (chainId: string, verdict: "verified" | "failed" | "pending", failureReason?: string) => ({
  verdict,
  chainId,
  recordId: `rec-${chainId}`,
  recordType: "JOURNAL_ENTRY",
  createdAt: at,
  failureReason: failureReason ?? null,
});

describe("summariseVerification", () => {
  it("counts each verdict and lists only the failures", async () => {
    const verdicts: Record<string, ReturnType<typeof result>> = {
      a: result("a", "verified"),
      b: result("b", "pending"),
      c: result("c", "failed", "hash_mismatch"),
      d: result("d", "verified"),
    };
    const summary = await summariseVerification(["a", "b", "c", "d"], async (id) => verdicts[id]);

    expect(summary.counts).toEqual({ verified: 2, pending: 1, failed: 1 });
    expect(summary.failures).toEqual([
      {
        chainId: "c",
        recordId: "rec-c",
        recordType: "JOURNAL_ENTRY",
        createdAt: at.toISOString(),
        failureReason: "hash_mismatch",
      },
    ]);
  });

  it("returns zero counts and no failures for an empty ledger", async () => {
    const summary = await summariseVerification([], async () => null);
    expect(summary).toEqual({ counts: { verified: 0, pending: 0, failed: 0 }, failures: [] });
  });

  it("counts a verification that throws as a failure instead of dropping it", async () => {
    const summary = await summariseVerification(["x", "y"], async (id) => {
      if (id === "x") throw new Error("checkpoint missing");
      return result("y", "verified");
    });

    expect(summary.counts).toEqual({ verified: 1, pending: 0, failed: 1 });
    expect(summary.failures[0]).toMatchObject({ chainId: "x", failureReason: "verification_error" });
  });

  it("ignores a row that no longer exists", async () => {
    const summary = await summariseVerification(["gone"], async () => null);
    expect(summary.counts).toEqual({ verified: 0, pending: 0, failed: 0 });
  });

  it("verifies the rows one at a time, in the order given", async () => {
    const order: string[] = [];
    await summariseVerification(["1", "2", "3"], async (id) => {
      order.push(id);
      return result(id, "verified");
    });
    expect(order).toEqual(["1", "2", "3"]);
  });
});
