type BadgeTone = "neutral" | "blue" | "green" | "amber" | "red" | "slate";

const toneClasses: Record<BadgeTone, string> = {
  neutral: "bg-slate-100 text-slate-700",
  blue: "bg-blue-50 text-primary",
  green: "bg-green-50 text-green-700",
  amber: "bg-amber-50 text-amber-700",
  red: "bg-red-50 text-red-700",
  slate: "bg-slate-100 text-slate-600",
};

export function Badge({ children, tone = "neutral" }: { children: React.ReactNode; tone?: BadgeTone }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-bold ${toneClasses[tone]}`}
    >
      {children}
    </span>
  );
}

const STATUS_TONE: Record<string, BadgeTone> = {
  DRAFT: "slate",
  POSTED: "green",
  ISSUED: "blue",
  PAID: "green",
  VOID: "red",
  VOIDED: "red",
  PENDING: "amber",
};

export function StatusBadge({ status }: { status: string }) {
  return <Badge tone={STATUS_TONE[status] ?? "neutral"}>{status}</Badge>;
}

const ROLE_TONE: Record<string, BadgeTone> = {
  BOOKKEEPER: "slate",
  ACCOUNTANT: "blue",
  AUDITOR: "amber",
};

export function RoleBadge({ role }: { role: string }) {
  return <Badge tone={ROLE_TONE[role] ?? "neutral"}>{role}</Badge>;
}

const VERDICT_TONE: Record<string, BadgeTone> = {
  verified: "green",
  failed: "red",
  pending: "amber",
};

export function VerdictBadge({ verdict }: { verdict: string }) {
  const label = verdict === "verified" ? "Verified" : verdict === "failed" ? "Verification failed" : "Pending checkpoint";
  return <Badge tone={VERDICT_TONE[verdict] ?? "neutral"}>{label}</Badge>;
}
