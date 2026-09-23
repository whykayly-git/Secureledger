/**
 * Naira symbol is prefixed manually rather than via Intl's
 * `{ style: "currency", currency: "NGN" }` — that depends on the runtime's
 * ICU currency-display data actually resolving NGN to "₦" (some
 * environments fall back to the "NGN" code instead). Using Intl only for
 * the number grouping/decimals and prefixing "₦" ourselves guarantees the
 * symbol regardless of runtime ICU data.
 */
export function formatCurrency(value: number): string {
  const isNegative = value < 0;
  const formatted = new Intl.NumberFormat("en-NG", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Math.abs(value));
  return `${isNegative ? "-" : ""}₦${formatted}`;
}

export function formatDate(value: string | Date): string {
  const d = typeof value === "string" ? new Date(value) : value;
  return new Intl.DateTimeFormat("en-US", { year: "numeric", month: "short", day: "numeric" }).format(d);
}

export function formatDateTime(value: string | Date): string {
  const d = typeof value === "string" ? new Date(value) : value;
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

export function shortHash(hash: string | null | undefined, len = 10): string {
  if (!hash) return "—";
  return `${hash.slice(0, len)}…`;
}
