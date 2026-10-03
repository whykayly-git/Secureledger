import { ForbiddenError } from "./session";
import type { SessionClaims } from "./auth";

/**
 * Platform admins are an env-configured allowlist (PLATFORM_ADMIN_EMAILS,
 * comma-separated), deliberately NOT a database flag: there is then no UI,
 * API, or stolen org-admin account that can grant platform-level access.
 * The allowlist is re-read on every call, so removing an email revokes
 * access immediately, even for sessions that are still logged in.
 */
export function isPlatformAdminEmail(email: string | undefined | null): boolean {
  if (!email) return false;
  const allowed = (process.env.PLATFORM_ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return allowed.includes(email.trim().toLowerCase());
}

export function requirePlatformAdmin(session: SessionClaims): void {
  if (!isPlatformAdminEmail(session.email)) {
    throw new ForbiddenError("Requires platform admin access");
  }
}
