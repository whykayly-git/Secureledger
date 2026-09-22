# SecureLedger Security & Concurrency Test Suites

This package holds two independent DB-backed integration test suites, plus the shared
harness they're both built on:

1. **Tamper-detection suite** (`__tests__/tamper.test.ts`, `npm run test:tamper-detection`)
   — see the section below.
2. **Concurrency & rollback stress suite** (`__tests__/concurrency.test.ts`, `npm run test:concurrency-stress`)
   — validates the PostgreSQL advisory-lock fix in `packages/ledger/src/hashChain.ts`.

Neither is included in the root `npm test` (crypto/checkpoint-worker unit tests, DB-free) —
both need a real, reachable `DATABASE_URL`.

```bash
cp apps/security-tests/.env.example apps/security-tests/.env   # set DATABASE_URL
npm run test:tamper-detection
npm run test:concurrency-stress
```

---

## Concurrency & rollback stress suite

Validates the non-functional requirement behind the advisory-lock fix: concurrent postings
for the same organisation must never fork the hash chain, postings for different
organisations must not block each other, and any mid-transaction failure must roll back the
accounting write and the hash-chain write together, atomically.

Four scenarios, each calling the real write path (`appendLedgerChainEntry` from
`@secureledger/ledger`, the same function every API route uses) — nothing reimplemented:

| # | Scenario | What it proves |
|---|---|---|
| A | 15 concurrent journal-entry postings, same organisation | Resulting `LedgerChain` is a single valid linear chain — no forks, no dropped records |
| B | Same total posting volume, same-org baseline vs. spread across 8 different organisations | Each org's chain is independently correct, AND cross-org postings aren't serialized against each other |
| C | Deliberate mid-transaction failure (real Postgres error) between the `JournalEntry` write and the hash-chain write | Both roll back together — no orphaned `JournalEntry`, no orphaned `LedgerChain` row |
| D | Same as C, for `Invoice` | Same guarantee for the invoice write path |

### Current result (last run against this codebase)

```
Scenario                                                   | Result
-----------------------------------------------------------|---------
A. Same-organisation concurrent postings produce a single… | PASS ✓
B. Cross-organisation postings are correct and not serial… | FAIL ✗
C. Mid-transaction failure rolls back journal-entry posti… | PASS ✓
D. Mid-transaction failure rolls back invoice posting ent… | PASS ✓

Passed: 3/4 (75.0%)

Throughput evidence (Scenario B):
  Same-org baseline: 40 postings serialized to 1 org in 790ms
  Cross-org:          same total postings across 8 orgs in 739ms
  Speedup: 1.07x
```

**A, C, D pass cleanly** — the advisory lock (`pg_advisory_xact_lock(hashtext(organisationId))`,
released automatically at transaction end) correctly serializes same-organisation postings
into one unforked chain, and Postgres transactionality correctly rolls back both writes
together on any mid-transaction failure.

**B's correctness half also passes** — every organisation's chain (the baseline org and all
8 cross-org orgs) comes out independently valid with zero cross-contamination. What fails is
the throughput assertion: cross-org postings only ran 1.07x faster than the fully-serialized
same-org baseline, well under the 1.2x threshold that would demonstrate real parallelism.

### Why B's throughput half fails here, and why that's not a lock-scoping bug

The lock is provably scoped per-organisation **by construction**, independent of any timing
measurement: `pg_advisory_xact_lock(hashtext(organisationId))` derives its lock key from
`hashtext(organisationId)`. Two different `organisationId` values hash to different keys
(collisions aside), and PostgreSQL's advisory lock table tracks each key independently —
transactions locking different keys never block each other, by definition of how advisory
locks work. There is no code path here that could make this "accidentally global."

What the throughput number is actually catching: this project's local/CI dev database in
this sandbox is **PGlite** (`@electric-sql/pglite-socket`), an embedded, WASM-compiled
single-process Postgres-compatible engine, used only because this environment has no Docker
and no real Postgres available (see the root [README](../../README.md) and
[project memory](../../.claude — architecture notes) for why). PGlite is explicitly not
designed for concurrent multi-connection throughput the way real PostgreSQL is; the
`-m`/`--max-connections` flag on its socket server accepts multiple TCP connections, but they
appear to still funnel through one underlying single-threaded WASM instance. The math bears
this out: the cross-org run (40 postings, 8 organisations, no cross-org lock contention
possible) took 739ms — close to the fully-serialized 790ms baseline, and nowhere near the
~100ms a genuinely parallel run (5 serialized postings per org, 8 orgs truly concurrent)
would take. Postings aren't running measurably faster cross-org because the database
underneath is not actually executing them concurrently, regardless of the application-level
lock.

