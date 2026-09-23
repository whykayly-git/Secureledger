"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import { Modal } from "@/components/Modal";
import { Table, THead, TBody, TH, TD, EmptyState, LoadingRows } from "@/components/Table";
import { StatusBadge } from "@/components/Badge";
import { ExportBar } from "@/components/ExportBar";
import { formatCurrency, formatDate } from "@/lib/format";
import type { ExportTable } from "@/lib/export";
import { useSession } from "@/lib/useSession";

type Account = { id: string; name: string; code: string; type: string };
type Invoice = {
  id: string;
  customerName: string;
  amount: string;
  status: "DRAFT" | "ISSUED" | "PAID" | "VOIDED";
  dueDate: string;
  lineItems: { items: { description: string; quantity: number; unitPrice: number; incomeAccountId: string }[]; receivableAccountId: string };
};

type ItemDraft = { description: string; quantity: string; unitPrice: string; incomeAccountId: string };

function emptyItem(): ItemDraft {
  return { description: "", quantity: "1", unitPrice: "", incomeAccountId: "" };
}

function lineTotalFor(item: ItemDraft): number {
  return (Number(item.quantity) || 0) * (Number(item.unitPrice) || 0);
}

/** One combined message per row, or no entry at all if that row is valid. */
function validateItems(items: ItemDraft[]): Record<number, string> {
  const errors: Record<number, string> = {};
  items.forEach((item, i) => {
    const issues: string[] = [];
    if (!item.description.trim()) issues.push("Description is required");
    if (!(Number(item.quantity) > 0)) issues.push("Quantity must be greater than 0");
    if (item.unitPrice.trim() === "" || !(Number(item.unitPrice) >= 0)) issues.push("Unit price must be 0 or more");
    if (!item.incomeAccountId) issues.push("Income account is required");
    if (issues.length > 0) errors[i] = issues.join(" · ");
  });
  return errors;
}

