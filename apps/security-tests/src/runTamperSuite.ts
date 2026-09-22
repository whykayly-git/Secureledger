import "dotenv/config";
import { SCENARIOS, ScenarioResult } from "./scenarios";
import { disconnectHarness } from "./harness";

function pad(value: string, width: number): string {
  return value.length >= width ? value.slice(0, width - 1) + "…" : value.padEnd(width);
}

function printResultsTable(results: ScenarioResult[]): void {
  const columns = [
    { header: "Scenario", width: 42 },
    { header: "Expected Verdict", width: 18 },
    { header: "Actual Verdict", width: 18 },
    { header: "Result", width: 8 },
  ];

  const headerLine = columns.map((c) => pad(c.header, c.width)).join(" | ");
  const separator = columns.map((c) => "-".repeat(c.width)).join("-|-");

  console.log(headerLine);
  console.log(separator);

  for (const r of results) {
    const row = [
      pad(`${r.id}. ${r.name}`, columns[0].width),
      pad(r.expectedVerdict, columns[1].width),
      pad(r.actualVerdict, columns[2].width),
      pad(r.pass ? "PASS ✓" : "FAIL ✗", columns[3].width),
    ].join(" | ");
    console.log(row);
  }
}

async function main(): Promise<void> {
  console.log("=== SecureLedger Tamper-Detection Security Test Suite ===\n");
  console.log(
    "Each scenario mutates already-committed rows directly via Prisma (bypassing the app's API),\n" +
      "then calls the real, unmodified verification logic and checks the verdict it returns.\n"
  );

  const results: ScenarioResult[] = [];

  for (const scenario of SCENARIOS) {
    console.log(`--- Running scenario ${scenario.id}: ${scenario.label} ---`);
    let result: ScenarioResult;
    try {
      result = await scenario.run();
    } catch (err) {
      result = {
        id: scenario.id,
        name: scenario.label,
        tamperDescription: "(scenario threw before producing a result)",
        expectedVerdict: "failed",
        actualVerdict: `ERROR: ${err instanceof Error ? err.message : String(err)}`,
        pass: false,
        detail: "The scenario raised an exception instead of returning a verdict — treat as a failure to detect.",
      };
    }
    results.push(result);

    console.log(
      `[${result.pass ? "PASS" : "FAIL"}] ${result.tamperDescription}\n` +
        `    expected="${result.expectedVerdict}" actual="${result.actualVerdict}"\n` +
        `    ${result.detail}\n`
    );
  }

  console.log("\n=== Results Summary ===\n");
  printResultsTable(results);

  const passCount = results.filter((r) => r.pass).length;
  const total = results.length;
  const rate = total === 0 ? 0 : (passCount / total) * 100;

  console.log(`\nDetection rate: ${passCount}/${total} (${rate.toFixed(1)}%)\n`);

  const failed = results.filter((r) => !r.pass);
  if (failed.length > 0) {
    console.log("Scenarios the verification logic failed to catch:");
    for (const f of failed) {
      console.log(`  - Scenario ${f.id} (${f.name}): expected "${f.expectedVerdict}", got "${f.actualVerdict}"`);
    }
    console.log("\nSee each scenario's detail line above for root-cause analysis.\n");
  }

  await disconnectHarness();

  if (failed.length > 0) {
    process.exitCode = 1;
  }
}

main().catch(async (err) => {
  console.error("Fatal error running tamper-detection suite:", err);
  await disconnectHarness().catch(() => {});
  process.exitCode = 1;
});
