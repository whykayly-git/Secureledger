"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import { Table, THead, TBody, TH, TD, EmptyState, LoadingRows } from "@/components/Table";
import { Badge } from "@/components/Badge";
import { formatDateTime, shortHash } from "@/lib/format";
import { useSession } from "@/lib/useSession";

type LedgerAuditEntry = {
  kind: "LEDGER";
  chainId: string;
  recordType: "JOURNAL_ENTRY" | "INVOICE";
  recordId: string;
  hash: string;
  checkpointed: boolean;
  createdAt: string;
  summary: string;
};

type StaffAuditEntry = {
  kind: "STAFF";
  id: string;
  action: string;
  createdAt: string;
  summary: string;
};

type AuditEntry = LedgerAuditEntry | StaffAuditEntry;

export default function AuditLogPage() {
  const { session } = useSession();
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [recordType, setRecordType] = useState("");

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (recordType) params.set("recordType", recordType);
    fetch(`/api/audit-log?${params.toString()}`)
      .then((r) => r.json())
      .then((d) => setEntries(d.entries ?? []))
      .finally(() => setLoading(false));
  }, [recordType]);

  const isAuditor = session?.user.role === "AUDITOR";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-900">Audit Log</h1>
        {isAuditor && (
          <a href="/api/audit-log/export">
            <Button variant="secondary">Export batch verification (CSV)</Button>
          </a>
        )}
      </div>

      <Card>
        <div className="mb-4 flex gap-3">
          <select
            value={recordType}
            onChange={(e) => setRecordType(e.target.value)}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          >
            <option value="">All record types</option>
            <option value="JOURNAL_ENTRY">Journal Entries</option>
            <option value="INVOICE">Invoices</option>
            <option value="STAFF">Staff</option>
          </select>
        </div>

        <Table>
          <THead>
            <tr>
              <TH>Timestamp</TH>
              <TH>Record type</TH>
              <TH>Summary</TH>
              <TH>Hash</TH>
              <TH>Status</TH>
              <TH></TH>
            </tr>
          </THead>
          <TBody>
            {loading && <LoadingRows colSpan={6} />}
            {!loading && entries.length === 0 && (
              <tr>
                <td colSpan={6}>
                  <EmptyState message="No audit events yet." />
                </td>
              </tr>
            )}
            {entries.map((e) =>
              e.kind === "STAFF" ? (
                <tr key={e.id}>
                  <TD>{formatDateTime(e.createdAt)}</TD>
                  <TD>
                    <Badge tone="amber">Staff</Badge>
                  </TD>
                  <TD colSpan={4}>{e.summary}</TD>
                </tr>
              ) : (
                <tr key={e.chainId}>
                  <TD>{formatDateTime(e.createdAt)}</TD>
                  <TD>
                    <Badge tone="blue">{e.recordType.replace("_", " ")}</Badge>
                  </TD>
                  <TD>{e.summary}</TD>
                  <TD className="font-mono text-xs">{shortHash(e.hash)}</TD>
                  <TD>
                    <span className={`text-xs font-bold ${e.checkpointed ? "text-green-600" : "text-amber-600"}`}>
                      {e.checkpointed ? "Checkpointed" : "Pending"}
                    </span>
                  </TD>
                  <TD>
                    <Link
                      href={`/verification?recordId=${e.recordId}&chainId=${e.chainId}`}
                      className="text-sm font-bold text-primary hover:underline"
                    >
                      Verify
                    </Link>
                  </TD>
                </tr>
              )
            )}
          </TBody>
        </Table>
      </Card>
    </div>
  );
}
