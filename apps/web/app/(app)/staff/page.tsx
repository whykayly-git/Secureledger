"use client";

import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import { Modal } from "@/components/Modal";
import { Table, THead, TBody, TH, TD, EmptyState, LoadingRows } from "@/components/Table";
import { Badge, RoleBadge } from "@/components/Badge";
import { formatDate } from "@/lib/format";
import { useSession } from "@/lib/useSession";

type StaffMember = {
  id: string;
  name: string;
  email: string;
  role: "BOOKKEEPER" | "ACCOUNTANT" | "AUDITOR";
  isOrgAdmin: boolean;
  isActive: boolean;
  createdAt: string;
  lastLoginAt: string | null;
};

const ROLE_OPTIONS: StaffMember["role"][] = ["BOOKKEEPER", "ACCOUNTANT", "AUDITOR"];

function AccessRestricted() {
  return (
    <div className="max-w-lg">
      <Card>
        <h1 className="text-lg font-bold text-slate-900">Manage Staff</h1>
        <p className="mt-2 text-sm font-medium text-slate-500">
          This section is restricted to organisation admins. Ask an admin on your team if you need staff changes made.
        </p>
      </Card>
    </div>
  );
}

export default function StaffPage() {
  const { session, loading: sessionLoading } = useSession();
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("");

  const [addOpen, setAddOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<StaffMember | null>(null);
  const [deactivateTarget, setDeactivateTarget] = useState<StaffMember | null>(null);
  const [removeTarget, setRemoveTarget] = useState<StaffMember | null>(null);

  const [listError, setListError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/staff");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to load staff");
      setStaff(data.staff ?? []);
      setListError(null);
    } catch (err) {
      setListError(err instanceof Error ? err.message : "Failed to load staff");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (session?.user.isOrgAdmin) load();
    else setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user.isOrgAdmin]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return staff.filter((s) => {
      const matchesSearch = !q || s.name.toLowerCase().includes(q) || s.email.toLowerCase().includes(q);
      const matchesRole = !roleFilter || s.role === roleFilter;
      return matchesSearch && matchesRole;
    });
  }, [staff, search, roleFilter]);

  if (sessionLoading) return null;
  if (!session?.user.isOrgAdmin) return <AccessRestricted />;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-900">Manage Staff</h1>
        <Button onClick={() => setAddOpen(true)}>+ Add Staff</Button>
      </div>

      {listError && <p className="text-sm font-medium text-red-600">{listError}</p>}

      <Card>
        <div className="mb-4 flex flex-wrap gap-3">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name or email"
            className="w-64 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <select
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          >
            <option value="">All roles</option>
            {ROLE_OPTIONS.map((r) => (
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
              <TH>Role</TH>
              <TH>Admin</TH>
              <TH>Status</TH>
              <TH>Date added</TH>
              <TH></TH>
            </tr>
          </THead>
          <TBody>
            {loading && <LoadingRows colSpan={7} />}
            {!loading && filtered.length === 0 && (
              <tr>
                <td colSpan={7}>
                  <EmptyState message={staff.length === 0 ? "No staff yet." : "No staff match your search."} />
                </td>
              </tr>
            )}
            {filtered.map((member) => (
              <tr key={member.id}>
                <TD className="font-medium text-slate-900">
                  {member.name}
                  {member.id === session.user.id && <span className="ml-2 text-xs text-slate-400">(you)</span>}
                </TD>
                <TD>{member.email}</TD>
                <TD>
                  <RoleBadge role={member.role} />
                </TD>
                <TD>{member.isOrgAdmin && <Badge tone="blue">Admin</Badge>}</TD>
                <TD>
                  <Badge tone={member.isActive ? "green" : "slate"}>{member.isActive ? "Active" : "Deactivated"}</Badge>
                </TD>
                <TD>{formatDate(member.createdAt)}</TD>
                <TD>
                  <div className="flex justify-end gap-3 text-sm font-bold">
                    <button className="text-primary hover:underline" onClick={() => setEditTarget(member)}>
                      Edit Role
                    </button>
                    {member.id !== session.user.id &&
                      (member.isActive ? (
                        <button className="text-amber-600 hover:underline" onClick={() => setDeactivateTarget(member)}>
                          Deactivate
                        </button>
                      ) : (
                        <button
                          className="text-green-600 hover:underline"
                          onClick={async () => {
                            await fetch(`/api/staff/${member.id}`, {
                              method: "PATCH",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ action: "reactivate" }),
                            });
                            await load();
                          }}
                        >
                          Reactivate
                        </button>
                      ))}
                    {member.id !== session.user.id && (
                      <button className="text-red-600 hover:underline" onClick={() => setRemoveTarget(member)}>
                        Remove
                      </button>
                    )}
                  </div>
                </TD>
              </tr>
            ))}
          </TBody>
        </Table>
      </Card>

      {addOpen && <AddStaffModal onClose={() => setAddOpen(false)} onCreated={load} />}
      {editTarget && (
        <EditRoleModal member={editTarget} currentUserId={session.user.id} onClose={() => setEditTarget(null)} onSaved={load} />
      )}
      {deactivateTarget && (
        <DeactivateModal member={deactivateTarget} onClose={() => setDeactivateTarget(null)} onDone={load} />
      )}
      {removeTarget && <RemoveModal member={removeTarget} onClose={() => setRemoveTarget(null)} onDone={load} />}
    </div>
  );
}

function AddStaffModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<StaffMember["role"]>("BOOKKEEPER");
  const [isOrgAdmin, setIsOrgAdmin] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [created, setCreated] = useState<{ email: string; temporaryPassword: string } | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/staff", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, role, isOrgAdmin }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to add staff member");
      setCreated({ email: data.user.email, temporaryPassword: data.temporaryPassword });
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add staff member");
    } finally {
      setLoading(false);
    }
  }

  async function copyPassword() {
    if (!created) return;
    await navigator.clipboard.writeText(created.temporaryPassword);
  }

  return (
    <Modal open onClose={onClose} title="Add Staff">
      {!created ? (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-bold text-slate-700">Name</label>
            <input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-bold text-slate-700">Email</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-bold text-slate-700">Role</label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as StaffMember["role"])}
              className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            >
              {ROLE_OPTIONS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>
          <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
            <input type="checkbox" checked={isOrgAdmin} onChange={(e) => setIsOrgAdmin(e.target.checked)} />
            Grant organisation admin access (can manage staff)
          </label>
          {error && <p className="text-sm font-medium text-red-600">{error}</p>}
          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? "Adding…" : "Add Staff"}
            </Button>
          </div>
        </form>
      ) : (
        <div className="space-y-4">
          <p className="rounded-lg bg-green-50 px-4 py-3 text-sm font-medium text-green-700">
            {created.email} has been added. Share this temporary password with them securely — it will not be shown
            again.
          </p>
          <div>
            <label className="mb-1 block text-sm font-bold text-slate-700">
              Temporary password — copy this and share it securely
            </label>
            <div className="flex gap-2">
              <input
                readOnly
                value={created.temporaryPassword}
                className="w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-2.5 font-mono text-sm text-slate-700 focus:outline-none"
              />
              <Button type="button" variant="secondary" onClick={copyPassword}>
                Copy
              </Button>
            </div>
            <p className="mt-1 text-xs text-slate-400">
              No email delivery is configured yet, so this is only ever shown here, once.
            </p>
          </div>
          <div className="flex justify-end pt-2">
            <Button type="button" onClick={onClose}>
              Done
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

function EditRoleModal({
  member,
  currentUserId,
  onClose,
  onSaved,
}: {
  member: StaffMember;
  currentUserId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [role, setRole] = useState(member.role);
  const [isOrgAdmin, setIsOrgAdmin] = useState(member.isOrgAdmin);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(`/api/staff/${member.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "updateRole", role, isOrgAdmin }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to update staff member");
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update staff member");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={`Edit role — ${member.name}`}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="mb-1 block text-sm font-bold text-slate-700">Role</label>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as StaffMember["role"])}
            className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          >
            {ROLE_OPTIONS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </div>
        <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
          <input type="checkbox" checked={isOrgAdmin} onChange={(e) => setIsOrgAdmin(e.target.checked)} />
          Organisation admin access (can manage staff)
        </label>
        {member.id === currentUserId && member.isOrgAdmin && (
          <p className="text-xs text-slate-400">
            If you are the organisation&apos;s only remaining admin, removing your own admin access will be blocked.
          </p>
        )}
        {error && <p className="text-sm font-medium text-red-600">{error}</p>}
        <div className="flex justify-end gap-3 pt-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={loading}>
            {loading ? "Saving…" : "Save"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function DeactivateModal({ member, onClose, onDone }: { member: StaffMember; onClose: () => void; onDone: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function confirm() {
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(`/api/staff/${member.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "deactivate" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to deactivate staff member");
      onDone();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to deactivate staff member");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={`Deactivate ${member.name}?`}>
      <p className="text-sm text-slate-600">
        {member.name} will no longer be able to log in. Their historical journal entries, invoices, and ledger records
        remain fully intact and continue to display normally in Audit Log and Reports, attributed by name.
      </p>
      {error && <p className="mt-3 text-sm font-medium text-red-600">{error}</p>}
      <div className="mt-5 flex justify-end gap-3">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="danger" onClick={confirm} disabled={loading}>
          {loading ? "Deactivating…" : "Deactivate"}
        </Button>
      </div>
    </Modal>
  );
}

function RemoveModal({ member, onClose, onDone }: { member: StaffMember; onClose: () => void; onDone: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function confirm() {
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(`/api/staff/${member.id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to remove staff member");
      onDone();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove staff member");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={`Remove ${member.name}?`}>
      <p className="text-sm text-slate-600">
        This permanently deletes {member.name}&apos;s account. Only allowed when they have zero ledger-affecting
        history. This cannot be undone.
      </p>
      {error && (
        <p className="mt-3 rounded-lg bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
          {error} Use Deactivate instead if this staff member has any history.
        </p>
      )}
      <div className="mt-5 flex justify-end gap-3">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="danger" onClick={confirm} disabled={loading}>
          {loading ? "Removing…" : "Remove permanently"}
        </Button>
      </div>
    </Modal>
  );
}
