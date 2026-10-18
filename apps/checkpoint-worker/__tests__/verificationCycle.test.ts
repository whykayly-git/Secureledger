jest.mock("@secureledger/verification", () => ({
  MAX_VERIFY_ALL_RECORDS: 5000,
  verifyOrganisation: jest.fn(),
  recordVerificationRun: jest.fn(),
}));

import { runVerificationCycle } from "../src/verificationCycle";

const HOUR = 60 * 60 * 1000;
const NOW = new Date("2026-06-01T12:00:00.000Z");

const clean = (over: Record<string, unknown> = {}) => ({
  totalRecords: 4,
  checkedRecords: 4,
  truncated: false,
  counts: { verified: 4, pending: 0, failed: 0 },
  failures: [],
  continuity: { intact: true, totalRows: 4, gaps: [] },
  durationMs: 5,
  ...over,
});

type Org = { id: string; lastRunAt?: Date; chainRows?: number; checkpoints?: number };

function fakePrisma(orgs: Org[]) {
  const byId = new Map(orgs.map((o) => [o.id, o]));
  return {
    organisation: { findMany: jest.fn().mockResolvedValue(orgs.map((o) => ({ id: o.id }))) },
    verificationRun: {
      findFirst: jest.fn(async (args: any) => {
        const o = byId.get(args.where.organisationId)!;
        return o.lastRunAt ? { createdAt: o.lastRunAt } : null;
      }),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    ledgerChain: { count: jest.fn(async (args: any) => byId.get(args.where.organisationId)!.chainRows ?? 3) },
    ledgerCheckpoint: { count: jest.fn(async (args: any) => byId.get(args.where.organisationId)!.checkpoints ?? 1) },
  } as any;
}

let errorSpy: jest.SpyInstance;
beforeEach(() => {
  jest.spyOn(console, "log").mockImplementation(() => undefined);
  errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

describe("runVerificationCycle", () => {
  it("verifies and records an organisation that has never had a scheduled run", async () => {
    const verify = jest.fn().mockResolvedValue(clean());
    const record = jest.fn().mockResolvedValue({});
    const n = await runVerificationCycle(fakePrisma([{ id: "a" }]), { intervalMs: HOUR, now: NOW, verify, record });

    expect(n).toBe(1);
    expect(verify).toHaveBeenCalledWith("a", 5000);
    expect(record).toHaveBeenCalledWith("a", expect.objectContaining({ checkedRecords: 4 }));
  });

  it("skips an organisation whose last scheduled run is newer than the interval", async () => {
    const verify = jest.fn().mockResolvedValue(clean());
    const lastRunAt = new Date(NOW.getTime() - HOUR / 2);
    const n = await runVerificationCycle(fakePrisma([{ id: "a", lastRunAt }]), { intervalMs: HOUR, now: NOW, verify, record: jest.fn() });

    expect(n).toBe(0);
    expect(verify).not.toHaveBeenCalled();
  });

  it("runs again once the interval has passed", async () => {
    const verify = jest.fn().mockResolvedValue(clean());
    const lastRunAt = new Date(NOW.getTime() - HOUR - 1);
    const n = await runVerificationCycle(fakePrisma([{ id: "a", lastRunAt }]), { intervalMs: HOUR, now: NOW, verify, record: jest.fn() });

    expect(n).toBe(1);
  });

  it("skips an organisation with no chain rows and no checkpoints", async () => {
    const verify = jest.fn().mockResolvedValue(clean());
    const n = await runVerificationCycle(fakePrisma([{ id: "empty", chainRows: 0, checkpoints: 0 }]), {
      intervalMs: HOUR, now: NOW, verify, record: jest.fn(),
    });

    expect(n).toBe(0);
    expect(verify).not.toHaveBeenCalled();
  });

  it("still verifies an organisation whose chain rows were all deleted but that has checkpoints", async () => {
    const verify = jest.fn().mockResolvedValue(clean());
    const n = await runVerificationCycle(fakePrisma([{ id: "wiped", chainRows: 0, checkpoints: 2 }]), {
      intervalMs: HOUR, now: NOW, verify, record: jest.fn(),
    });

    expect(n).toBe(1);
  });

  it("does nothing at all when the interval is 0 (scheduling off)", async () => {
    const prisma = fakePrisma([{ id: "a" }]);
    const n = await runVerificationCycle(prisma, { intervalMs: 0, now: NOW, verify: jest.fn(), record: jest.fn() });

    expect(n).toBe(0);
    expect(prisma.organisation.findMany).not.toHaveBeenCalled();
  });

  it("logs an ALERT when a run finds failed records or chain gaps", async () => {
    const verify = jest.fn().mockResolvedValue(
      clean({ counts: { verified: 3, pending: 0, failed: 1 }, failures: [{ chainId: "c" }] })
    );
    await runVerificationCycle(fakePrisma([{ id: "a" }]), { intervalMs: HOUR, now: NOW, verify, record: jest.fn() });

    expect(errorSpy.mock.calls.some((c) => String(c[0]).includes("ALERT"))).toBe(true);
  });

  it("does not log an alert for a clean run", async () => {
    await runVerificationCycle(fakePrisma([{ id: "a" }]), { intervalMs: HOUR, now: NOW, verify: jest.fn().mockResolvedValue(clean()), record: jest.fn() });
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("carries on with the other organisations when one fails", async () => {
    const verify = jest.fn(async (id: string) => {
      if (id === "bad") throw new Error("boom");
      return clean();
    });
    const record = jest.fn().mockResolvedValue({});
    const n = await runVerificationCycle(fakePrisma([{ id: "bad" }, { id: "good" }]), { intervalMs: HOUR, now: NOW, verify, record });

    expect(n).toBe(1);
    expect(record).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenCalledWith("good", expect.anything());
    expect(errorSpy.mock.calls.some((c) => String(c[0]).includes("failed for organisation"))).toBe(true);
  });
});
