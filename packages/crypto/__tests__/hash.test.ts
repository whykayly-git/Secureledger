import { computeChainHash, sha256Hex } from "../src/hash";

describe("sha256Hex", () => {
  it("produces a 64-char lowercase hex digest", () => {
    const digest = sha256Hex("hello world");
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic for identical input", () => {
    expect(sha256Hex("abc")).toBe(sha256Hex("abc"));
  });

  it("matches the standard SHA-256 test vector for the empty string", () => {
    expect(sha256Hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });

  it("matches the standard SHA-256 test vector for 'abc'", () => {
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("produces different digests for different inputs", () => {
    expect(sha256Hex("input-a")).not.toBe(sha256Hex("input-b"));
  });
});

describe("computeChainHash", () => {
  it("is deterministic regardless of key insertion order", () => {
    const a = computeChainHash({ amount: 100, description: "rent" }, null);
    const b = computeChainHash({ description: "rent", amount: 100 }, null);
    expect(a).toBe(b);
  });

  it("changes when the previous hash changes (chain linkage)", () => {
    const fields = { amount: 100, description: "rent" };
    const h1 = computeChainHash(fields, null);
    const h2 = computeChainHash(fields, "some-previous-hash");
    expect(h1).not.toBe(h2);
  });

  it("changes when any field value changes", () => {
    const h1 = computeChainHash({ amount: 100 }, null);
    const h2 = computeChainHash({ amount: 101 }, null);
    expect(h1).not.toBe(h2);
  });

  it("treats undefined fields as absent, matching a record without the key", () => {
    const h1 = computeChainHash({ amount: 100, note: undefined }, null);
    const h2 = computeChainHash({ amount: 100 }, null);
    expect(h1).toBe(h2);
  });

  it("builds a valid hash chain across successive records", () => {
    const genesisHash = computeChainHash({ seq: 1 }, null);
    const secondHash = computeChainHash({ seq: 2 }, genesisHash);
    const thirdHash = computeChainHash({ seq: 3 }, secondHash);

    expect(genesisHash).not.toBe(secondHash);
    expect(secondHash).not.toBe(thirdHash);

    // Tampering with an earlier record changes downstream expectations —
    // recomputing with the original seq=1 payload must reproduce genesisHash.
    expect(computeChainHash({ seq: 1 }, null)).toBe(genesisHash);
  });

  it("is deterministic for two genesis (previousHash === null) records with identical fields", () => {
    const a = computeChainHash({ amount: 100 }, null);
    const b = computeChainHash({ amount: 100 }, null);
    expect(a).toBe(b);
  });

  it("distinguishes values by type, not just by value (100 !== '100')", () => {
    const numeric = computeChainHash({ amount: 100 }, null);
    const stringy = computeChainHash({ amount: "100" }, null);
    expect(numeric).not.toBe(stringy);
  });

  it("treats array element order as significant (journal lines are ordered)", () => {
    const a = computeChainHash({ lines: [{ id: "1" }, { id: "2" }] }, null);
    const b = computeChainHash({ lines: [{ id: "2" }, { id: "1" }] }, null);
    expect(a).not.toBe(b);
  });

  it("is unaffected by nested object key order (deep canonicalization)", () => {
    const a = computeChainHash({ line: { accountId: "acc-1", debit: 100, credit: 0 } }, null);
    const b = computeChainHash({ line: { credit: 0, debit: 100, accountId: "acc-1" } }, null);
    expect(a).toBe(b);
  });

  it("serializes two Date instances representing the same instant identically", () => {
    const a = computeChainHash({ date: new Date("2026-01-01T00:00:00.000Z") }, null);
    const b = computeChainHash({ date: new Date(Date.UTC(2026, 0, 1, 0, 0, 0, 0)) }, null);
    expect(a).toBe(b);
  });

  it("produces a different hash for different Date instants", () => {
    const a = computeChainHash({ date: new Date("2026-01-01T00:00:00.000Z") }, null);
    const b = computeChainHash({ date: new Date("2026-01-02T00:00:00.000Z") }, null);
    expect(a).not.toBe(b);
  });

  it("always returns a 64-char lowercase hex digest regardless of input shape", () => {
    const result = computeChainHash({ a: 1, b: { c: [1, 2, 3] }, d: "text" }, "some-previous-hash");
    expect(result).toMatch(/^[0-9a-f]{64}$/);
  });
});
