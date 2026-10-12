/**
 * Journal-entry statuses whose lines count toward account balances and
 * reports. A voided entry keeps its original lines in the ledger (it is
 * never deleted or rewritten) and is cancelled by its separate POSTED
 * reversing entry, so both must be counted for the pair to net to zero.
 * Counting only POSTED would drop the original but keep its reversal,
 * reversing the entry's effect twice. DRAFT entries never count.
 */
export const COUNTED_ENTRY_STATUSES = ["POSTED", "VOID"] as const;
