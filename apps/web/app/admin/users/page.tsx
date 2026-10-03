"use client";

import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import { Modal } from "@/components/Modal";
import { Table, THead, TBody, TH, TD, EmptyState, LoadingRows } from "@/components/Table";
import { Badge, RoleBadge } from "@/components/Badge";
import { formatDate } from "@/lib/format";
import { useSession } from "@/lib/useSession";

type Role = "BOOKKEEPER" | "ACCOUNTANT" | "AUDITOR";
type AdminUser = {
  id: string;
  name: string;
  email: string;
  role: Role;
  isOrgAdmin: boolean;
  isActive: boolean;
  createdAt: string;
  lastLoginAt: string | null;
  organisation: { id: string; name: string };
};

const ROLES: Role[] = ["BOOKKEEPER", "ACCOUNTANT", "AUDITOR"];

async function patchUser(id: string, body: Record<string, unknown>) {
  const res = await fetch(`/api/admin/users/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Request failed");
  return data;
}

export default function AdminUsersPage() {
  const { session } = useSession();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [roleTarget, setRoleTarget] = useState<AdminUser | null>(null);
  const [resetTarget, setResetTarget] = useState<AdminUser | null>(null);
  const [removeTarget, setRemoveTarget] = useState<AdminUser | null>(null);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/users");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to load users");
      setUsers(data.users);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load users");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return users.filter((u) => {
      const matches =
        !q ||
        u.name.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q) ||
        u.organisation.name.toLowerCase().includes(q);
      return matches && (!roleFilter || u.role === roleFilter);
    });
  }, [users, search, roleFilter]);

  async function toggleActive(u: AdminUser) {
    try {
      await patchUser(u.id, { action: u.isActive ? "deactivate" : "reactivate" });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-slate-900">Users</h1>
      {error && <p className="text-sm font-medium text-red-600">{error}</p>}
      <Card>
        <div className="mb-4 flex flex-wrap gap-3">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, email or organisation"
            className="w-72 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <select
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          >
            <option value="">All roles</option>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </div>
        <Table>
          <THead>
            <tr>
              <TH>Name</TH>
              <TH>Email</TH>
              <TH>Organisation</TH>
              <TH>Role</TH>
              <TH>Status</TH>
              <TH>Last login</TH>
              <TH></TH>
            </tr>
          </THead>
          <TBody>
            {loading && <LoadingRows colSpan={7} />}
            {!loading && filtered.length === 0 && (
              <tr>
                <td colSpan={7}>
                  <EmptyState message="No users found." />
                </td>
              </tr>
            )}
            {filtered.map((u) => {
              const isSelf = u.id === session?.user.id;
              return (
                <tr key={u.id}>
                  <TD className="font-medium text-slate-900">
                    {u.name}
                    {isSelf && <span className="ml-2 text-xs text-slate-400">(you)</span>}
                  </TD>
                  <TD>{u.email}</TD>
                  <TD>{u.organisation.name}</TD>
                  <TD>
                    <div className="flex items-center gap-2">
                      <RoleBadge role={u.role} />
                      {u.isOrgAdmin && <Badge tone="blue">Admin</Badge>}
                    </div>
                  </TD>
                  <TD>
                    <Badge tone={u.isActive ? "green" : "slate"}>{u.isActive ? "Active" : "Deactivated"}</Badge>
                  </TD>
                  <TD>{u.lastLoginAt ? formatDate(u.lastLoginAt) : "Never"}</TD>
                  <TD>
                    <div className="flex justify-end gap-3 text-sm font-bold">
                      <button className="text-primary hover:underline" onClick={() => setRoleTarget(u)}>
                        Edit role
                      </button>
                      <button className="text-slate-600 hover:underline" onClick={() => setResetTarget(u)}>
                        Reset password
                      </button>
                      {!isSelf && (
                        <button
                          className={u.isActive ? "text-amber-600 hover:underline" : "text-green-600 hover:underline"}
                          onClick={() => toggleActive(u)}
                        >
                          {u.isActive ? "Deactivate" : "Reactivate"}
                        </button>
                      )}
                      {!isSelf && (
                        <button className="text-red-600 hover:underline" onClick={() => setRemoveTarget(u)}>
                          Remove
                        </button>
                      )}
                    </div>
                  </TD>
                </tr>
              );
            })}
          </TBody>
        </Table>
      </Card>

      {roleTarget && <RoleModal user={roleTarget} onClose={() => setRoleTarget(null)} onDone={load} />}
      {resetTarget && <ResetModal user={resetTarget} onClose={() => setResetTarget(null)} />}
      {removeTarget && <RemoveModal user={removeTarget} onClose={() => setRemoveTarget(null)} onDone={load} />}
    </div>
  );
}

function RoleModal({ user, onClose, onDone }: { user: AdminUser; onClose: () => void; onDone: () => void }) {
  const [role, setRole] = useState<Role>(user.role);
  const [isOrgAdmin, setIsOrgAdmin] = useState(user.isOrgAdmin);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await patchUser(user.id, { action: "updateRole", role, isOrgAdmin });
      onDone();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={`Edit role — ${user.name}`}>
      <form onSubmit={submit} className="space-y-4">
        <select
          value={role}
          onChange={(e) => setRole(e.target.value as Role)}
          className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
        >
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
          <input type="checkbox" checked={isOrgAdmin} onChange={(e) => setIsOrgAdmin(e.target.checked)} />
          Organisation admin access (can manage staff)
        </label>
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

function ResetModal({ user, onClose }: { user: AdminUser; onClose: () => void }) {
  const [password, setPassword] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function reset() {
    setBusy(true);
    setError(null);
    try {
      const data = await patchUser(user.id, { action: "resetPassword" });
      setPassword(data.temporaryPassword);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={`Reset password — ${user.name}`}>
      {!password ? (
        <div className="space-y-4">
          <p className="text-sm text-slate-600">
            Replaces {user.email}&apos;s password with a new temporary one. Their current password stops working
            immediately.
          </p>
          {error && <p className="text-sm font-medium text-red-600">{error}</p>}
          <div className="flex justify-end gap-3">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={reset} disabled={busy}>
              {busy ? "Resetting…" : "Reset password"}
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="rounded-lg bg-green-50 px-4 py-3 text-sm font-medium text-green-700">
            Share this temporary password securely — it will not be shown again.
          </p>
          <div className="flex gap-2">
            <input
              readOnly
              value={password}
              className="w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-2.5 font-mono text-sm text-slate-700 focus:outline-none"
            />
            <Button variant="secondary" onClick={() => navigator.clipboard.writeText(password)}>
              Copy
            </Button>
          </div>
          <div className="flex justify-end">
            <Button onClick={onClose}>Done</Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

function RemoveModal({ user, onClose, onDone }: { user: AdminUser; onClose: () => void; onDone: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/users/${user.id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to remove user");
      onDone();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove user");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={`Remove ${user.name}?`}>
      <p className="text-sm text-slate-600">
        Permanently deletes this account. Only allowed when they have no ledger-affecting history; otherwise
        deactivate them instead. This cannot be undone.
      </p>
      {error && <p className="mt-3 rounded-lg bg-red-50 px-4 py-3 text-sm font-medium text-red-700">{error}</p>}
      <div className="mt-5 flex justify-end gap-3">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="danger" onClick={confirm} disabled={busy}>
          {busy ? "Removing…" : "Remove permanently"}
        </Button>
      </div>
    </Modal>
  );
}