export default function InvoicingPage() {
  const { session } = useSession();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [payModalInvoice, setPayModalInvoice] = useState<Invoice | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Invoice | null>(null);
  const [voidTarget, setVoidTarget] = useState<Invoice | null>(null);
  const [voidReason, setVoidReason] = useState("");
  const [showVoided, setShowVoided] = useState(true);
  const [cashAccountId, setCashAccountId] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [dueDate, setDueDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [receivableAccountId, setReceivableAccountId] = useState("");
  const [items, setItems] = useState<ItemDraft[]>([emptyItem()]);
  const [attemptedSubmit, setAttemptedSubmit] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const canManage = session?.user.role === "ACCOUNTANT" || session?.user.role === "AUDITOR";
  const visibleInvoices = showVoided ? invoices : invoices.filter((i) => i.status !== "VOIDED");

  const receivableAccounts = accounts.filter((a) => a.type === "ASSET");
  const incomeAccounts = accounts.filter((a) => a.type === "INCOME");

  function getExportTable(): ExportTable {
    return {
      title: "Invoicing",
      subtitle: `${session?.organisation.name ?? ""} — as of ${formatDate(new Date())}`,
      columns: ["Customer", "Due Date", "Amount", "Status"],
      rows: visibleInvoices.map((inv) => [
        inv.customerName,
        formatDate(inv.dueDate),
        formatCurrency(Number(inv.amount)),
        inv.status,
      ]),
      filename: `invoicing-${new Date().toISOString().slice(0, 10)}`,
    };
  }

  async function loadInvoices() {
    setLoading(true);
    const res = await fetch("/api/invoices");
    const data = await res.json();
    setInvoices(data.invoices ?? []);
    setLoading(false);
  }

  async function loadAccounts() {
    const res = await fetch("/api/accounts");
    const data = await res.json();
    setAccounts(data.accounts ?? []);
  }

  useEffect(() => {
    loadInvoices();
    loadAccounts();
  }, []);

  // Accounts are also fetched fresh every time the New Invoice modal opens
  // — otherwise an income/receivable account created after this page first
  // mounted (e.g. in another tab, or just moments ago on Chart of
  // Accounts) wouldn't show up in these dropdowns until a full reload.
  useEffect(() => {
    if (modalOpen) loadAccounts();
  }, [modalOpen]);

  const total = useMemo(() => items.reduce((s, i) => s + lineTotalFor(i), 0), [items]);
  const itemErrors = useMemo(() => validateItems(items), [items]);

  function updateItem(i: number, patch: Partial<ItemDraft>) {
    setItems((prev) => prev.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));
  }

  function addItem() {
    setItems((prev) => [...prev, emptyItem()]);
  }

  function removeItem(i: number) {
    setItems((prev) => (prev.length > 1 ? prev.filter((_, idx) => idx !== i) : prev));
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setAttemptedSubmit(true);
    if (Object.keys(itemErrors).length > 0) {
      setError("Fix the highlighted line items before continuing.");
      return;
    }
    setError(null);
    setSaving(true);
    try {
      const res = await fetch("/api/invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerName,
          dueDate,
          receivableAccountId,
          items: items.map((i) => ({
            description: i.description,
            quantity: Number(i.quantity),
            unitPrice: Number(i.unitPrice),
            incomeAccountId: i.incomeAccountId,
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to create invoice");
      setModalOpen(false);
      setCustomerName("");
      setReceivableAccountId("");
      setItems([emptyItem()]);
      setAttemptedSubmit(false);
      loadInvoices();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create invoice");
    } finally {
      setSaving(false);
    }
  }

  async function handleIssue(invoice: Invoice) {
    setActionError(null);
    const res = await fetch(`/api/invoices/${invoice.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "issue" }),
    });
    const data = await res.json();
    if (!res.ok) {
      setActionError(data.error ?? "Failed to issue invoice");
      return;
    }
    loadInvoices();
  }

  async function handlePay(e: React.FormEvent) {
    e.preventDefault();
    if (!payModalInvoice) return;
    setActionError(null);
    const res = await fetch(`/api/invoices/${payModalInvoice.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "pay", cashAccountId }),
    });
    const data = await res.json();
    if (!res.ok) {
      setActionError(data.error ?? "Failed to record payment");
      return;
    }
    setPayModalInvoice(null);
    setCashAccountId("");
    loadInvoices();
  }

  async function confirmDeleteInvoice() {
    if (!deleteTarget) return;
    setBusy(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/invoices/${deleteTarget.id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to delete invoice");
      setDeleteTarget(null);
      await loadInvoices();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to delete invoice");
    } finally {
      setBusy(false);
    }
  }

  async function confirmVoidInvoice() {
    if (!voidTarget) return;
    setBusy(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/invoices/${voidTarget.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "void", reason: voidReason }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to void invoice");
      setVoidTarget(null);
      setVoidReason("");
      await loadInvoices();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to void invoice");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-900">Invoicing</h1>
        <div className="flex items-center gap-2">
          <ExportBar getTable={getExportTable} />
          <Button onClick={() => setModalOpen(true)} className="print:hidden">
            + New Invoice
          </Button>
        </div>
      </div>

      {actionError && <p className="text-sm font-medium text-red-600">{actionError}</p>}

      <Card>
        <div className="mb-4 flex items-center gap-2">
          <label className="flex items-center gap-2 text-sm font-medium text-slate-600">
            <input type="checkbox" checked={showVoided} onChange={(e) => setShowVoided(e.target.checked)} />
            Show voided invoices
          </label>
        </div>
        <Table>
          <THead>
            <tr>
              <TH>Customer</TH>
              <TH>Due date</TH>
              <TH className="text-right">Amount</TH>
              <TH>Status</TH>
              <TH className="text-right">Actions</TH>
            </tr>
          </THead>
          <TBody>
            {loading && <LoadingRows colSpan={5} />}
            {!loading && visibleInvoices.length === 0 && (
              <tr>
                <td colSpan={5}>
                  <EmptyState message="No invoices yet. Create your first invoice." />
                </td>
              </tr>
            )}
            {visibleInvoices.map((inv) => (
              <tr key={inv.id}>
                <TD className="font-medium text-slate-900">{inv.customerName}</TD>
                <TD>{formatDate(inv.dueDate)}</TD>
                <TD className="text-right">{formatCurrency(Number(inv.amount))}</TD>
                <TD>
                  <StatusBadge status={inv.status} />
                </TD>
                <TD className="text-right">
                  <div className="flex justify-end gap-2">
                    {inv.status === "DRAFT" && (
                      <Button variant="secondary" onClick={() => handleIssue(inv)}>
                        Issue
                      </Button>
                    )}
                    {inv.status === "ISSUED" && (
                      <Button variant="secondary" onClick={() => setPayModalInvoice(inv)}>
                        Record payment
                      </Button>
                    )}
                    {inv.status === "DRAFT" && canManage && (
                      <Button
                        variant="danger"
                        className="!px-3 !py-1.5 text-xs"
                        onClick={() => {
                          setActionError(null);
                          setDeleteTarget(inv);
                        }}
                      >
                        Delete
                      </Button>
                    )}
                    {(inv.status === "ISSUED" || inv.status === "PAID") && canManage && (
                      <Button
                        variant="secondary"
                        className="!border-amber-500 !text-amber-600 !px-3 !py-1.5 text-xs"
                        onClick={() => {
                          setActionError(null);
                          setVoidTarget(inv);
                        }}
                      >
                        Void
                      </Button>
                    )}
                  </div>
                </TD>
              </tr>
            ))}
          </TBody>
        </Table>
      </Card>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="New Invoice" size="lg">
        {(receivableAccounts.length === 0 || incomeAccounts.length === 0) && (
          <p className="mb-4 rounded-lg bg-amber-50 px-4 py-3 text-sm font-medium text-amber-700">
            {receivableAccounts.length === 0 && incomeAccounts.length === 0
              ? "You need at least one ASSET account (to receive payment into) and one INCOME account (to book revenue to) before you can create an invoice."
              : receivableAccounts.length === 0
                ? "You need at least one ASSET account (to receive payment into) before you can create an invoice."
                : "You need at least one INCOME account (to book revenue to) before you can create an invoice."}{" "}
            <Link href="/accounts" className="font-bold underline">
              Add one in Chart of Accounts
            </Link>
            , then come back here.
          </p>
        )}
        <form onSubmit={handleCreate} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-sm font-bold text-slate-700">Customer name</label>
              <input
                required
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-bold text-slate-700">Due date</label>
              <input
                type="date"
                required
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-sm font-bold text-slate-700">Receivable account</label>
            <select
              required
              value={receivableAccountId}
              onChange={(e) => setReceivableAccountId(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            >
              <option value="">Select asset account…</option>
              {receivableAccounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.code} — {a.name}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <label className="block text-sm font-bold text-slate-700">Line items</label>
            <Table>
              <THead>
                <tr>
                  <TH>Description</TH>
                  <TH className="text-right">Qty</TH>
                  <TH className="text-right">Unit Price (₦)</TH>
                  <TH className="text-right">Line Total</TH>
                  <TH>Income account</TH>
                  <TH></TH>
                </tr>
              </THead>
              <TBody>
                {items.map((item, i) => (
                  <tr key={i}>
                    <TD>
                      <input
                        placeholder="Description"
                        value={item.description}
                        onChange={(e) => updateItem(i, { description: e.target.value })}
                        className="w-full min-w-[10rem] rounded-lg border border-slate-300 px-2 py-1.5 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                      />
                    </TD>
                    <TD className="text-right">
                      <input
                        type="number"
                        step="any"
                        placeholder="Qty"
                        value={item.quantity}
                        onChange={(e) => updateItem(i, { quantity: e.target.value })}
                        className="w-20 rounded-lg border border-slate-300 px-2 py-1.5 text-right text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                      />
                    </TD>
                    <TD className="text-right">
                      <input
                        type="number"
                        step="0.01"
                        placeholder="0.00"
                        value={item.unitPrice}
                        onChange={(e) => updateItem(i, { unitPrice: e.target.value })}
                        className="w-28 rounded-lg border border-slate-300 px-2 py-1.5 text-right text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                      />
                    </TD>
                    <TD className="whitespace-nowrap text-right font-medium text-slate-700">
                      {formatCurrency(lineTotalFor(item))}
                    </TD>
                    <TD>
                      <select
                        value={item.incomeAccountId}
                        onChange={(e) => updateItem(i, { incomeAccountId: e.target.value })}
                        className="w-full min-w-[9rem] rounded-lg border border-slate-300 px-2 py-1.5 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                      >
                        <option value="">Income account…</option>
                        {incomeAccounts.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.code} — {a.name}
                          </option>
                        ))}
                      </select>
                    </TD>
                    <TD>
                      {items.length > 1 && (
                        <button
                          type="button"
                          aria-label={`Remove line ${i + 1}`}
                          onClick={() => removeItem(i)}
                          className="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                        >
                          🗑
                        </button>
                      )}
                    </TD>
                  </tr>
                ))}
              </TBody>
            </Table>
            {attemptedSubmit && Object.keys(itemErrors).length > 0 && (
              <ul className="space-y-0.5 rounded-lg bg-red-50 px-4 py-2 text-xs font-medium text-red-700">
                {Object.entries(itemErrors).map(([idx, message]) => (
                  <li key={idx}>
                    Line {Number(idx) + 1}: {message}
                  </li>
                ))}
              </ul>
            )}
            <button type="button" onClick={addItem} className="text-sm font-bold text-primary hover:underline">
              + Add Line
            </button>
          </div>

          <div className="rounded-lg bg-slate-50 px-4 py-3 text-right text-sm font-bold">
            Total: {formatCurrency(total)}
          </div>

          {error && <p className="text-sm font-medium text-red-600">{error}</p>}
          <Button type="submit" disabled={saving} className="w-full">
            {saving ? "Saving…" : "Create draft invoice"}
          </Button>
        </form>
      </Modal>

      <Modal open={!!payModalInvoice} onClose={() => setPayModalInvoice(null)} title="Record Payment">
        <form onSubmit={handlePay} className="space-y-4">
          <p className="text-sm text-slate-600">
            Recording payment of {payModalInvoice && formatCurrency(Number(payModalInvoice.amount))} from{" "}
            {payModalInvoice?.customerName}.
          </p>
          <div>
            <label className="mb-1 block text-sm font-bold text-slate-700">Deposit to account</label>
            <select
              required
              value={cashAccountId}
              onChange={(e) => setCashAccountId(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            >
              <option value="">Select asset account…</option>
              {receivableAccounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.code} — {a.name}
                </option>
              ))}
            </select>
          </div>
          <Button type="submit" className="w-full">
            Confirm payment
          </Button>
        </form>
      </Modal>

      <Modal open={!!deleteTarget} onClose={() => setDeleteTarget(null)} title="Delete draft invoice">
        <div className="space-y-4">
          <p className="text-sm text-slate-600">
            Delete this draft invoice for {deleteTarget?.customerName}? This cannot be undone.
          </p>
          <div className="flex gap-3">
            <Button variant="ghost" onClick={() => setDeleteTarget(null)} disabled={busy}>
              Cancel
            </Button>
            <Button variant="danger" onClick={confirmDeleteInvoice} disabled={busy}>
              {busy ? "Deleting…" : "Delete"}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal open={!!voidTarget} onClose={() => setVoidTarget(null)} title="Void invoice">
        <div className="space-y-4">
          <p className="text-sm text-slate-600">
            Voiding the invoice for {voidTarget?.customerName} posts a reversing journal entry and marks the
            invoice as voided. The original invoice data, hash, and chain position are never altered.
          </p>
          <div>
            <label className="mb-1 block text-sm font-bold text-slate-700">Reason (required)</label>
            <textarea
              required
              value={voidReason}
              onChange={(e) => setVoidReason(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              rows={3}
            />
          </div>
          <div className="flex gap-3">
            <Button variant="ghost" onClick={() => setVoidTarget(null)} disabled={busy}>
              Cancel
            </Button>
            <Button variant="secondary" onClick={confirmVoidInvoice} disabled={busy || !voidReason.trim()}>
              {busy ? "Voiding…" : "Void invoice"}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
