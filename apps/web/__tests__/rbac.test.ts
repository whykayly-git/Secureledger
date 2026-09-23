import { AUTH_COOKIE_NAME, SessionClaims, signSessionToken } from "../lib/auth";

const mockCookieGet = jest.fn();

jest.mock("next/headers", () => ({
  cookies: () => ({ get: mockCookieGet }),
}));

// Imported after the mock is registered so getSession/requireSession pick
// up the mocked next/headers module.
import { getSession, requireSession, requireRole, requireOrgAdmin, UnauthorizedError, ForbiddenError } from "../lib/session";

const claims: SessionClaims = {
  userId: "user-1",
  organisationId: "org-1",
  role: "ACCOUNTANT",
  email: "ada@example.com",
  isOrgAdmin: false,
};

beforeEach(() => {
  mockCookieGet.mockReset();
});

describe("getSession", () => {
  it("returns null when no session cookie is present", () => {
    mockCookieGet.mockReturnValue(undefined);
    expect(getSession()).toBeNull();
  });

  it("returns the decoded claims when a valid session cookie is present", () => {
    const token = signSessionToken(claims);
    mockCookieGet.mockReturnValue({ value: token });
    expect(getSession()).toMatchObject(claims);
  });

  it("returns null when the cookie value is not a valid JWT", () => {
    mockCookieGet.mockReturnValue({ value: "garbage-not-a-jwt" });
    expect(getSession()).toBeNull();
  });

  it("reads the cookie by the correct cookie name", () => {
    mockCookieGet.mockReturnValue(undefined);
    getSession();
    expect(mockCookieGet).toHaveBeenCalledWith(AUTH_COOKIE_NAME);
  });
});

describe("requireSession", () => {
  it("returns the session claims when authenticated", () => {
    const token = signSessionToken(claims);
    mockCookieGet.mockReturnValue({ value: token });
    expect(requireSession()).toMatchObject(claims);
  });

  it("throws UnauthorizedError when there is no session", () => {
    mockCookieGet.mockReturnValue(undefined);
    expect(() => requireSession()).toThrow(UnauthorizedError);
  });

  it("throws an error carrying HTTP status 401 when unauthenticated", () => {
    mockCookieGet.mockReturnValue(undefined);
    try {
      requireSession();
      throw new Error("expected requireSession to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(UnauthorizedError);
      expect((err as UnauthorizedError).status).toBe(401);
    }
  });

  it("throws UnauthorizedError when the cookie holds an invalid token", () => {
    mockCookieGet.mockReturnValue({ value: "not-a-real-token" });
    expect(() => requireSession()).toThrow(UnauthorizedError);
  });
});

describe("requireRole", () => {
  it("does not throw when the session's role is in the allowed list", () => {
    expect(() => requireRole(claims, "ACCOUNTANT")).not.toThrow();
  });

  it("does not throw when the session's role matches one of several allowed roles", () => {
    expect(() => requireRole(claims, "BOOKKEEPER", "ACCOUNTANT", "AUDITOR")).not.toThrow();
  });

  it("throws ForbiddenError when the session's role is not in the allowed list", () => {
    expect(() => requireRole(claims, "AUDITOR")).toThrow(ForbiddenError);
  });

  it("throws an error carrying HTTP status 403 when unauthorised", () => {
    try {
      requireRole(claims, "AUDITOR");
      throw new Error("expected requireRole to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(ForbiddenError);
      expect((err as ForbiddenError).status).toBe(403);
    }
  });

  it("enforces auditor-only actions: a BOOKKEEPER cannot perform an AUDITOR-only action", () => {
    const bookkeeperClaims: SessionClaims = { ...claims, role: "BOOKKEEPER" };
    expect(() => requireRole(bookkeeperClaims, "AUDITOR")).toThrow(ForbiddenError);
  });

  it("allows an AUDITOR to perform an AUDITOR-only action", () => {
    const auditorClaims: SessionClaims = { ...claims, role: "AUDITOR" };
    expect(() => requireRole(auditorClaims, "AUDITOR")).not.toThrow();
  });
});

describe("requireOrgAdmin", () => {
  it("does not throw when the session is an organisation admin", () => {
    const adminClaims: SessionClaims = { ...claims, isOrgAdmin: true };
    expect(() => requireOrgAdmin(adminClaims)).not.toThrow();
  });

  it("throws ForbiddenError when the session is not an organisation admin", () => {
    expect(() => requireOrgAdmin(claims)).toThrow(ForbiddenError);
  });

  it("is independent of `role` — an AUDITOR without isOrgAdmin is still rejected", () => {
    const auditorClaims: SessionClaims = { ...claims, role: "AUDITOR", isOrgAdmin: false };
    expect(() => requireOrgAdmin(auditorClaims)).toThrow(ForbiddenError);
  });
});
