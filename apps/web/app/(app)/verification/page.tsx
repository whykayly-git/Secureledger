"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import { Badge, VerdictBadge } from "@/components/Badge";
import { Table, THead, TBody, TH, TD } from "@/components/Table";
import { formatDateTime } from "@/lib/format";
import { useSession } from "@/lib/useSession";

type VerifyAllReport = {
  checkedAt: string;
  durationMs: number;
  totalRecords: number;
  checkedRecords: number;
  truncated: boolean;
  counts: { verified: number; pending: number; failed: number };
  failures: { chainId: string; recordId: string; recordType: string; createdAt: string; failureReason: string }[];
  continuity: { intact: boolean; totalRows: number; gaps: { type: string; detail: string }[] };
};

const SHORT_REASONS: Record<string, string> = {
  hash_mismatch: "Record changed after it was chained",
  chain_link_broken: "Link to the previous record is broken",
  auth_tag_invalid: "Not written by the application (authentication tag missing or wrong)",
  merkle_inclusion_invalid: "Not covered by its signed checkpoint",
  signature_invalid: "Checkpoint signature is invalid",
  verification_error: "Could not be verified (checkpoint data missing)",
};

type RunRow = {
  id: string;
  source: string;
  createdAt: string;
  checkedRecords: number;
  verified: number;
  pending: number;
  failed: number;
  continuityIntact: boolean;
  gapCount: number;
  hasProblems: boolean;
  acknowledged: boolean;
};

function RunHistoryCard({ refreshKey }: { refreshKey: number }) {
  const [runs, setRuns] = useState<RunRow[] | null>(null);

  useEffect(() => {
    fetch("/api/verify/runs?limit=15")
      .then((r) => (r.ok ? r.json() : { runs: [] }))
      .then((d) => setRuns(d.runs))
      .catch(() => setRuns([]));
  }, [refreshKey]);

  const lastScheduled = runs?.find((r) => r.source === "SCHEDULED");

  return (
    <Card>
      <h2 className="font-bold text-slate-900">Verification history</h2>
      <p className="mt-1 text-sm text-slate-600">
        The system also verifies the whole ledger automatically in the background and raises an alert here if it
        finds a problem.{" "}
        {lastScheduled
          ? `Last automatic run: ${formatDateTime(lastScheduled.createdAt)}.`
          : "No automatic run has completed yet."}
      </p>
      {runs && runs.length > 0 && (
        <div className="mt-4 overflow-x-auto">
          <Table>
            <THead>
              <tr>
                <TH>Time</TH>
                <TH>Run</TH>
                <TH className="text-right">Checked</TH>
                <TH className="text-right">Verified</TH>
                <TH className="text-right">Pending</TH>
                <TH className="text-right">Failed</TH>
                <TH>Chain</TH>
              </tr>
            </THead>
            <TBody>
              {runs.map((r) => (
                <tr key={r.id}>
                  <TD className="whitespace-nowrap">{formatDateTime(r.createdAt)}</TD>
                  <TD>
                    <Badge tone={r.source === "SCHEDULED" ? "blue" : "neutral"}>
                      {r.source === "SCHEDULED" ? "Automatic" : "Manual"}
                    </Badge>
                  </TD>
                  <TD className="text-right">{r.checkedRecords}</TD>
                  <TD className="text-right">{r.verified}</TD>
                  <TD className="text-right">{r.pending}</TD>
                  <TD className={`text-right font-bold ${r.failed ? "text-red-600" : ""}`}>{r.failed}</TD>
                  <TD>
                    {r.continuityIntact ? (
                      "Intact"
                    ) : (
                      <span className="font-bold text-red-600">{r.gapCount} gap(s)</span>
                    )}
                    {r.hasProblems && r.acknowledged && <span className="ml-2 text-xs text-slate-400">acknowledged</span>}
                  </TD>
                </tr>
              ))}
            </TBody>
          </Table>
        </div>
      )}
    </Card>
  );
}

