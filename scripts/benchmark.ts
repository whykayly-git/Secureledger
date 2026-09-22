/**
 * SecureLedger performance benchmark.
 *
 * Requires a running instance (app + database) — see README.md. Posts a
 * configurable number of journal entries, then runs a configurable number
 * of verification requests, computing mean and p95 latency for both, plus
 * one deliberately CONCURRENT run (multiple simulated organisations
 * posting simultaneously) so the reported hash-chaining latency reflects
 * real lock-contention behavior under the advisory lock
 * (packages/ledger/src/hashChain.ts), not just a single-threaded best case.
 *
 * Reports actual measured numbers against the stated requirements —
 * including if a target is missed. Nothing here adjusts application logic
 * to hit numbers artificially.
 *
 * Usage:
 *   npm run benchmark
 *   npm run benchmark -- --entries=100 --verifications=100 --orgs=8 --postsPerOrg=6
 */

const BASE_URL = process.env.BENCHMARK_BASE_URL ?? "http://localhost:3000";

type Args = {
  entries: number;
  verifications: number;
  orgs: number;
  postsPerOrg: number;
  checkpointWaitMs: number;
};

function parseArgs(): Args {
  const argMap = new Map<string, string>();
  for (const arg of process.argv.slice(2)) {
    const match = arg.match(/^--([a-zA-Z]+)=(.+)$/);
    if (match) argMap.set(match[1], match[2]);
  }
  return {
    entries: Number(argMap.get("entries") ?? 50),
    verifications: Number(argMap.get("verifications") ?? 50),
    orgs: Number(argMap.get("orgs") ?? 5),
    postsPerOrg: Number(argMap.get("postsPerOrg") ?? 5),
    checkpointWaitMs: Number(argMap.get("checkpointWaitMs") ?? 45_000),
  };
}

type Session = {
  cookie: string;
  cashAccountId: string;
  expenseAccountId: string;
};

