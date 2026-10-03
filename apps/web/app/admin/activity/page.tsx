"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/Card";
import { Table, THead, TBody, TH, TD, EmptyState, LoadingRows } from "@/components/Table";
import { Badge } from "@/components/Badge";
import { formatDateTime } from "@/lib/format";

type Entry = {
  id: string;
  createdAt: string;
  organisation: string;
  actor: string;
  action: string;
  targetType: string;
  targetId: string;
  metadata: { name?: string; byPlatformAdmin?: boolean } | null;
};

export default function AdminActivityPage() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/admin/activity")
      .then(async (r) => {
        const body = await r.json();
        if (!r.ok) throw new Error(body.error ?? "Failed to load activity");
        setEntries(body.entries);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load activity"))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-slate-900">Activity</h1>
      <p className="text-sm font-medium text-slate-600">
        Administrative actions across every organisation, newest first. Actions taken from this console are tagged
        Platform.
      </p>
      {error && <p className="text-sm font-medium text-red-600">{error}</p>}
      <Card>
        <Table>
          <THead>
            <tr>
              <TH>Time</TH>
              <TH>Organisation</TH>
              <TH>Actor</TH>
              <TH>Action</TH>
              <TH>Target</TH>
            </tr>
          </THead>
          <TBody>
            {loading && <LoadingRows colSpan={5} />}
            {!loading && entries.length === 0 && (
              <tr>
                <td colSpan={5}>
                  <EmptyState message="No administrative activity yet." />
                </td>
              </tr>
            )}
            {entries.map((e) => (
              <tr key={e.id}>
                <TD>{formatDateTime(e.createdAt)}</TD>
                <TD>{e.organisation}</TD>
                <TD>{e.actor}</TD>
                <TD>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs">{e.action}</span>
                    {(e.action.startsWith("PLATFORM_") || e.metadata?.byPlatformAdmin) && (
                      <Badge tone="amber">Platform</Badge>
                    )}
                  </div>
                </TD>
                <TD>
                  {e.metadata?.name ?? e.targetId} <span className="text-xs text-slate-400">({e.targetType})</span>
                </TD>
              </tr>
            ))}
          </TBody>
        </Table>
      </Card>
    </div>
  );
}
