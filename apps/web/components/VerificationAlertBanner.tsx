"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { formatDateTime } from "@/lib/format";
import type { ClientSession } from "@/lib/useSession";

type Alert = {
  active: boolean;
  run: { id: string; source: string; createdAt: string; failed: number; gaps: number } | null;
};

const POLL_MS = 60_000;

/**
 * Red banner shown to auditors and organisation administrators while the
 * latest verification run has problems nobody has acknowledged. Auditors can
 * review and acknowledge it. Administrators are told, so they can ask an
 * auditor to look.
 */
export function VerificationAlertBanner({ session }: { session: ClientSession | null }) {
  const isAuditor = session?.user.role === "AUDITOR";
  const canSee = isAuditor || session?.user.isOrgAdmin === true;
  const [alert, setAlert] = useState<Alert | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/verify/alert");
      if (res.ok) setAlert(await res.json());
    } catch {
      // A failed poll leaves the last known state in place.
    }
  }, []);

  useEffect(() => {
    if (!canSee) return;
    load();
    const timer = setInterval(load, POLL_MS);
    return () => clearInterval(timer);
  }, [canSee, load]);

  async function acknowledge() {
    setBusy(true);
    try {
      await fetch("/api/verify/alert/acknowledge", { method: "POST" });
      await load();
    } finally {
      setBusy(false);
    }
  }

  if (!canSee || !alert?.active || !alert.run) return null;
  const { run } = alert;
  const parts = [
    run.failed > 0 ? `${run.failed} failed record(s)` : null,
    run.gaps > 0 ? `${run.gaps} gap(s) in the chain` : null,
  ].filter(Boolean);

  return (
    <div className="print:hidden flex flex-wrap items-center justify-between gap-3 bg-red-600 px-6 py-2 text-sm font-bold text-white">
      <span>
        Possible tampering: the {run.source === "SCHEDULED" ? "scheduled" : "manual"} verification on{" "}
        {formatDateTime(run.createdAt)} found {parts.join(" and ")}.
        {!isAuditor && " Ask an auditor to review it."}
      </span>
      {isAuditor && (
        <span className="flex items-center gap-4">
          <Link href="/verification" className="underline hover:no-underline">
            Review
          </Link>
          <button onClick={acknowledge} disabled={busy} className="underline hover:no-underline disabled:opacity-60">
            {busy ? "Saving…" : "Acknowledge"}
          </button>
        </span>
      )}
    </div>
  );
}
