"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import { VerdictBadge } from "@/components/Badge";
import { formatDateTime } from "@/lib/format";

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

function VerificationForm() {
  const searchParams = useSearchParams();
  const [recordId, setRecordId] = useState(searchParams.get("recordId") ?? "");
  const [chainId] = useState(searchParams.get("chainId") ?? "");
  const [result, setResult] = useState<VerificationResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

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
