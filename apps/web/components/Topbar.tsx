"use client";

import { useRouter } from "next/navigation";
import { RoleBadge } from "./Badge";
import { Button } from "./Button";
import type { ClientSession } from "@/lib/useSession";

export function Topbar({ session }: { session: ClientSession | null }) {
  const router = useRouter();

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <header className="print:hidden flex h-16 items-center justify-between border-b border-slate-200 bg-white px-6">
      <div>
        <p className="text-sm font-bold text-slate-900">{session?.organisation.name ?? "…"}</p>
      </div>
      <div className="flex items-center gap-3">
        {session && (
          <>
            <div className="text-right">
              <p className="text-sm font-medium text-slate-700">{session.user.name}</p>
            </div>
            <RoleBadge role={session.user.role} />
          </>
        )}
        <Button variant="ghost" onClick={handleLogout}>
          Log out
        </Button>
      </div>
    </header>
  );
}
