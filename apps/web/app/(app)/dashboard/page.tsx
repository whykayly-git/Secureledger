"use client";

import { useEffect, useState } from "react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { StatCard } from "@/components/StatCard";
import { Card } from "@/components/Card";
import { Table, THead, TBody, TH, TD, EmptyState, LoadingRows } from "@/components/Table";
import { formatCurrency, formatDate } from "@/lib/format";

type DashboardData = {
  totalAssets: number;
  totalLiabilities: number;
  netIncomeThisPeriod: number;
  pendingChainCount: number;
  recentTransactions: {
    id: string;
    date: string;
    description: string;
    amount: number;
    chained: boolean;
    checkpointed: boolean;
  }[];
  chartSeries: { month: string; income: number; expense: number }[];
};

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/dashboard")
      .then((r) => r.json())
      .then(setData)
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-slate-900">Dashboard</h1>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Total Assets" value={data ? formatCurrency(data.totalAssets) : "—"} />
        <StatCard label="Total Liabilities" value={data ? formatCurrency(data.totalLiabilities) : "—"} />
        <StatCard
          label="Net Income (this period)"
          value={data ? formatCurrency(data.netIncomeThisPeriod) : "—"}
        />
        <StatCard
          label="Pending Checkpoint"
          value={data ? String(data.pendingChainCount) : "—"}
          hint="Records awaiting the next checkpoint cycle"
          tone={data && data.pendingChainCount > 0 ? "warning" : "default"}
        />
      </div>

      <Card>
        <h2 className="mb-4 font-bold text-slate-900">Income vs. Expenses (last 6 months)</h2>
        <div className="h-72 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data?.chartSeries ?? []}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="month" tick={{ fontSize: 12 }} stroke="#94a3b8" />
              <YAxis tick={{ fontSize: 12 }} stroke="#94a3b8" />
              <Tooltip formatter={(v: number) => formatCurrency(v)} />
              <Legend />
              <Bar dataKey="income" fill="#3B82F6" name="Income" radius={[4, 4, 0, 0]} />
              <Bar dataKey="expense" fill="#1E40AF" name="Expenses" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <Card>
        <h2 className="mb-4 font-bold text-slate-900">Recent Transactions</h2>
        <Table>
          <THead>
            <tr>
              <TH>Date</TH>
              <TH>Description</TH>
              <TH className="text-right">Amount</TH>
              <TH>Hash-chain</TH>
            </tr>
          </THead>
          <TBody>
            {loading && <LoadingRows colSpan={4} />}
            {!loading && (data?.recentTransactions.length ?? 0) === 0 && (
              <tr>
                <td colSpan={4}>
                  <EmptyState message="No transactions yet. Post a journal entry to get started." />
                </td>
              </tr>
            )}
            {data?.recentTransactions.map((t) => (
              <tr key={t.id}>
                <TD>{formatDate(t.date)}</TD>
                <TD>{t.description}</TD>
                <TD className="text-right">{formatCurrency(t.amount)}</TD>
                <TD>
                  {t.chained ? (
                    <span className={`text-sm font-bold ${t.checkpointed ? "text-green-600" : "text-amber-600"}`}>
                      {t.checkpointed ? "✓ Checkpointed" : "✓ Chained"}
                    </span>
                  ) : (
                    <span className="text-sm text-slate-400">—</span>
                  )}
                </TD>
              </tr>
            ))}
          </TBody>
        </Table>
      </Card>
    </div>
  );
}
