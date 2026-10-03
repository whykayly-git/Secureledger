"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import { Modal } from "@/components/Modal";
import { Table, THead, TBody, TH, TD, EmptyState, LoadingRows } from "@/components/Table";
import { formatDate } from "@/lib/format";

type Org = {
  id: string;
  name: string;
  createdAt: string;
  counts: { users: number; accounts: number; journalEntries: number; invoices: number; chainEntries: number };
};

export default function AdminOrganisationsPage() {
  const router = useRouter();
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [renameTarget, setRenameTarget] = useState<Org | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Org | null>(null);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/organisations");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to load organisations");
      setOrgs(data.organisations);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load organisations");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return orgs.filter((o) => !q || o.name.toLowerCase().includes(q));
  }, [orgs, search]);

  async function openAsAdmin(org: Org) {
    setError(null);
    const res = await fetch(`/api/admin/organisations/${org.id}/enter`, { method: "POST" });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? "Failed to open organisation");
      return;
    }
    router.push("/dashboard");
    router.refresh();
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-slate-900">Organisations</h1>
      {error && <p className="text-sm font-medium text-red-600">{error}</p>}
      <Card>
        <div className="mb-4">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search organisations"
            className="w-64 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
        <Table>
          <THead>
            <tr>
              <TH>Organisation</TH>
              <TH className="text-right">Users</TH>
              <TH className="text-right">Accounts</TH>
              <TH className="text-right">Journal entries</TH>
              <TH className="text-right">Invoices</TH>
              <TH>Created</TH>
              <TH></TH>
            </tr>
          </THead>
          <TBody>
            {loading && <LoadingRows colSpan={7} />}
            {!loading && filtered.length === 0 && (
              <tr>
                <td colSpan={7}>
                  <EmptyState message="No organisations found." />
                </td>
              </tr>
            )}
            {filtered.map((o) => (
              <tr key={o.id}>
                <TD className="font-medium text-slate-900">{o.name}</TD>
                <TD className="text-right">{o.counts.users}</TD>
                <TD className="text-right">{o.counts.accounts}</TD>
                <TD className="text-right">{o.counts.journalEntries}</TD>
                <TD className="text-right">{o.counts.invoices}</TD>
                <TD>{formatDate(o.createdAt)}</TD>
                <TD>
                  <div className="flex justify-end gap-3 text-sm font-bold">
                    <button className="text-primary hover:underline" onClick={() => openAsAdmin(o)}>
                      Open as admin
                    </button>
                    <button className="text-slate-600 hover:underline" onClick={() => setRenameTarget(o)}>
                      Rename
                    </button>
                    <button className="text-red-600 hover:underline" onClick={() => setDeleteTarget(o)}>
                      Delete
                    </button>
                  </div>
                </TD>
              </tr>
            ))}
          </TBody>
        </Table>
      </Card>

      {renameTarget && <RenameModal org={renameTarget} onClose={() => setRenameTarget(null)} onDone={load} />}
      {deleteTarget && <DeleteModal org={deleteTarget} onClose={() => setDeleteTarget(null)} onDone={load} />}
    </div>
  );
}

function RenameModal({ org, onClose, onDone }: { org: Org; onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState(org.name);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/organisations/${org.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to rename");
      onDone();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to rename");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open onClose={onClose} title="Rename organisation">
      <form onSubmit={submit} className="space-y-4">
        <input
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
        />
        {error && <p className="text-sm font-medium text-red-600">{error}</p>}
        <div className="flex justify-end gap-3">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function DeleteModal({ org, onClose, onDone }: { org: Org; onClose: () => void; onDone: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/organisations/${org.id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to delete");
      onDone();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={`Delete ${org.name}?`}>
      <p className="text-sm text-slate-600">
        Permanently deletes this organisation, its users and its accounts. Only allowed when it has no journal
        entries, invoices or ledger history. This cannot be undone.
      </p>
      {error && <p className="mt-3 rounded-lg bg-red-50 px-4 py-3 text-sm font-medium text-red-700">{error}</p>}
      <div className="mt-5 flex justify-end gap-3">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="danger" onClick={confirm} disabled={busy}>
          {busy ? "Deleting…" : "Delete permanently"}
        </Button>
      </div>
    </Modal>
  );
}
