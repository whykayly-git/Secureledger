// One-off helper: applies a migration.sql file's statements individually via
// the Prisma query engine, since prisma migrate/db push hit PGlite-specific
// wire-protocol incompatibilities in this project's local dev database.
// Not used in Docker/production, where `prisma migrate deploy` runs normally
// against real PostgreSQL. See root README for details.
const fs = require("fs");
const path = require("path");
const { PrismaClient } = require("./generated/client");

async function main() {
  const migrationFile = process.argv[2];
  if (!migrationFile) {
    console.error("Usage: node apply-migration.js <path-to-migration.sql>");
    process.exit(1);
  }
  const sql = fs.readFileSync(path.resolve(migrationFile), "utf8");
  const statements = sql
    .split(/;\s*\n/)
    .map((s) =>
      s
        .split("\n")
        .filter((line) => !line.trim().startsWith("--"))
        .join("\n")
        .trim()
    )
    .filter((s) => s.length > 0);

  const prisma = new PrismaClient();
  for (const statement of statements) {
    console.log(`Executing: ${statement.slice(0, 80).replace(/\n/g, " ")}...`);
    await prisma.$executeRawUnsafe(statement);
  }
  await prisma.$disconnect();
  console.log(`Applied ${statements.length} statements from ${migrationFile}`);
}

main().catch((err) => {
  console.error("Migration failed:", err.message);
  process.exit(1);
});
