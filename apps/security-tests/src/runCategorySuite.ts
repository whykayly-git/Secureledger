import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import { CATEGORIES, runControlTrials } from "./categorySuite";
import { disconnectHarness } from "./harness";
import { TrialResult } from "./categoryTrial";

/**
 * This project's local PGlite dev database is known to wedge under
 * sustained connection/query churn across many organisations in one long-
 * lived process (see apps/security-tests/README.md's concurrency-suite
 * notes) — confirmed here too: running all 8 categories' ~70 test
 * organisations back to back in a single process reliably crashed partway
 * through category (d), while the exact same logic ran cleanly against a
 * freshly-restarted instance. So each category runs as ITS OWN process
 * (see run-category-suite.sh, which restarts PGlite between each one) and
 * writes its trial results to a JSON file here; `--report` then reads all
 * of them back and prints the combined table. This is a workaround for
 * this sandbox's embedded dev database, not a characteristic of the
 * verification logic under test.
 */
const RESULTS_DIR = path.join(__dirname, "..", ".suite-results");

function pad(value: string, width: number): string {
  return value.length >= width ? value.slice(0, width - 1) + "…" : value.padEnd(width);
}

async function runOneCategory(categoryId: string): Promise<void> {
  const category = CATEGORIES.find((c) => c.id === categoryId);
  if (!category) {
    throw new Error(`Unknown category id: ${categoryId}`);
  }
  console.log(`--- Category (${category.id}): ${category.label} ---`);
  const results = await category.run();
  for (const r of results) {
    console.log(`[${r.detected ? "DETECTED" : "MISSED "}] ${r.description}`);
    console.log(`    ${r.detail}`);
  }
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(RESULTS_DIR, `${category.id}.json`),
    JSON.stringify({ id: category.id, label: category.label, results }, null, 2)
  );
  await disconnectHarness();
}

async function runControl(): Promise<void> {
  console.log("--- Control trials (not counted in the 64-trial total) ---");
  const results = await runControlTrials();
  for (const r of results) {
    console.log(`[${r.detected ? "PASS" : "FAIL"}] ${r.description}`);
    console.log(`    ${r.detail}`);
  }
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  fs.writeFileSync(path.join(RESULTS_DIR, "control.json"), JSON.stringify({ results }, null, 2));
  await disconnectHarness();
}

async function runEverythingInOneProcess(): Promise<void> {
  console.log("=== SecureLedger 8-Category Tamper-Detection Suite (Table 5.5) ===\n");
  for (const category of CATEGORIES) {
    console.log(`\n--- Category (${category.id}): ${category.label} ---`);
    const results = await category.run();
    for (const r of results) {
      console.log(`[${r.detected ? "DETECTED" : "MISSED "}] ${r.description}`);
      console.log(`    ${r.detail}`);
    }
    fs.mkdirSync(RESULTS_DIR, { recursive: true });
    fs.writeFileSync(
      path.join(RESULTS_DIR, `${category.id}.json`),
      JSON.stringify({ id: category.id, label: category.label, results }, null, 2)
    );
  }
  await runControl();
  await disconnectHarness();
}

function printReport(): void {
  type CategorySummary = { id: string; label: string; trials: number; detected: number };
  const summaries: CategorySummary[] = [];
  let grandTrials = 0;
  let grandDetected = 0;

  const hiccups: string[] = [];

  for (const category of CATEGORIES) {
    const filePath = path.join(RESULTS_DIR, `${category.id}.json`);
    if (!fs.existsSync(filePath)) {
      throw new Error(`Missing results for category ${category.id} — run it first (see run-category-suite.sh).`);
    }
    const data = JSON.parse(fs.readFileSync(filePath, "utf8")) as { results: TrialResult[] };
    const detected = data.results.filter((r) => r.detected).length;
    summaries.push({ id: category.id, label: category.label, trials: data.results.length, detected });
    grandTrials += data.results.length;
    grandDetected += detected;
    for (const r of data.results) {
      if (r.detail.startsWith("INFRASTRUCTURE_HICCUP")) {
        hiccups.push(`(${category.id}) ${r.id}: ${r.detail}`);
      }
    }
  }

  const controlPath = path.join(RESULTS_DIR, "control.json");
  const controlData = fs.existsSync(controlPath)
    ? (JSON.parse(fs.readFileSync(controlPath, "utf8")) as { results: TrialResult[] })
    : { results: [] };
  const controlPassed = controlData.results.filter((r) => r.detected).length;

  console.log("\n=== Results Summary ===\n");
  const columns = [
    { header: "Attack Category", width: 55 },
    { header: "Trials", width: 8 },
    { header: "Detected", width: 10 },
    { header: "Detection Rate", width: 16 },
  ];
  console.log(columns.map((c) => pad(c.header, c.width)).join(" | "));
  console.log(columns.map((c) => "-".repeat(c.width)).join("-|-"));
  for (const s of summaries) {
    const rate = ((s.detected / s.trials) * 100).toFixed(1) + "%";
    console.log(
      [
        pad(`(${s.id}) ${s.label}`, columns[0].width),
        pad(String(s.trials), columns[1].width),
        pad(String(s.detected), columns[2].width),
        pad(rate, columns[3].width),
      ].join(" | ")
    );
  }
  console.log(columns.map((c) => "-".repeat(c.width)).join("-|-"));
  const grandRate = ((grandDetected / grandTrials) * 100).toFixed(1) + "%";
  console.log(
    [
      pad("TOTAL", columns[0].width),
      pad(String(grandTrials), columns[1].width),
      pad(String(grandDetected), columns[2].width),
      pad(grandRate, columns[3].width),
    ].join(" | ")
  );

  console.log(`\nControl trials passed: ${controlPassed}/${controlData.results.length}`);

  console.log("\n\n=== Markdown table (for README) ===\n");
  console.log("| Attack Category | Trials | Detected | Detection Rate |");
  console.log("|---|---|---|---|");
  for (const s of summaries) {
    const rate = ((s.detected / s.trials) * 100).toFixed(1) + "%";
    console.log(`| (${s.id}) ${s.label} | ${s.trials} | ${s.detected} | ${rate} |`);
  }
  console.log(`| **Total** | **${grandTrials}** | **${grandDetected}** | **${grandRate}** |`);

  const missedCategories = summaries.filter((s) => s.detected < s.trials);
  if (missedCategories.length > 0) {
    console.log("\nCategories with at least one undetected trial (see per-trial [MISSED] lines in each category's own run log for why):");
    for (const s of missedCategories) {
      console.log(`  - (${s.id}) ${s.label}: ${s.detected}/${s.trials}`);
    }
  }

  if (hiccups.length > 0) {
    console.log(
      "\nWARNING: the following trials still show an infrastructure hiccup after run-category-suite.sh's retries " +
        "(a PGlite connection wedge, not a verification-logic failure) — re-running is recommended before treating " +
        "this report as final:"
    );
    for (const h of hiccups) {
      console.log(`  - ${h}`);
    }
  }

  if (grandDetected < grandTrials || controlPassed < controlData.results.length) {
    process.exitCode = 1;
  }
}

async function main(): Promise<void> {
  const arg = process.argv[2];

  if (arg === "--report") {
    printReport();
    return;
  }
  if (arg === "--control") {
    await runControl();
    return;
  }
  if (arg && arg.startsWith("--category=")) {
    await runOneCategory(arg.split("=")[1]);
    return;
  }

  await runEverythingInOneProcess();
  printReport();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
