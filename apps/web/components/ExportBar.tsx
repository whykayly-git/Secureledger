"use client";

import { Button } from "./Button";
import { exportToPdf, exportToExcel, printCurrentPage, ExportTable } from "@/lib/export";

/**
 * PDF / Excel / Print controls for a page's current table data. Shared by
 * every exportable page (Invoicing, Reports, Journal Entries, Chart of
 * Accounts, Audit Log) so the three actions are implemented once, not
 * once per page. `getTable` is called at click time (not render time) so
 * the export always reflects whatever's on screen right then, not a
 * stale snapshot from when the page first loaded.
 *
 * `print:hidden` (Tailwind's built-in print media-query variant) hides
 * this whole row when printing — nothing extra to wire up for the Print
 * button itself, since window.print() already excludes anything
 * print:hidden the moment it fires.
 */
export function ExportBar({ getTable }: { getTable: () => ExportTable }) {
  return (
    <div className="print:hidden flex flex-wrap gap-2">
      <Button variant="secondary" onClick={() => exportToPdf(getTable())}>
        ⬇ PDF
      </Button>
      <Button variant="secondary" onClick={() => exportToExcel(getTable())}>
        ⬇ Excel
      </Button>
      <Button variant="secondary" onClick={printCurrentPage}>
        🖨 Print
      </Button>
    </div>
  );
}
