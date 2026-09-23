-- Closes tamper category (c) trial c-7: an attacker inserting a second
-- LedgerChain row that duplicates a reference to an already-chained,
-- unaltered JournalEntry. Deliberately scoped to JOURNAL_ENTRY only via a
-- partial index's WHERE clause (not representable in schema.prisma's
-- @@unique syntax — see the comment on the LedgerChain model) because a
-- JournalEntry legitimately gets exactly one chain entry ever, while the
-- SAME Invoice legitimately gets several over its lifecycle (issue, pay,
-- void each re-chain it with the same recordId) — a non-partial unique
-- constraint on (organisationId, recordType, recordId) would reject those
-- real invoice-lifecycle writes.
CREATE UNIQUE INDEX "ledger_chain_journal_entry_recordid_key"
  ON "ledger_chain" ("organisationId", "recordId")
  WHERE "recordType" = 'JOURNAL_ENTRY';
