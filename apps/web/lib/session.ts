import { cookies } from "next/headers";
import { AUTH_COOKIE_NAME, SessionClaims, verifySessionToken } from "./auth";

/** Stateless session read: verifies the JWT from the httpOnly cookie, no DB/session-store lookup. */
export function getSession(): SessionClaims | null {
  const token = cookies().get(AUTH_COOKIE_NAME)?.value;
  if (!token) return null;
  return verifySessionToken(token);
}

export class UnauthorizedError extends Error {
  status = 401;
}

export class ForbiddenError extends Error {
  status = 403;
}

export function requireSession(): SessionClaims {
  const session = getSession();
  if (!session) throw new UnauthorizedError("Not authenticated");
  return session;
}

export function requireRole(session: SessionClaims, ...roles: SessionClaims["role"][]): void {
  if (!roles.includes(session.role)) {
    throw new ForbiddenError(`Requires role: ${roles.join(" or ")}`);
  }
}

/** Manage Staff is gated on the isOrgAdmin flag, not on `role` — any accounting role can also be an org admin. */
export function requireOrgAdmin(session: SessionClaims): void {
  if (!session.isOrgAdmin) {
    throw new ForbiddenError("Requires organisation admin access");
  }
}
