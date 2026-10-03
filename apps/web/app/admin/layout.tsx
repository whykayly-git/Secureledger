"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { useSession } from "@/lib/useSession";

const TABS = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/organisations", label: "Organisations" },
  { href: "/admin/users", label: "Users" },
  { href: "/admin/activity", label: "Activity" },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const { session, loading } = useSession();
  const pathname = usePathname();
  const router = useRouter();

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  if (loading) return null;

  if (!session?.user.isPlatformAdmin) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
        <div className="max-w-lg">
          <Card>
            <h1 className="text-lg font-bold text-slate-900">Platform Admin</h1>
            <p className="mt-2 text-sm font-medium text-slate-500">
              This area is restricted to platform administrators.
            </p>
            <Link href="/dashboard" className="mt-4 inline-block text-sm font-bold text-primary hover:underline">
              Back to the app
            </Link>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-800 bg-slate-900 px-6">
        <div className="flex h-16 items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-500 font-bold text-slate-900">
              PA
            </div>
            <span className="font-bold text-white">SecureLedger Platform Admin</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium text-slate-300">{session.user.email}</span>
            <Link href="/dashboard" className="text-sm font-bold text-amber-400 hover:underline">
              Back to app
            </Link>
            <Button variant="ghost" onClick={handleLogout} className="!text-slate-300 hover:!bg-slate-800">
              Log out
            </Button>
          </div>
        </div>
        <nav className="flex gap-1">
          {TABS.map((tab) => {
            const active = tab.href === "/admin" ? pathname === "/admin" : pathname?.startsWith(tab.href);
            return (
              <Link
                key={tab.href}
                href={tab.href}
                className={`rounded-t-lg px-4 py-2.5 text-sm font-bold transition-colors ${
                  active ? "bg-slate-50 text-slate-900" : "text-slate-300 hover:bg-slate-800"
                }`}
              >
                {tab.label}
              </Link>
            );
          })}
        </nav>
      </header>
      <main className="mx-auto max-w-6xl p-6">{children}</main>
    </div>
  );
}
