import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import type { Role } from "@secureledger/db";

export { AUTH_COOKIE_NAME } from "./constants";

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error("Missing required environment variable: JWT_SECRET");
}

export type SessionClaims = {
  userId: string;
  organisationId: string;
  role: Role;
  email: string;
  isOrgAdmin: boolean;
};

export async function hashPassword(plaintext: string): Promise<string> {
  return bcrypt.hash(plaintext, 12);
}

export async function verifyPassword(plaintext: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plaintext, hash);
}

export function signSessionToken(claims: SessionClaims): string {
  return jwt.sign(claims, JWT_SECRET as string, { expiresIn: "12h" });
}

export function verifySessionToken(token: string): SessionClaims | null {
  try {
    return jwt.verify(token, JWT_SECRET as string) as SessionClaims;
  } catch {
    return null;
  }
}