function VerifyAllPanel({ onFinished }: { onFinished: () => void }) {
  const [running, setRunning] = useState(false);
  const [report, setReport] = useState<VerifyAllReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setRunning(true);
    setError(null);
    try {
      const res = await fetch("/api/verify/all");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Verification run failed");
      setReport(data);
      onFinished();
    } catch (err) {
      setReport(null);
      setError(err instanceof Error ? err.message : "Verification run failed");
    } finally {
      setRunning(false);
    }
  }

  const clean = report && report.counts.failed === 0 && report.continuity.intact;

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-bold text-slate-900">Verify all records</h2>
          <p className="mt-1 text-sm text-slate-600">
            Checks every journal entry and invoice in the ledger, and looks for records that have been deleted.
          </p>
        </div>
        <Button onClick={run} disabled={running}>
          {running ? "Verifying…" : "Verify all"}
        </Button>
      </div>

      {error && <p className="mt-4 text-sm font-medium text-red-600">{error}</p>}

      {report && (
        <div className="mt-5 space-y-4">
          <p
            className={`rounded-lg px-4 py-3 text-sm font-bold ${
              clean ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"
            }`}
          >
            {clean
              ? "No tampering detected."
              : `Problems found: ${report.counts.failed} failed record(s)${
                  report.continuity.intact ? "" : ` and ${report.continuity.gaps.length} gap(s) in the chain`
                }.`}
          </p>

          <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <div>
              <dt className="font-bold text-slate-500">Checked</dt>
              <dd className="text-slate-800">{report.checkedRecords}</dd>
            </div>
            <div>
              <dt className="font-bold text-slate-500">Verified</dt>
              <dd className="font-bold text-green-600">{report.counts.verified}</dd>
            </div>
            <div>
              <dt className="font-bold text-slate-500">Pending checkpoint</dt>
              <dd className="font-bold text-amber-600">{report.counts.pending}</dd>
            </div>
            <div>
              <dt className="font-bold text-slate-500">Failed</dt>
              <dd className={`font-bold ${report.counts.failed ? "text-red-600" : "text-slate-800"}`}>
                {report.counts.failed}
              </dd>
            </div>
          </dl>

          {report.truncated && (
            <p className="rounded-lg bg-amber-50 px-4 py-3 text-sm font-medium text-amber-700">
              Only the newest {report.checkedRecords} of {report.totalRecords} records were checked in this run.
            </p>
          )}

          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-bold text-slate-500">Chain continuity:</span>
            <Badge tone={report.continuity.intact ? "green" : "red"}>
              {report.continuity.intact ? "Intact, no missing records" : `${report.continuity.gaps.length} gap(s)`}
            </Badge>
          </div>
          {!report.continuity.intact && (
            <ul className="space-y-1 rounded-lg bg-red-50 px-4 py-3 text-xs font-medium text-red-700">
              {report.continuity.gaps.map((g, i) => (
                <li key={i}>{g.detail}</li>
              ))}
            </ul>
          )}

          {report.failures.length > 0 && (
            <Table>
              <THead>
                <tr>
                  <TH>Record type</TH>
                  <TH>Problem</TH>
                  <TH>Recorded</TH>
                  <TH></TH>
                </tr>
              </THead>
              <TBody>
                {report.failures.map((f) => (
                  <tr key={f.chainId}>
                    <TD>{f.recordType ? f.recordType.replace("_", " ") : "Unknown"}</TD>
                    <TD>{SHORT_REASONS[f.failureReason] ?? f.failureReason}</TD>
                    <TD>{f.createdAt ? formatDateTime(f.createdAt) : "—"}</TD>
                    <TD>
                      {f.recordId && (
                        <Link
                          href={`/verification?recordId=${f.recordId}&chainId=${f.chainId}`}
                          className="text-sm font-bold text-primary hover:underline"
                        >
                          Details
                        </Link>
                      )}
                    </TD>
                  </tr>
                ))}
              </TBody>
            </Table>
          )}

          <p className="text-xs text-slate-400">
            Run {formatDateTime(report.checkedAt)} in {(report.durationMs / 1000).toFixed(1)} s. Records still
            awaiting a checkpoint are intact but not yet covered by a signature.
          </p>
        </div>
      )}
    </Card>
  );
}

