import { PrismaClient } from "../generated/client";

export * from "../generated/client";

declare global {
  // eslint-disable-next-line no-var
  var __secureledgerPrisma: PrismaClient | undefined;
}

// Single shared client. Reused across hot reloads in dev (Next.js) and
// instantiated once per process in the checkpoint worker.
export const prisma: PrismaClient =
  global.__secureledgerPrisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  global.__secureledgerPrisma = prisma;
}
