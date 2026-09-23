"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import { Modal } from "@/components/Modal";
import { Table, THead, TBody, TH, TD, EmptyState, LoadingRows } from "@/components/Table";
import { StatusBadge } from "@/components/Badge";
import { ExportBar } from "@/components/ExportBar";
import { formatCurrency, formatDate, shortHash } from "@/lib/format";
import type { ExportTable } from "@/lib/export";
import { useSession } from "@/lib/useSession";

type JournalEntry = {
  id: string;
  date: string;
  description: string;
  status: string;
  createdById: string;
  lines: { debit: string; credit: string }[];
  createdBy: { name: string };
  chain: { hash: string; checkpointId: string | null } | null;
};

export default function JournalPage() {
  const { session } = useSession();
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleteTarget, setDeleteTarget] = useState<JournalEntry | null>(null);
  const [voidTarget, setVoidTarget] = useState<JournalEntry | null>(null);
  const [voidReason, setVoidReason] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    setLoading(true);
    const res = await fetch("/api/journal-entries");
    const data = await res.json();
    setEntries(data.journalEntries ?? []);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  const canManage = session?.user.role === "ACCOUNTANT" || session?.user.role === "AUDITOR";

  function getExportTable(): ExportTable {
    return {
      title: "Journal Entries",
      subtitle: `${session?.organisation.name ?? ""} — as of ${formatDate(new Date())}`,
      columns: ["Date", "Description", "Created By", "Amount", "Status", "Hash"],
      rows: entries.map((e) => {
        const total = e.lines.reduce((s, l) => s + Number(l.debit), 0);
        return [
          formatDate(e.date),
          e.description,
          e.createdBy?.name ?? "",
          formatCurrency(total),
          e.status,
          shortHash(e.chain?.hash),
        ];
      }),
      filename: `journal-entries-${new Date().toISOString().slice(0, 10)}`,
    };
  }

  function canDelete(entry: JournalEntry): boolean {
    if (entry.status !== "DRAFT") return false;
    return canManage || entry.createdById === session?.user.id;
  }

  function canVoid(entry: JournalEntry): boolean {
    return entry.status === "POSTED" && canManage;
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setBusy(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/journal-entries/${deleteTarget.id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to delete entry");
      setDeleteTarget(null);
      await load();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to delete entry");
    } finally {
      setBusy(false);
    }
  }

  async function confirmVoid() {
    if (!voidTarget) return;
    setBusy(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/journal-entries/${voidTarget.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "void", reason: voidReason }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to void entry");
      setVoidTarget(null);
      setVoidReason("");
      await load();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to void entry");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-900">Journal Entries</h1>
        <div className="flex items-center gap-2">
          <ExportBar getTable={getExportTable} />
          <Link href="/journal/new" className="print:hidden">
            <Button>+ New Entry</Button>
          </Link>
        </div>
      </div>

      {actionError && <p className="text-sm font-medium text-red-600">{actionError}</p>}

      <Card>
        <Table>
          <THead>
            <tr>
              <TH>Date</TH>
              <TH>Description</TH>
              <TH>Created by</TH>
              <TH className="text-right">Amount</TH>
              <TH>Status</TH>
              <TH>Hash</TH>
              <TH className="text-right">Actions</TH>
            </tr>
          </THead>
          <TBody>
            {loading && <LoadingRows colSpan={7} />}
            {!loading && entries.length === 0 && (
              <tr>
                <td colSpan={7}>
                  <EmptyState message="No journal entries yet. Post your first entry." />
                </td>
              </tr>
            )}
            {entries.map((e) => {
              const total = e.lines.reduce((s, l) => s + Number(l.debit), 0);
              return (
                <tr key={e.id}>
                  <TD>{formatDate(e.date)}</TD>
                  <TD className="font-medium text-slate-900">{e.description}</TD>
                  <TD>{e.createdBy?.name}</TD>
                  <TD className="text-right">{formatCurrency(total)}</TD>
                  <TD>
                    <StatusBadge status={e.status} />
                  </TD>
                  <TD>
                    <div className="flex items-center gap-2 font-mono text-xs">
                      <span title={e.chain?.hash}>{shortHash(e.chain?.hash)}</span>
                      <span
                        className={`text-[10px] font-bold uppercase ${
                          e.chain?.checkpointId ? "text-green-600" : "text-amber-600"
                        }`}
                      >
                        {e.chain?.checkpointId ? "checkpointed" : "pending"}
                      </span>
                    </div>
                  </TD>
                  <TD className="text-right">
                    {canDelete(e) && (
                      <Button
                        variant="danger"
                        className="!px-3 !py-1.5 text-xs"
                        onClick={() => {
                          setActionError(null);
                          setDeleteTarget(e);
                        }}
                      >
                        Delete
                      </Button>
                    )}
                    {canVoid(e) && (
                      <Button
                        variant="secondary"
                        className="!border-amber-500 !text-amber-600 !px-3 !py-1.5 text-xs"
                        onClick={() => {
                          setActionError(null);
                          setVoidTarget(e);
                        }}
                      >
                        Void
                      </Button>
                    )}
                  </TD>
                </tr>
              );
            })}
          </TBody>
        </Table>
      </Card>

      <Modal open={!!deleteTarget} onClose={() => setDeleteTarget(null)} title="Delete draft entry">
        <div className="space-y-4">
          <p className="text-sm text-slate-600">
            Delete the draft entry &quot;{deleteTarget?.description}&quot;? This cannot be undone.
          </p>
          <div className="flex gap-3">
            <Button variant="ghost" onClick={() => setDeleteTarget(null)} disabled={busy}>
              Cancel
            </Button>
            <Button variant="danger" onClick={confirmDelete} disabled={busy}>
              {busy ? "Deleting…" : "Delete"}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal open={!!voidTarget} onClose={() => setVoidTarget(null)} title="Void journal entry">
        <div className="space-y-4">
          <p className="text-sm text-slate-600">
            Voiding &quot;{voidTarget?.description}&quot; posts a reversing entry and marks the original as voided.
            The original record and its hash are never altered.
          </p>
          <div>
            <label className="mb-1 block text-sm font-bold text-slate-700">Reason (required)</label>
            <textarea
              required
              value={voidReason}
              onChange={(e) => setVoidReason(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              rows={3}
            />
          </div>
          <div className="flex gap-3">
            <Button variant="ghost" onClick={() => setVoidTarget(null)} disabled={busy}>
              Cancel
            </Button>
            <Button variant="secondary" onClick={confirmVoid} disabled={busy || !voidReason.trim()}>
              {busy ? "Voiding…" : "Void entry"}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
