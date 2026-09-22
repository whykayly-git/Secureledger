/**
 * Kept dependency-free (no jsonwebtoken/bcryptjs) so it can be safely
 * imported from the edge-runtime middleware without pulling Node-only
 * crypto libraries into that bundle.
 */
export const AUTH_COOKIE_NAME = "secureledger_session";
