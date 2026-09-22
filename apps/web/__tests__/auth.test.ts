import jwt from "jsonwebtoken";
import { hashPassword, verifyPassword, signSessionToken, verifySessionToken, SessionClaims } from "../lib/auth";

const claims: SessionClaims = {
  userId: "user-1",
  organisationId: "org-1",
  role: "ACCOUNTANT",
  email: "ada@example.com",
};

describe("hashPassword / verifyPassword", () => {
  it("produces a hash that is not the plaintext password", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(hash).not.toBe("correct horse battery staple");
  });

  it("produces a bcrypt-formatted hash", async () => {
    const hash = await hashPassword("password123");
    expect(hash).toMatch(/^\$2[aby]\$\d{2}\$/);
  });

  it("produces a different hash each time for the same password (random salt)", async () => {
    const a = await hashPassword("password123");
    const b = await hashPassword("password123");
    expect(a).not.toBe(b);
  });

  it("verifies a correct password against its own hash", async () => {
    const hash = await hashPassword("password123");
    expect(await verifyPassword("password123", hash)).toBe(true);
  });

  it("rejects an incorrect password against a hash", async () => {
    const hash = await hashPassword("password123");
    expect(await verifyPassword("wrong-password", hash)).toBe(false);
  });

  it("rejects a password against a hash of a different password", async () => {
    const hashA = await hashPassword("password-A");
    expect(await verifyPassword("password-A", hashA)).toBe(true);
    expect(await verifyPassword("password-B", hashA)).toBe(false);
  });

  it("is case-sensitive", async () => {
    const hash = await hashPassword("Password123");
    expect(await verifyPassword("password123", hash)).toBe(false);
  });
});

describe("signSessionToken / verifySessionToken", () => {
  it("round-trips claims through sign then verify", () => {
    const token = signSessionToken(claims);
    const result = verifySessionToken(token);
    expect(result).toMatchObject(claims);
  });

  it("produces a JWT with three dot-separated segments", () => {
    const token = signSessionToken(claims);
    expect(token.split(".")).toHaveLength(3);
  });

  it("returns null for a malformed token", () => {
    expect(verifySessionToken("not-a-real-token")).toBeNull();
  });

  it("returns null for an empty string", () => {
    expect(verifySessionToken("")).toBeNull();
  });

  it("returns null for a token signed with a different secret (forged token)", () => {
    const forged = jwt.sign(claims, "a-different-secret-the-attacker-controls", { expiresIn: "12h" });
    expect(verifySessionToken(forged)).toBeNull();
  });

  it("returns null for an already-expired token", () => {
    const expired = jwt.sign(claims, process.env.JWT_SECRET as string, { expiresIn: -10 });
    expect(verifySessionToken(expired)).toBeNull();
  });

  it("sets an expiry roughly 12 hours after issue", () => {
    const token = signSessionToken(claims);
    const decoded = jwt.decode(token) as { iat: number; exp: number };
    const diffSeconds = decoded.exp - decoded.iat;
    expect(diffSeconds).toBe(12 * 60 * 60);
  });

  it("preserves the role claim exactly, distinguishing between roles", () => {
    const auditorToken = signSessionToken({ ...claims, role: "AUDITOR" });
    const result = verifySessionToken(auditorToken);
    expect(result?.role).toBe("AUDITOR");
    expect(result?.role).not.toBe("ACCOUNTANT");
  });

  it("does not accept a token that has been truncated (tampered signature)", () => {
    const token = signSessionToken(claims);
    const tampered = token.slice(0, token.length - 5);
    expect(verifySessionToken(tampered)).toBeNull();
  });
});