type ProofStep = { hash: string; position: "left" | "right" };
type VerificationResult = {
  verdict: "verified" | "failed" | "pending";
  recordId: string;
  recordType: string;
  chainId: string;
  hash: string;
  previousHash: string | null;
  createdAt: string;
  message?: string;
  inclusionValid?: boolean;
  signatureValid?: boolean;
  failureReason?: "hash_mismatch" | "chain_link_broken" | "auth_tag_invalid" | "merkle_inclusion_invalid" | "signature_invalid" | null;
  leafIndex?: number;
  proof?: ProofStep[];
  checkpoint?: {
    id: string;
    merkleRoot: string;
    signature: string;
    rangeStart: string;
    rangeEnd: string;
    createdAt: string;
    totalLeaves: number;
  };
  voidInfo?: {
    isVoided: boolean;
    voidedAt: string | null;
    voidReason: string | null;
    reversingEntryId: string | null;
    isReversingEntry: boolean;
    reversalOfEntryId: string | null;
  };
};

const FAILURE_REASON_MESSAGES: Record<string, string> = {
  hash_mismatch:
    "The record's data no longer matches what was hash-chained at write time — the underlying row has been altered since it was posted.",
  chain_link_broken:
    "This record's link to the previous entry in the chain doesn't match the actual prior record — the chain has been broken or forged.",
  auth_tag_invalid:
    "This record has the right hash and link but not the application's authentication tag, so it was not written by the application. It may have been inserted directly into the database.",
  merkle_inclusion_invalid:
    "The stored hash does not reconstruct to its checkpoint's signed Merkle root.",
  signature_invalid: "The checkpoint's signature does not validate against the checkpoint service's public key.",
};

