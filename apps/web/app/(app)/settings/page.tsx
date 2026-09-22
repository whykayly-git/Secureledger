"use client";

import { Card } from "@/components/Card";
import { RoleBadge } from "@/components/Badge";
import { useSession } from "@/lib/useSession";

const SECURITY_ITEMS = [
  { label: "Encryption at rest", value: "AES-256" },
  { label: "Encryption in transit", value: "TLS 1.2+" },
  { label: "Authentication", value: "Stateless JWT (httpOnly, secure cookie)" },
  { label: "Password storage", value: "bcrypt, salted, never logged" },
  { label: "Authorization", value: "Role-based access control (RBAC)" },
  { label: "Rate limiting", value: "Enforced on auth and verification endpoints" },
  { label: "Ledger checkpointing", value: "Handled by an independent signing service — the web app never signs" },
];

export default function SettingsPage() {
  const { session } = useSession();

  return (
    <div className="max-w-3xl space-y-6">
      <h1 className="text-2xl font-bold text-slate-900">Settings</h1>

      <Card>
        <h2 className="mb-4 font-bold text-slate-900">Organisation</h2>
        <dl className="space-y-2 text-sm">
          <div className="flex justify-between">
            <dt className="text-slate-500">Name</dt>
            <dd className="font-medium text-slate-800">{session?.organisation.name ?? "…"}</dd>
          </div>
        </dl>
      </Card>

      <Card>
        <h2 className="mb-4 font-bold text-slate-900">Your profile</h2>
        <dl className="space-y-3 text-sm">
          <div className="flex justify-between">
            <dt className="text-slate-500">Name</dt>
            <dd className="font-medium text-slate-800">{session?.user.name ?? "…"}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-slate-500">Email</dt>
            <dd className="font-medium text-slate-800">{session?.user.email ?? "…"}</dd>
          </div>
          <div className="flex items-center justify-between">
            <dt className="text-slate-500">Role</dt>
            <dd>{session && <RoleBadge role={session.user.role} />}</dd>
          </div>
        </dl>
      </Card>

      <Card>
        <h2 className="mb-4 font-bold text-slate-900">Security (read-only)</h2>
        <dl className="space-y-3 text-sm">
          {SECURITY_ITEMS.map((item) => (
            <div key={item.label} className="flex justify-between gap-4">
              <dt className="text-slate-500">{item.label}</dt>
              <dd className="text-right font-medium text-slate-800">{item.value}</dd>
            </div>
          ))}
        </dl>
      </Card>
    </div>
  );
}
