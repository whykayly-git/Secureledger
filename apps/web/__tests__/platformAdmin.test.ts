import { isPlatformAdminEmail, requirePlatformAdmin } from "../lib/platformAdmin";
import { ForbiddenError } from "../lib/session";
import type { SessionClaims } from "../lib/auth";

const claims: SessionClaims = {
  userId: "u1",
  organisationId: "o1",
  role: "AUDITOR",
  email: "root@example.com",
  isOrgAdmin: true,
};

const original = process.env.PLATFORM_ADMIN_EMAILS;
afterEach(() => {
  if (original === undefined) delete process.env.PLATFORM_ADMIN_EMAILS;
  else process.env.PLATFORM_ADMIN_EMAILS = original;
});

describe("isPlatformAdminEmail", () => {
  it("is false for everyone when the allowlist is unset", () => {
    delete process.env.PLATFORM_ADMIN_EMAILS;
    expect(isPlatformAdminEmail("root@example.com")).toBe(false);
  });

  it("matches case-insensitively and ignores surrounding whitespace", () => {
    process.env.PLATFORM_ADMIN_EMAILS = " Root@Example.com , other@example.com";
    expect(isPlatformAdminEmail("root@example.com")).toBe(true);
    expect(isPlatformAdminEmail("OTHER@example.COM")).toBe(true);
    expect(isPlatformAdminEmail("nobody@example.com")).toBe(false);
  });

  it("rejects empty and missing emails even with an empty allowlist entry", () => {
    process.env.PLATFORM_ADMIN_EMAILS = ",,";
    expect(isPlatformAdminEmail("")).toBe(false);
    expect(isPlatformAdminEmail(undefined)).toBe(false);
  });
});

describe("requirePlatformAdmin", () => {
  it("passes for an allowlisted session and throws ForbiddenError (403) otherwise", () => {
    process.env.PLATFORM_ADMIN_EMAILS = "root@example.com";
    expect(() => requirePlatformAdmin(claims)).not.toThrow();
    try {
      requirePlatformAdmin({ ...claims, email: "intruder@example.com" });
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(ForbiddenError);
      expect((err as ForbiddenError).status).toBe(403);
    }
  });

  it("does not trust org-admin or role claims as a substitute", () => {
    delete process.env.PLATFORM_ADMIN_EMAILS;
    expect(() => requirePlatformAdmin({ ...claims, role: "AUDITOR", isOrgAdmin: true })).toThrow(ForbiddenError);
  });
});