**This has not been "adjusted to pass."** The threshold and assertion are left as written,
failing honestly. Re-running this exact suite against real PostgreSQL (e.g. via
`docker compose up`, once Docker is available) is expected to show a clear speedup, since
real Postgres has genuine concurrent connection handling — that run has not been possible in
this sandbox and is worth doing before treating Scenario B as resolved.

### Running it

```bash
npm run test:concurrency-stress                       # standalone script, prints the table above
npm run test --workspace=apps/security-tests           # Jest form, runs alongside tamper.test.ts
```

Both exit non-zero if any scenario fails, for CI.

---

## Tamper-detection suite

Validates the non-functional requirement:

> The system shall detect 100% of simulated unauthorised alterations to a previously posted transaction during security testing.

Every scenario directly mutates rows **already committed** to the database via Prisma —
bypassing `apps/web`'s API entirely, simulating an attacker or insider with raw database
access — then calls the real, unmodified `@secureledger/verification` package (the exact
code `/api/verify/[recordId]` runs in production) and asserts the verdict it returns.

Nothing here is mocked: seeding uses the real hash-chaining write path
(`@secureledger/ledger`), checkpointing calls the real checkpoint-worker orchestration
function (`@secureledger/checkpoint-worker/cycle`) in-process, and verification is the real
verification package — not reimplementations of any of them.

### Current result (last run against this codebase)

```
Scenario                                   | Expected Verdict   | Actual Verdict     | Result
-------------------------------------------|--------------------|--------------------|---------
1. Altered transaction amount              | failed             | verified           | FAIL ✗
2. Altered stored hash                     | failed             | failed             | PASS ✓
3. Altered previousHash pointer            | failed             | verified           | FAIL ✗
4. Tampered Merkle root                    | failed             | failed             | PASS ✓
5. Forged signature                        | failed             | failed             | PASS ✓
6. Tampering with a record still pending … | pending            | pending            | PASS ✓
7. Control — untouched, correctly checkpo… | verified           | verified           | PASS ✓

Detection rate: 5/7 (71.4%)
```

**This is the true, unmodified result — it has not been edited to look better.** Per the
brief this suite was built to, the verification logic was deliberately left unmodified even
though two scenarios expose a real gap. See root cause below.

### Root cause of the two undetected scenarios

`verifyLedgerChainEntryById` (`packages/verification/src/verify.ts`) only checks two things
for a checkpointed record:

1. **Merkle inclusion** — is the value currently stored in `LedgerChain.hash` included under
   the checkpoint's `merkleRoot`, given a proof rebuilt from the checkpoint's batch?
2. **Signature validity** — does `LedgerCheckpoint.signature` validate against
   `LedgerCheckpoint.merkleRoot` with the checkpoint-worker's public key?

It **never recomputes** `computeChainHash(fields, previousHash)` from the journal
entry/invoice's *current* row data and compares that to the stored `LedgerChain.hash`. That
stored hash is a write-time snapshot; nothing re-derives it at verification time.

- **Scenario 1** (edit `JournalLine.debit` directly, leave `LedgerChain.hash` alone): the
  stored hash is unchanged, so it's still correctly included under the (unchanged, validly
  signed) Merkle root — check 1 and 2 both pass, even though the record they supposedly
  describe no longer matches. **False "verified."**
- **Scenario 3** (rewrite `LedgerChain.previousHash` to a forged predecessor, leave `hash`
  and the record alone): `previousHash` is not used anywhere in the verification function at
  all — not to recompute anything, not to check continuity with the prior chain entry. The
  chain-link integrity that `previousHash` is supposed to provide is currently unenforced at
  verification time. **False "verified."**

Scenarios 2, 4, and 5 succeed because they change a hash/root/signature value directly,
which the existing Merkle-inclusion and signature checks do catch. Scenario 6 succeeds
because uncheckpointed records already short-circuit to an honest `"pending"` verdict before
any of those checks run. Scenario 7 (the control) confirms the suite is capable of returning
`"verified"` at all.

### What would close the gap (not implemented here, by design)

The brief for this suite explicitly says not to modify hash-chaining, checkpointing, or
verification logic to make tests pass. The fix — for a future, deliberate change — would be
for `verifyLedgerChainEntryById` to also:

1. Fetch the underlying `JournalEntry`/`Invoice` (+ lines) for `chainEntry.recordId`.
2. Recompute `computeChainHash(journalEntryHashFields(record), chainEntry.previousHash)`
   using the same `@secureledger/ledger` field-selection functions the write path uses.
3. Compare that recomputed hash to `chainEntry.hash`, and fail verification if they differ
   — this closes Scenario 1.
4. Additionally recompute the *previous* chain entry's hash (or at minimum confirm
   `chainEntry.previousHash` equals the actual prior `LedgerChain` row's `hash` for that
   organisation) — this closes Scenario 3.

This is a real, security-relevant change to production verification logic, so it should be
made — and re-validated against this same suite — as its own deliberate change, not folded
into this test suite's construction.
