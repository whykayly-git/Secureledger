"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import { Modal } from "@/components/Modal";
import { Table, THead, TBody, TH, TD, EmptyState, LoadingRows } from "@/components/Table";
import { Badge } from "@/components/Badge";
import { ExportBar } from "@/components/ExportBar";
import type { ExportTable } from "@/lib/export";
import { formatDate } from "@/lib/format";
import { useSession } from "@/lib/useSession";

type Account = {
  id: string;
  name: string;
  code: string;
  type: "ASSET" | "LIABILITY" | "EQUITY" | "INCOME" | "EXPENSE";
};

const TYPES: Account["type"][] = ["ASSET", "LIABILITY", "EQUITY", "INCOME", "EXPENSE"];

export default function AccountsPage() {
  const { session } = useSession();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("");
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState({ name: "", code: "", type: "ASSET" as Account["type"] });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    const params = new URLSearchParams();
    if (search) params.set("search", search);
    if (typeFilter) params.set("type", typeFilter);
    const res = await fetch(`/api/accounts?${params.toString()}`);
    const data = await res.json();
    setAccounts(data.accounts ?? []);
    setLoading(false);
  }

  useEffect(() => {
    const t = setTimeout(load, 200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, typeFilter]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const res = await fetch("/api/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to create account");
      setModalOpen(false);
      setForm({ name: "", code: "", type: "ASSET" });
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create account");
    } finally {
      setSaving(false);
    }
  }

  const grouped = TYPES.map((type) => ({ type, accounts: accounts.filter((a) => a.type === type) })).filter(
    (g) => g.accounts.length > 0 || !typeFilter
  );

  function getExportTable(): ExportTable {
    return {
      title: "Chart of Accounts",
      subtitle: `${session?.organisation.name ?? ""} — as of ${formatDate(new Date())}`,
      columns: ["Code", "Name", "Type"],
      rows: grouped.flatMap((g) => g.accounts.map((a) => [a.code, a.name, a.type])),
      filename: `chart-of-accounts-${new Date().toISOString().slice(0, 10)}`,
    };
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-900">Chart of Accounts</h1>
        <div className="flex items-center gap-2">
          <ExportBar getTable={getExportTable} />
          <Button onClick={() => setModalOpen(true)} className="print:hidden">
            + New Account
          </Button>
        </div>
      </div>

      <Card>
        <div className="mb-4 flex flex-wrap gap-3">
          <input
            placeholder="Search by name or code…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-64 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          >
            <option value="">All types</option>
            {TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>

        <Table>
          <THead>
            <tr>
              <TH>Code</TH>
              <TH>Name</TH>
              <TH>Type</TH>
            </tr>
          </THead>
          <TBody>
            {loading && <LoadingRows colSpan={3} />}
            {!loading && accounts.length === 0 && (
              <tr>
                <td colSpan={3}>
                  <EmptyState message="No accounts yet. Create your first account to get started." />
                </td>
              </tr>
            )}
            {!loading &&
              grouped.flatMap((g) =>
                g.accounts.map((a) => (
                  <tr key={a.id}>
                    <TD className="font-mono">{a.code}</TD>
                    <TD className="font-medium text-slate-900">{a.name}</TD>
                    <TD>
                      <Badge tone="blue">{a.type}</Badge>
                    </TD>
                  </tr>
                ))
              )}
          </TBody>
        </Table>
      </Card>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="New Account">
        <form onSubmit={handleCreate} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-bold text-slate-700">Account code</label>
            <input
              required
              value={form.code}
              onChange={(e) => setForm({ ...form, code: e.target.value })}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              placeholder="e.g. 1000"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-bold text-slate-700">Account name</label>
            <input
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              placeholder="e.g. Cash"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-bold text-slate-700">Type</label>
            <select
              value={form.type}
              onChange={(e) => setForm({ ...form, type: e.target.value as Account["type"] })}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            >
              {TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          {error && <p className="text-sm font-medium text-red-600">{error}</p>}
          <Button type="submit" disabled={saving} className="w-full">
            {saving ? "Saving…" : "Create account"}
          </Button>
        </form>
      </Modal>
    </div>
  );
}
