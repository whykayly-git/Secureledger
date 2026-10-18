const mockRunCreate = jest.fn();
const mockRunFindFirst = jest.fn();
const mockRunUpdate = jest.fn();

jest.mock("@secureledger/db", () => ({
  prisma: {
    verificationRun: {
      create: (...a: unknown[]) => mockRunCreate(...a),
      findFirst: (...a: unknown[]) => mockRunFindFirst(...a),
      update: (...a: unknown[]) => mockRunUpdate(...a),
    },
  },
}));

import {
  acknowledgeAlert,
  getAlertState,
  problemSignature,
  recordVerificationRun,
  summariseVerification,
  OrganisationVerification,
} from "../src/verifyAll";

const ORG = "org-1";
const at = new Date("2026-01-01T00:00:00.000Z");
const result = (chainId: string, verdict: "verified" | "failed" | "pending", failureReason?: string) => ({
  verdict,
  chainId,
  recordId: `rec-${chainId}`,
  recordType: "JOURNAL_ENTRY",
  createdAt: at,
  failureReason: failureReason ?? null,
});

beforeEach(() => {
  mockRunCreate.mockReset();
  mockRunFindFirst.mockReset();
  mockRunUpdate.mockReset();
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
      { chainId: "c", recordId: "rec-c", recordType: "JOURNAL_ENTRY", createdAt: at.toISOString(), failureReason: "hash_mismatch" },
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

const verification = (over: Partial<OrganisationVerification> = {}): OrganisationVerification => ({
  totalRecords: 10,
  checkedRecords: 10,
  truncated: false,
  counts: { verified: 9, pending: 0, failed: 1 },
  failures: [{ chainId: "c1", recordId: "r1", recordType: "JOURNAL_ENTRY", createdAt: at.toISOString(), failureReason: "hash_mismatch" }],
  continuity: { intact: true, totalRows: 10, gaps: [] },
  durationMs: 12,
  ...over,
});

describe("problemSignature", () => {
  it("is null when nothing was found", () => {
    expect(problemSignature(verification({ counts: { verified: 10, pending: 0, failed: 0 }, failures: [] }))).toBeNull();
  });

  it("is the same for the same findings in any order, and differs when the findings differ", () => {
    const f1 = { chainId: "c1", recordId: "r1", recordType: "JOURNAL_ENTRY", createdAt: "", failureReason: "hash_mismatch" };
    const f2 = { chainId: "c2", recordId: "r2", recordType: "INVOICE", createdAt: "", failureReason: "chain_link_broken" };
    const a = problemSignature(verification({ failures: [f1, f2] }));
    const b = problemSignature(verification({ failures: [f2, f1] }));
    const c = problemSignature(verification({ failures: [f1] }));
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it("counts chain gaps as findings", () => {
    const sig = problemSignature(
      verification({ failures: [], continuity: { intact: false, totalRows: 9, gaps: [{ type: "sequence_gap", chainId: "c5", detail: "x" }] } })
    );
    expect(sig).not.toBeNull();
  });
});

describe("recordVerificationRun", () => {
  it("stores the exact counts, the signature and capped details", async () => {
    mockRunCreate.mockResolvedValue({ id: "run-1" });
    await recordVerificationRun(ORG, "SCHEDULED", verification());

    const data = mockRunCreate.mock.calls[0][0].data;
    expect(data).toMatchObject({
      organisationId: ORG,
      source: "SCHEDULED",
      verifiedCount: 9,
      pendingCount: 0,
      failedCount: 1,
      continuityIntact: true,
      gapCount: 0,
    });
    expect(data.problemSignature).toMatch(/^[0-9a-f]{64}$/);
    expect(data.details.failures).toHaveLength(1);
  });

  it("keeps at most 100 failures in full while the count stays exact", async () => {
    mockRunCreate.mockResolvedValue({ id: "run-2" });
    const many = Array.from({ length: 250 }, (_, i) => ({
      chainId: `c${i}`, recordId: `r${i}`, recordType: "JOURNAL_ENTRY", createdAt: "", failureReason: "hash_mismatch",
    }));
    await recordVerificationRun(ORG, "MANUAL", verification({ counts: { verified: 0, pending: 0, failed: 250 }, failures: many }));

    const data = mockRunCreate.mock.calls[0][0].data;
    expect(data.failedCount).toBe(250);
    expect(data.details.failures).toHaveLength(100);
  });

  it("stores a clean run with no signature", async () => {
    mockRunCreate.mockResolvedValue({ id: "run-3" });
    await recordVerificationRun(ORG, "SCHEDULED", verification({ counts: { verified: 10, pending: 0, failed: 0 }, failures: [] }));
    expect(mockRunCreate.mock.calls[0][0].data.problemSignature).toBeNull();
  });
});

describe("getAlertState", () => {
  const latestRun = (over: Record<string, unknown> = {}) => ({ id: "run-9", problemSignature: "sig-A", acknowledgedAt: null, ...over });

  /** findFirst is called once for the latest run and, when it has problems, once for an acknowledged twin. */
  function install(latest: unknown, acknowledgedTwin: unknown) {
    mockRunFindFirst.mockImplementation((args: any) => (args.orderBy ? latest : acknowledgedTwin));
  }

  it("is not active when the organisation has never been verified", async () => {
    install(null, null);
    expect((await getAlertState(ORG)).active).toBe(false);
  });

  it("is not active when the latest run was clean", async () => {
    install(latestRun({ problemSignature: null }), null);
    expect((await getAlertState(ORG)).active).toBe(false);
  });

  it("is active for a latest run with problems that nobody has acknowledged", async () => {
    install(latestRun(), null);
    expect((await getAlertState(ORG)).active).toBe(true);
  });

  it("stays quiet when a run with the same findings was already acknowledged", async () => {
    install(latestRun(), { id: "run-old" });
    const state = await getAlertState(ORG);
    expect(state.active).toBe(false);
    expect(mockRunFindFirst.mock.calls[1][0].where.problemSignature).toBe("sig-A");
  });
});

describe("acknowledgeAlert", () => {
  it("marks the latest run as acknowledged by the user", async () => {
    let acknowledged = false;
    mockRunFindFirst.mockImplementation((args: any) =>
      args.orderBy ? { id: "run-9", problemSignature: "sig-A" } : acknowledged ? { id: "run-9" } : null
    );
    mockRunUpdate.mockImplementation(async () => { acknowledged = true; });

    const state = await acknowledgeAlert(ORG, "user-1");

    expect(mockRunUpdate).toHaveBeenCalledTimes(1);
    expect(mockRunUpdate.mock.calls[0][0]).toMatchObject({ where: { id: "run-9" }, data: { acknowledgedByUserId: "user-1" } });
    expect(state.active).toBe(false);
  });

  it("does nothing when there is no active alert", async () => {
    mockRunFindFirst.mockImplementation((args: any) => (args.orderBy ? { id: "run-1", problemSignature: null } : null));
    await acknowledgeAlert(ORG, "user-1");
    expect(mockRunUpdate).not.toHaveBeenCalled();
  });
});