async function registerOrg(label: string): Promise<Session> {
  const email = `bench-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.com`;
  const res = await fetch(`${BASE_URL}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      organisationName: `Benchmark Org ${label}`,
      name: "Benchmark Runner",
      email,
      password: "benchmark-password-123",
    }),
  });
  if (!res.ok) throw new Error(`registerOrg(${label}) failed: ${res.status} ${await res.text()}`);
  const cookie = res.headers.get("set-cookie");
  if (!cookie) throw new Error("registerOrg: no session cookie returned");
  const sessionCookie = cookie.split(";")[0];

  const cashRes = await fetch(`${BASE_URL}/api/accounts`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: sessionCookie },
    body: JSON.stringify({ name: "Cash", type: "ASSET", code: `1000-${label}` }),
  });
  const expenseRes = await fetch(`${BASE_URL}/api/accounts`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: sessionCookie },
    body: JSON.stringify({ name: "Expenses", type: "EXPENSE", code: `5000-${label}` }),
  });
  const cash = (await cashRes.json()) as { account: { id: string } };
  const expense = (await expenseRes.json()) as { account: { id: string } };

  return { cookie: sessionCookie, cashAccountId: cash.account.id, expenseAccountId: expense.account.id };
}

type PostResult = { totalMs: number; hashChainMs: number | null; journalEntryId: string };

async function postJournalEntry(session: Session, description: string): Promise<PostResult> {
  const start = performance.now();
  const res = await fetch(`${BASE_URL}/api/journal-entries`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: session.cookie },
    body: JSON.stringify({
      date: new Date().toISOString().slice(0, 10),
      description,
      lines: [
        { accountId: session.expenseAccountId, debit: 10, credit: 0 },
        { accountId: session.cashAccountId, debit: 0, credit: 10 },
      ],
    }),
  });
  const totalMs = performance.now() - start;
  if (!res.ok) throw new Error(`postJournalEntry failed: ${res.status} ${await res.text()}`);
  const hashChainHeader = res.headers.get("x-hash-chain-latency-ms");
  const json = (await res.json()) as { journalEntry: { id: string } };
  return { totalMs, hashChainMs: hashChainHeader ? Number(hashChainHeader) : null, journalEntryId: json.journalEntry.id };
}

type VerifyResult = { totalMs: number; serverMs: number | null; verdict: string };

async function verifyRecord(session: Session, recordId: string): Promise<VerifyResult> {
  const start = performance.now();
  const res = await fetch(`${BASE_URL}/api/verify/${recordId}`, { headers: { Cookie: session.cookie } });
  const totalMs = performance.now() - start;
  if (!res.ok) throw new Error(`verifyRecord failed: ${res.status} ${await res.text()}`);
  const serverHeader = res.headers.get("x-verification-latency-ms");
  const json = (await res.json()) as { verdict: string };
  return { totalMs, serverMs: serverHeader ? Number(serverHeader) : null, verdict: json.verdict };
}

function mean(values: number[]): number {
  return values.reduce((s, v) => s + v, 0) / values.length;
}

function p95(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil(0.95 * sorted.length) - 1);
  return sorted[index];
}

function fmt(n: number): string {
  return `${n.toFixed(1)}ms`;
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
  const args = parseArgs();
  console.log("=== SecureLedger Performance Benchmark ===\n");
  console.log(`Target: ${BASE_URL}`);
  console.log(
    `Config: entries=${args.entries} verifications=${args.verifications} concurrentOrgs=${args.orgs} postsPerOrg=${args.postsPerOrg}\n`
  );

  // --- 1. Sequential baseline: single organisation, entries posted one at a time. ---
  console.log("--- Run 1: sequential posting (single organisation, best case) ---");
  const seqSession = await registerOrg("seq");
  const seqPosts: PostResult[] = [];
  for (let i = 0; i < args.entries; i++) {
    seqPosts.push(await postJournalEntry(seqSession, `Sequential bench entry #${i}`));
  }
  const seqTotalMs = seqPosts.map((p) => p.totalMs);
  const seqHashChainMs = seqPosts.filter((p) => p.hashChainMs !== null).map((p) => p.hashChainMs as number);
  console.log(
    `Posted ${args.entries} entries sequentially. Total request latency — mean: ${fmt(mean(seqTotalMs))}, p95: ${fmt(p95(seqTotalMs))}`
  );
  console.log(
    `Hash-chain latency only (X-Hash-Chain-Latency-Ms) — mean: ${fmt(mean(seqHashChainMs))}, p95: ${fmt(p95(seqHashChainMs))}\n`
  );

  // --- 2. Concurrent load: multiple simulated organisations posting simultaneously. ---
  console.log(`--- Run 2: concurrent posting (${args.orgs} organisations × ${args.postsPerOrg} posts each, all concurrent) ---`);
  const concurrentSessions = await Promise.all(
    Array.from({ length: args.orgs }, (_, i) => registerOrg(`conc-${i}`))
  );
  const concurrentStart = performance.now();
  const concurrentPosts = await Promise.all(
    concurrentSessions.flatMap((session, orgIdx) =>
      Array.from({ length: args.postsPerOrg }, (_, i) => postJournalEntry(session, `Concurrent bench entry org${orgIdx}#${i}`))
    )
  );
  const concurrentWallMs = performance.now() - concurrentStart;
  const concurrentTotalMs = concurrentPosts.map((p) => p.totalMs);
  const concurrentHashChainMs = concurrentPosts.filter((p) => p.hashChainMs !== null).map((p) => p.hashChainMs as number);
  console.log(
    `Posted ${concurrentPosts.length} entries across ${args.orgs} organisations concurrently in ${fmt(concurrentWallMs)} wall-clock.`
  );
  console.log(
    `Per-request total latency under concurrent load — mean: ${fmt(mean(concurrentTotalMs))}, p95: ${fmt(p95(concurrentTotalMs))}`
  );
  console.log(
    `Hash-chain latency under concurrent load (reflects real lock contention) — mean: ${fmt(mean(concurrentHashChainMs))}, p95: ${fmt(p95(concurrentHashChainMs))}\n`
  );

  // --- 3. Verification latency. ---
  console.log(`--- Run 3: verification (${args.verifications} requests) ---`);
  const allEntryIds = [...seqPosts.map((p) => p.journalEntryId), ...concurrentPosts.map((p) => p.journalEntryId)];
  const verifySession = seqSession;

  console.log(
    `Waiting up to ${(args.checkpointWaitMs / 1000).toFixed(0)}s for the checkpoint worker to process at least one posted entry, so verification is measured against a real signed checkpoint, not only the 'pending' short-circuit...`
  );
  let sampleVerdict = "pending";
  const waitDeadline = Date.now() + args.checkpointWaitMs;
  while (Date.now() < waitDeadline) {
    const probe = await verifyRecord(verifySession, allEntryIds[0]);
    sampleVerdict = probe.verdict;
    if (sampleVerdict !== "pending") break;
    await sleep(3000);
  }
  console.log(`Checkpoint wait finished — sample record verdict is now "${sampleVerdict}".\n`);

  const verifyResults: VerifyResult[] = [];
  for (let i = 0; i < args.verifications; i++) {
    const recordId = allEntryIds[i % allEntryIds.length];
    verifyResults.push(await verifyRecord(verifySession, recordId));
  }
  const verifyTotalMs = verifyResults.map((v) => v.totalMs);
  const verifyServerMs = verifyResults.filter((v) => v.serverMs !== null).map((v) => v.serverMs as number);
  const verdictCounts = verifyResults.reduce<Record<string, number>>((acc, v) => {
    acc[v.verdict] = (acc[v.verdict] ?? 0) + 1;
    return acc;
  }, {});
  console.log(`Ran ${args.verifications} verification requests. Verdict distribution: ${JSON.stringify(verdictCounts)}`);
  console.log(`Total response latency — mean: ${fmt(mean(verifyTotalMs))}, p95: ${fmt(p95(verifyTotalMs))}`);
  console.log(`Server-side processing only — mean: ${fmt(mean(verifyServerMs))}, p95: ${fmt(p95(verifyServerMs))}\n`);

  // --- Summary table against the stated non-functional requirements. ---
  const hashChainAllMs = [...seqHashChainMs, ...concurrentHashChainMs];
  const hashChainMean = mean(hashChainAllMs);
  const hashChainP95 = p95(hashChainAllMs);
  const verifyMean = mean(verifyTotalMs);
  const verifyP95 = p95(verifyTotalMs);

  console.log("=== Results Summary ===\n");
  const rows = [
    ["Metric", "Requirement", "Measured Mean", "Measured p95"],
    [
      "Hash-chaining latency added to a journal-entry post",
      "≤300ms",
      fmt(hashChainMean),
      fmt(hashChainP95),
    ],
    ["Verification API response time", "≤2s", fmt(verifyMean), fmt(verifyP95)],
  ];
  const widths = rows[0].map((_, col) => Math.max(...rows.map((r) => r[col].length)));
  for (const row of rows) {
    console.log(row.map((cell, i) => cell.padEnd(widths[i])).join(" | "));
  }

  console.log("");
  const hashChainPass = hashChainP95 <= 300;
  const verifyPass = verifyP95 <= 2000;
  console.log(
    `Hash-chaining p95 vs 300ms target: ${hashChainPass ? "MEETS" : "MISSES"} target (${fmt(hashChainP95)})`
  );
  console.log(`Verification p95 vs 2000ms target: ${verifyPass ? "MEETS" : "MISSES"} target (${fmt(verifyP95)})`);
  console.log(
    "\nThese are the real, measured numbers from this run against this environment — not adjusted to hit the targets."
  );

  if (!hashChainPass || !verifyPass) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error("Benchmark failed:", err);
  process.exitCode = 1;
});
