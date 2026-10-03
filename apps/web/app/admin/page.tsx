"use client";

import { useEffect, useState } from "react";
import { StatCard } from "@/components/StatCard";

type Overview = {
  organisations: number;
  users: number;
  activeUsers: number;
  journalEntries: number;
  invoices: number;
  chainEntries: number;
  pendingChain: number;
  checkpoints: number;
};

export default function AdminOverviewPage() {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/admin/overview")
      .then(async (r) => {
        const body = await r.json();
        if (!r.ok) throw new Error(body.error ?? "Failed to load overview");
        setData(body);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load overview"));
  }, []);

  const n = (v: number | undefined) => (data ? String(v) : "—");

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-slate-900">Platform overview</h1>
      {error && <p className="text-sm font-medium text-red-600">{error}</p>}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Organisations" value={n(data?.organisations)} />
        <StatCard
          label="Users"
          value={n(data?.users)}
          hint={data ? `${data.activeUsers} active, ${data.users - data.activeUsers} deactivated` : undefined}
        />
        <StatCard label="Journal entries" value={n(data?.journalEntries)} />
        <StatCard label="Invoices" value={n(data?.invoices)} />
        <StatCard label="Ledger chain entries" value={n(data?.chainEntries)} />
        <StatCard label="Signed checkpoints" value={n(data?.checkpoints)} />
        <StatCard
          label="Pending checkpoint"
          value={n(data?.pendingChain)}
          hint="Chain entries not yet in a signed checkpoint"
          tone={data && data.pendingChain > 0 ? "warning" : "default"}
        />
      </div>
    </div>
  );
}
