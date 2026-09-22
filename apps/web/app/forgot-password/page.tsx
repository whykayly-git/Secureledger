"use client";

import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [resetLink, setResetLink] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Something went wrong");
      setMessage(data.message);
      setResetLink(`${window.location.origin}${data.resetPath}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  async function copyLink() {
    if (!resetLink) return;
    await navigator.clipboard.writeText(resetLink);
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-md">
        <div className="mb-8 flex justify-center">
          <Link href="/" className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-white font-bold">
              SL
            </div>
            <span className="text-lg font-bold text-slate-900">SecureLedger</span>
          </Link>
        </div>
        <Card>
          <h1 className="text-xl font-bold text-slate-900">Reset your password</h1>
          <p className="mt-1 text-sm font-medium text-slate-500">
            Enter your account email and we&apos;ll generate a reset link.
          </p>

          {!message ? (
            <form onSubmit={handleSubmit} className="mt-6 space-y-4">
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
              {error && <p className="text-sm font-medium text-red-600">{error}</p>}
              <Button type="submit" disabled={loading} className="w-full">
                {loading ? "Sending…" : "Send reset link"}
              </Button>
            </form>
          ) : (
            <div className="mt-6 space-y-4">
              <p className="rounded-lg bg-blue-50 px-4 py-3 text-sm font-medium text-primary">{message}</p>
              {resetLink && (
                <div>
                  <label className="mb-1 block text-sm font-bold text-slate-700">
                    No email delivery is configured yet — copy this link
                  </label>
                  <div className="flex gap-2">
                    <input
                      readOnly
                      value={resetLink}
                      className="w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-2.5 text-xs text-slate-600 focus:outline-none"
                    />
                    <Button type="button" variant="secondary" onClick={copyLink}>
                      Copy
                    </Button>
                  </div>
                  <p className="mt-1 text-xs text-slate-400">This link expires in 1 hour and can only be used once.</p>
                </div>
              )}
            </div>
          )}

          <p className="mt-6 text-center text-sm text-slate-500">
            <Link href="/login" className="font-bold text-primary">
              Back to log in
            </Link>
          </p>
        </Card>
      </div>
    </div>
  );
}
