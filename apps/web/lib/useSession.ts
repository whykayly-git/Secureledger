"use client";

import { useEffect, useState } from "react";

export type ClientSession = {
  user: { id: string; name: string; email: string; role: "BOOKKEEPER" | "ACCOUNTANT" | "AUDITOR" };
  organisation: { id: string; name: string };
};

export function useSession() {
  const [session, setSession] = useState<ClientSession | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/me")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled) setSession(data);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { session, loading };
}
