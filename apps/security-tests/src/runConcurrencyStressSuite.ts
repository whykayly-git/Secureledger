import "dotenv/config";
import { CONCURRENCY_SCENARIOS, ConcurrencyScenarioResult } from "./concurrencyScenarios";
import { disconnectHarness } from "./harness";

function pad(value: string, width: number): string {
  return value.length >= width ? value.slice(0, width - 1) + "…" : value.padEnd(width);
}

function printResultsTable(results: ConcurrencyScenarioResult[]): void {
  const columns = [
    { header: "Scenario", width: 58 },
    { header: "Result", width: 8 },
  ];
  console.log(columns.map((c) => pad(c.header, c.width)).join(" | "));
  console.log(columns.map((c) => "-".repeat(c.width)).join("-|-"));
  for (const r of results) {
    console.log(
      [pad(`${r.id}. ${r.name}`, columns[0].width), pad(r.pass ? "PASS ✓" : "FAIL ✗", columns[1].width)].join(" | ")
    );
  }
}

async function main(): Promise<void> {
  console.log("=== SecureLedger Concurrency & Rollback Stress Suite ===\n");
  console.log(
    "Validates the advisory-lock concurrency fix (packages/ledger/src/hashChain.ts) directly:\n" +
      "no forks under same-org contention, no cross-org serialization, and atomic rollback on\n" +
      "mid-transaction failure.\n"
  );

  const results: ConcurrencyScenarioResult[] = [];

  for (const scenario of CONCURRENCY_SCENARIOS) {
    console.log(`--- Running scenario ${scenario.id}: ${scenario.label} ---`);
    let result: ConcurrencyScenarioResult;
    try {
      result = await scenario.run();
    } catch (err) {
      result = {
        id: scenario.id,
        name: scenario.label,
        pass: false,
        detail: `Scenario threw before producing a result: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
    results.push(result);
    console.log(`[${result.pass ? "PASS" : "FAIL"}] ${result.detail}`);
    if (result.metrics) console.log(`  metrics: ${JSON.stringify(result.metrics)}`);
    console.log("");
  }

  console.log("\n=== Results Summary ===\n");
  printResultsTable(results);

  const passCount = results.filter((r) => r.pass).length;
  const total = results.length;
  console.log(`\nPassed: ${passCount}/${total} (${((passCount / total) * 100).toFixed(1)}%)\n`);

  const b = results.find((r) => r.id === "B");
  if (b?.metrics) {
    console.log("Throughput evidence (Scenario B):");
    console.log(
      `  Same-org baseline: ${b.metrics.totalPosts} postings serialized to 1 org in ${b.metrics.sameOrgMs}ms`
    );
    console.log(
      `  Cross-org:          same total postings across ${b.metrics.orgCount} orgs in ${b.metrics.crossOrgMs}ms`
    );
    console.log(`  Speedup: ${b.metrics.speedup}\n`);
  }

  const failed = results.filter((r) => !r.pass);
  if (failed.length > 0) {
    console.log("Scenarios that did not pass:");
    for (const f of failed) {
      console.log(`  - Scenario ${f.id} (${f.name}): ${f.detail}`);
    }
    console.log("");
  }

  await disconnectHarness();

  if (failed.length > 0) {
    process.exitCode = 1;
  }
}

main().catch(async (err) => {
  console.error("Fatal error running concurrency stress suite:", err);
  await disconnectHarness().catch(() => {});
  process.exitCode = 1;
});
