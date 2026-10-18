"use client";

import { useRouter } from "next/navigation";
import { Sidebar } from "@/components/Sidebar";
import { Topbar } from "@/components/Topbar";
import { VerificationAlertBanner } from "@/components/VerificationAlertBanner";
import { useSession } from "@/lib/useSession";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { session } = useSession();
  const router = useRouter();

  async function exitOrganisation() {
    await fetch("/api/admin/exit", { method: "POST" });
    router.push("/admin/organisations");
    router.refresh();
  }

  return (
    <div className="flex min-h-screen bg-slate-50">
      <Sidebar session={session} />
      <div className="flex flex-1 flex-col">
        {session?.actingAsPlatformAdmin && (
          <div className="print:hidden flex items-center justify-between bg-amber-500 px-6 py-2 text-sm font-bold text-slate-900">
            <span>Platform admin mode — you are acting inside {session.organisation.name} with full access.</span>
            <button onClick={exitOrganisation} className="underline hover:no-underline">
              Exit to Platform Admin
            </button>
          </div>
        )}
        <VerificationAlertBanner session={session} />
        <Topbar session={session} />
        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
