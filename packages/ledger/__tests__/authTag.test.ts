import { computeChainAuthTag } from "@secureledger/crypto";
import { getLedgerAuthKey, getLedgerAuthStart, judgeChainRow, signChainRow } from "../src";

const KEY = "ledger-auth-key-for-tests-0123456789abcdef";
const base = { organisationId: "org-1", recordType: "JOURNAL_ENTRY", recordId: "rec-1", sequenceNumber: 5, hash: "ab12" };
const created = new Date("2026-10-20T12:00:00Z");
const tagged = (over = {}) => ({ ...base, createdAt: created, authTag: computeChainAuthTag(KEY, { ...base, ...over }), ...over });

const original = { key: process.env.LEDGER_AUTH_KEY, env: process.env.NODE_ENV, start: process.env.LEDGER_AUTH_START };
afterEach(() => {
  if (original.key === undefined) delete process.env.LEDGER_AUTH_KEY;
  else process.env.LEDGER_AUTH_KEY = original.key;
  (process.env as Record<string, string | undefined>).NODE_ENV = original.env;
  if (original.start === undefined) delete process.env.LEDGER_AUTH_START;
  else process.env.LEDGER_AUTH_START = original.start;
});

describe("getLedgerAuthKey", () => {
  it("returns null outside production when no key is set", () => {
    delete process.env.LEDGER_AUTH_KEY;
    expect(getLedgerAuthKey()).toBeNull();
    expect(signChainRow(base)).toBeNull();
  });

  it("refuses to run in production without a key", () => {
    delete process.env.LEDGER_AUTH_KEY;
    (process.env as Record<string, string>).NODE_ENV = "production";
    expect(() => getLedgerAuthKey()).toThrow(/required in production/);
  });

  it("rejects a key that is too short", () => {
    process.env.LEDGER_AUTH_KEY = "short";
    expect(() => getLedgerAuthKey()).toThrow(/at least 32/);
  });
});

describe("getLedgerAuthStart", () => {
  it("is null when unset and parses an ISO date", () => {
    delete process.env.LEDGER_AUTH_START;
    expect(getLedgerAuthStart()).toBeNull();
    process.env.LEDGER_AUTH_START = "2026-10-19T00:00:00Z";
    expect(getLedgerAuthStart()?.toISOString()).toBe("2026-10-19T00:00:00.000Z");
  });

  it("rejects a value that is not a date", () => {
    process.env.LEDGER_AUTH_START = "yesterday";
    expect(() => getLedgerAuthStart()).toThrow(/ISO date/);
  });
});

describe("judgeChainRow", () => {
  beforeEach(() => {
    process.env.LEDGER_AUTH_KEY = KEY;
    delete process.env.LEDGER_AUTH_START;
  });

  it("accepts a correctly tagged row", () => {
    expect(judgeChainRow(tagged())).toBe("authentic");
  });

  it("rejects a row with the wrong tag", () => {
    expect(judgeChainRow({ ...base, createdAt: created, authTag: "0".repeat(64) })).toBe("invalid");
  });

  it("rejects a tag that belongs to a different sequence number", () => {
    expect(judgeChainRow({ ...tagged(), sequenceNumber: 6 })).toBe("invalid");
  });

  it("rejects an untagged row when no legacy cut-off is configured", () => {
    expect(judgeChainRow({ ...base, createdAt: created, authTag: null })).toBe("missing");
  });

  it("accepts an untagged row created before the cut-off as legacy", () => {
    process.env.LEDGER_AUTH_START = "2026-10-21T00:00:00Z";
    expect(judgeChainRow({ ...base, createdAt: created, authTag: null })).toBe("legacy");
  });

  it("rejects an untagged row created after the cut-off", () => {
    process.env.LEDGER_AUTH_START = "2026-10-19T00:00:00Z";
    expect(judgeChainRow({ ...base, createdAt: created, authTag: null })).toBe("missing");
  });

  it("still checks a tagged row that was created before the cut-off", () => {
    process.env.LEDGER_AUTH_START = "2026-10-21T00:00:00Z";
    expect(judgeChainRow({ ...base, createdAt: created, authTag: "0".repeat(64) })).toBe("invalid");
  });

  it("cannot check rows when no key is configured", () => {
    delete process.env.LEDGER_AUTH_KEY;
    expect(judgeChainRow(tagged())).toBe("unchecked");
  });
});
