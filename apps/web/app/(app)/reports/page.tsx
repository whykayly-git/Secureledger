"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/Card";
import { Table, THead, TBody, TH, TD } from "@/components/Table";
import { ExportBar } from "@/components/ExportBar";
import { formatCurrency, formatDate } from "@/lib/format";
import type { ExportTable } from "@/lib/export";
import { useSession } from "@/lib/useSession";

type TrialBalanceRow = {
  accountId: string;
  code: string;
  name: string;
  type: string;
  totalDebit: number;
  totalCredit: number;
  balance: number;
};

type IncomeStatement = {
  income: { accountId: string; code: string; name: string; amount: number }[];
  expenses: { accountId: string; code: string; name: string; amount: number }[];
  totalIncome: number;
  totalExpenses: number;
  netIncome: number;
};

export default function ReportsPage() {
  const { session } = useSession();
  const [tab, setTab] = useState<"trial" | "income">("trial");
  const [trialBalance, setTrialBalance] = useState<{ rows: TrialBalanceRow[]; totals: { totalDebit: number; totalCredit: number } } | null>(null);
  const [incomeStatement, setIncomeStatement] = useState<IncomeStatement | null>(null);

  useEffect(() => {
    fetch("/api/reports/trial-balance")
      .then((r) => r.json())
      .then(setTrialBalance);
    fetch("/api/reports/income-statement")
      .then((r) => r.json())
      .then(setIncomeStatement);
  }, []);

  const subtitle = `${session?.organisation.name ?? ""} — as of ${formatDate(new Date())}`;

  function getTrialBalanceExportTable(): ExportTable {
    return {
      title: "Trial Balance",
      subtitle,
      columns: ["Code", "Account", "Type", "Debit", "Credit"],
      rows: [
        ...(trialBalance?.rows.map((r) => [
          r.code,
          r.name,
          r.type,
          r.totalDebit ? formatCurrency(r.totalDebit) : "—",
          r.totalCredit ? formatCurrency(r.totalCredit) : "—",
        ]) ?? []),
        ["", "", "Total", formatCurrency(trialBalance?.totals.totalDebit ?? 0), formatCurrency(trialBalance?.totals.totalCredit ?? 0)],
      ],
      filename: `trial-balance-${new Date().toISOString().slice(0, 10)}`,
    };
  }

  function getIncomeStatementExportTable(): ExportTable {
    return {
      title: "Income Statement",
      subtitle,
      columns: ["Section", "Account", "Amount"],
      rows: [
        ...(incomeStatement?.income.map((r) => ["Income", r.name, formatCurrency(r.amount)]) ?? []),
        ["", "Total income", formatCurrency(incomeStatement?.totalIncome ?? 0)],
        ...(incomeStatement?.expenses.map((r) => ["Expenses", r.name, formatCurrency(r.amount)]) ?? []),
        ["", "Total expenses", formatCurrency(incomeStatement?.totalExpenses ?? 0)],
        ["", "Net Income", formatCurrency(incomeStatement?.netIncome ?? 0)],
      ],
      filename: `income-statement-${new Date().toISOString().slice(0, 10)}`,
    };
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-slate-900">Reports</h1>

      <div className="flex items-center justify-between">
        <div className="print:hidden flex gap-2">
          <button
            onClick={() => setTab("trial")}
            className={`rounded-lg px-4 py-2 text-sm font-bold ${tab === "trial" ? "bg-primary text-white" : "bg-white text-slate-600 border border-slate-200"}`}
          >
            Trial Balance
          </button>
          <button
            onClick={() => setTab("income")}
            className={`rounded-lg px-4 py-2 text-sm font-bold ${tab === "income" ? "bg-primary text-white" : "bg-white text-slate-600 border border-slate-200"}`}
          >
            Income Statement
          </button>
        </div>
        <ExportBar getTable={tab === "trial" ? getTrialBalanceExportTable : getIncomeStatementExportTable} />
      </div>

      {tab === "trial" && (
        <Card>
          <h2 className="mb-4 font-bold text-slate-900">Trial Balance</h2>
          <Table>
            <THead>
              <tr>
                <TH>Code</TH>
                <TH>Account</TH>
                <TH>Type</TH>
                <TH className="text-right">Debit</TH>
                <TH className="text-right">Credit</TH>
              </tr>
            </THead>
            <TBody>
              {trialBalance?.rows.map((r) => (
                <tr key={r.accountId}>
                  <TD className="font-mono">{r.code}</TD>
                  <TD className="font-medium text-slate-900">{r.name}</TD>
                  <TD>{r.type}</TD>
                  <TD className="text-right">{r.totalDebit ? formatCurrency(r.totalDebit) : "—"}</TD>
                  <TD className="text-right">{r.totalCredit ? formatCurrency(r.totalCredit) : "—"}</TD>
                </tr>
              ))}
              {trialBalance && (
                <tr className="font-bold">
                  <TD colSpan={3}>Total</TD>
                  <TD className="text-right">{formatCurrency(trialBalance.totals.totalDebit)}</TD>
                  <TD className="text-right">{formatCurrency(trialBalance.totals.totalCredit)}</TD>
                </tr>
              )}
            </TBody>
          </Table>
        </Card>
      )}

      {tab === "income" && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Card>
            <h2 className="mb-4 font-bold text-slate-900">Income</h2>
            <Table>
              <THead>
                <tr>
                  <TH>Account</TH>
                  <TH className="text-right">Amount</TH>
                </tr>
              </THead>
              <TBody>
                {incomeStatement?.income.map((r) => (
                  <tr key={r.accountId}>
                    <TD>{r.name}</TD>
                    <TD className="text-right">{formatCurrency(r.amount)}</TD>
                  </tr>
                ))}
                <tr className="font-bold">
                  <TD>Total income</TD>
                  <TD className="text-right">{formatCurrency(incomeStatement?.totalIncome ?? 0)}</TD>
                </tr>
              </TBody>
            </Table>
          </Card>
          <Card>
            <h2 className="mb-4 font-bold text-slate-900">Expenses</h2>
            <Table>
              <THead>
                <tr>
                  <TH>Account</TH>
                  <TH className="text-right">Amount</TH>
                </tr>
              </THead>
              <TBody>
                {incomeStatement?.expenses.map((r) => (
                  <tr key={r.accountId}>
                    <TD>{r.name}</TD>
                    <TD className="text-right">{formatCurrency(r.amount)}</TD>
                  </tr>
                ))}
                <tr className="font-bold">
                  <TD>Total expenses</TD>
                  <TD className="text-right">{formatCurrency(incomeStatement?.totalExpenses ?? 0)}</TD>
                </tr>
              </TBody>
            </Table>
          </Card>
          <Card className="lg:col-span-2">
            <div className="flex items-center justify-between">
              <span className="font-bold text-slate-900">Net Income</span>
              <span className={`text-xl font-bold ${(incomeStatement?.netIncome ?? 0) >= 0 ? "text-green-600" : "text-red-600"}`}>
                {formatCurrency(incomeStatement?.netIncome ?? 0)}
              </span>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