function VerificationForm() {
  const searchParams = useSearchParams();
  const [recordId, setRecordId] = useState(searchParams.get("recordId") ?? "");
  const [chainId] = useState(searchParams.get("chainId") ?? "");
  const [result, setResult] = useState<VerificationResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const { session } = useSession();
  const isAuditor = session?.user.role === "AUDITOR";
  const [historyKey, setHistoryKey] = useState(0);

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setResult(null);
    setLoading(true);
    try {
      const url = chainId
        ? `/api/verify/${recordId}?chainId=${chainId}`
        : `/api/verify/${recordId}`;
      const res = await fetch(url);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Verification failed");
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Verification failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-3xl space-y-6">
      <h1 className="text-2xl font-bold text-slate-900">Verification</h1>
      <p className="text-sm font-medium text-slate-600">
        Independently verify that a record is part of a signed checkpoint. This reconstructs the Merkle
        inclusion proof and checks the ECDSA signature using only the public key — no trust in the web
        application is required.
      </p>

      <Card>
        <form onSubmit={handleVerify} className="flex gap-3">
          <input
            required
            value={recordId}
            onChange={(e) => setRecordId(e.target.value)}
            placeholder="Record ID (journal entry or invoice)"
            className="flex-1 rounded-lg border border-slate-300 px-3 py-2.5 text-sm font-mono focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <Button type="submit" disabled={loading}>
            {loading ? "Verifying…" : "Verify"}
          </Button>
        </form>
      </Card>

      {isAuditor && <VerifyAllPanel onFinished={() => setHistoryKey((k) => k + 1)} />}
      {isAuditor && <RunHistoryCard refreshKey={historyKey} />}

      {error && <p className="text-sm font-medium text-red-600">{error}</p>}

      {result && (
        <Card>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-bold text-slate-900">Result</h2>
            <VerdictBadge verdict={result.verdict} />
          </div>

          <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="font-bold text-slate-500">Record type</dt>
              <dd className="font-mono text-slate-800">{result.recordType}</dd>
            </div>
            <div>
              <dt className="font-bold text-slate-500">Record ID</dt>
              <dd className="break-all font-mono text-slate-800">{result.recordId}</dd>
            </div>
            <div>
              <dt className="font-bold text-slate-500">Chain entry hash</dt>
              <dd className="break-all font-mono text-slate-800">{result.hash}</dd>
            </div>
            <div>
              <dt className="font-bold text-slate-500">Previous hash</dt>
              <dd className="break-all font-mono text-slate-800">{result.previousHash ?? "GENESIS"}</dd>
            </div>
            <div>
              <dt className="font-bold text-slate-500">Recorded at</dt>
              <dd className="text-slate-800">{formatDateTime(result.createdAt)}</dd>
            </div>
          </dl>

          {result.verdict === "pending" && (
            <p className="mt-4 rounded-lg bg-amber-50 px-4 py-3 text-sm font-medium text-amber-700">
              {result.message ?? "This record has not yet been included in a checkpoint."}
            </p>
          )}

          {result.verdict === "failed" && result.failureReason && (
            <p className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
              {FAILURE_REASON_MESSAGES[result.failureReason]}
            </p>
          )}

          {result.voidInfo?.isVoided && (
            <p className="mt-4 rounded-lg bg-slate-100 px-4 py-3 text-sm font-medium text-slate-700">
              This entry has been voided by a reversing entry
              {result.voidInfo.reversingEntryId && (
                <>
                  {" "}
                  (
                  <a
                    href={`/verification?recordId=${result.voidInfo.reversingEntryId}`}
                    className="font-bold text-primary hover:underline"
                  >
                    view reversing entry
                  </a>
                  )
                </>
              )}
              . The integrity check above is for the original, untouched record — voided is not the same as
              tampered.
              {result.voidInfo.voidReason && (
                <span className="mt-1 block text-slate-500">Reason: {result.voidInfo.voidReason}</span>
              )}
            </p>
          )}

          {result.voidInfo?.isReversingEntry && (
            <p className="mt-4 rounded-lg bg-slate-100 px-4 py-3 text-sm font-medium text-slate-700">
              This is a reversing entry
              {result.voidInfo.reversalOfEntryId && (
                <>
                  {" "}
                  for{" "}
                  <a
                    href={`/verification?recordId=${result.voidInfo.reversalOfEntryId}`}
                    className="font-bold text-primary hover:underline"
                  >
                    the original voided entry
                  </a>
                </>
              )}
              .
            </p>
          )}

          {result.checkpoint && (
            <div className="mt-6 border-t border-slate-100 pt-4">
              <h3 className="mb-2 font-bold text-slate-900">Checkpoint</h3>
              <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
                <div>
                  <dt className="font-bold text-slate-500">Merkle root</dt>
                  <dd className="break-all font-mono text-slate-800">{result.checkpoint.merkleRoot}</dd>
                </div>
                <div>
                  <dt className="font-bold text-slate-500">Signature valid</dt>
                  <dd className={result.signatureValid ? "font-bold text-green-600" : "font-bold text-red-600"}>
                    {result.signatureValid ? "Yes" : "No"}
                  </dd>
                </div>
                <div>
                  <dt className="font-bold text-slate-500">Inclusion proof valid</dt>
                  <dd className={result.inclusionValid ? "font-bold text-green-600" : "font-bold text-red-600"}>
                    {result.inclusionValid ? "Yes" : "No"}
                  </dd>
                </div>
                <div>
                  <dt className="font-bold text-slate-500">Batch size</dt>
                  <dd className="text-slate-800">{result.checkpoint.totalLeaves} records (leaf #{result.leafIndex})</dd>
                </div>
                <div>
                  <dt className="font-bold text-slate-500">Range</dt>
                  <dd className="text-slate-800">
                    {formatDateTime(result.checkpoint.rangeStart)} → {formatDateTime(result.checkpoint.rangeEnd)}
                  </dd>
                </div>
                <div>
                  <dt className="font-bold text-slate-500">Checkpointed at</dt>
                  <dd className="text-slate-800">{formatDateTime(result.checkpoint.createdAt)}</dd>
                </div>
              </dl>

              {result.proof && result.proof.length > 0 && (
                <div className="mt-4">
                  <h4 className="mb-2 text-sm font-bold text-slate-700">Merkle proof path ({result.proof.length} steps)</h4>
                  <ol className="space-y-1 text-xs font-mono">
                    {result.proof.map((step, i) => (
                      <li key={i} className="rounded bg-slate-50 px-3 py-2">
                        <span className="font-bold uppercase text-slate-500">{step.position}</span> {step.hash}
                      </li>
                    ))}
                  </ol>
                </div>
              )}
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

export default function VerificationPage() {
  return (
    <Suspense>
      <VerificationForm />
    </Suspense>
  );
}
