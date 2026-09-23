"use client";

import { Sidebar } from "@/components/Sidebar";
import { Topbar } from "@/components/Topbar";
import { useSession } from "@/lib/useSession";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { session } = useSession();

  return (
    <div className="flex min-h-screen bg-slate-50">
      <Sidebar session={session} />
      <div className="flex flex-1 flex-col">
        <Topbar session={session} />
        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
