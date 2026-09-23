"use client";

import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import * as XLSX from "xlsx";

/**
 * A single, shared shape every exportable page/report reduces its data
 * down to, so PDF/Excel generation is defined exactly once (here) instead
 * of once per page. `rows` are already display-formatted strings (e.g.
 * via formatCurrency/formatDate) — export renders exactly what the page
 * shows, not raw numbers/dates re-formatted a second way.
 */
export type ExportTable = {
  title: string;
  subtitle?: string;
  columns: string[];
  rows: (string | number)[][];
  /** Without extension — the extension is appended per export type. */
  filename: string;
};

export function exportToPdf(table: ExportTable): void {
  const doc = new jsPDF();
  doc.setFontSize(14);
  doc.text(table.title, 14, 17);
  if (table.subtitle) {
    doc.setFontSize(10);
    doc.setTextColor(100);
    doc.text(table.subtitle, 14, 23);
  }
  autoTable(doc, {
    head: [table.columns],
    body: table.rows.map((row) => row.map((cell) => String(cell))),
    startY: table.subtitle ? 28 : 22,
    styles: { fontSize: 9, cellPadding: 3 },
    headStyles: { fillColor: [30, 41, 59] },
    alternateRowStyles: { fillColor: [248, 250, 252] },
  });
  doc.save(`${table.filename}.pdf`);
}

export function exportToExcel(table: ExportTable): void {
  const worksheet = XLSX.utils.aoa_to_sheet([table.columns, ...table.rows]);
  const workbook = XLSX.utils.book_new();
  // Excel sheet names are capped at 31 characters and can't contain
  // : \ / ? * [ ]
  const sheetName = table.title.replace(/[:\\/?*[\]]/g, "").slice(0, 31) || "Sheet1";
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
  XLSX.writeFile(workbook, `${table.filename}.xlsx`);
}

/** Thin wrapper so callers don't need to know it's just window.print(). */
export function printCurrentPage(): void {
  window.print();
}
