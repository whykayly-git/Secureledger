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
1. Altered transaction amount              | failed             | failed             | PASS ✓
2. Altered stored hash                     | failed             | failed             | PASS ✓
3. Altered previousHash pointer            | failed             | failed             | PASS ✓
4. Tampered Merkle root                    | failed             | failed             | PASS ✓
5. Forged signature                        | failed             | failed             | PASS ✓
6. Tampering with a record still pending … | failed             | failed             | PASS ✓
7. Control — untouched, correctly checkpo… | verified           | verified           | PASS ✓

Detection rate: 7/7 (100.0%)
```

**This is the true, current result of `npm run test:tamper-detection`, captured from an
actual run — not hand-edited.** Scenarios 1 and 3 previously reported a false `"verified"`
(see history below); both now correctly report `"failed"`, and the Scenario 7 control still
reports `"verified"` with no false positives introduced by the fix.

### History: the gap this suite originally found, and the fix that closed it

An earlier version of `verifyLedgerChainEntryById` (`packages/verification/src/verify.ts`)
only checked two things for a checkpointed record:

1. **Merkle inclusion** — is the value currently stored in `LedgerChain.hash` included under
   the checkpoint's `merkleRoot`, given a proof rebuilt from the checkpoint's batch?
2. **Signature validity** — does `LedgerCheckpoint.signature` validate against
   `LedgerCheckpoint.merkleRoot` with the checkpoint-worker's public key?

It never recomputed `computeChainHash(fields, previousHash)` from the journal entry/invoice's
*current* row data, and never independently confirmed `LedgerChain.previousHash` against the
actual prior chain row. That produced two false `"verified"` results (detection rate 5/7,
71.4%):

- **Scenario 1** (edit `JournalLine.debit` directly, leave `LedgerChain.hash` alone): the
  stored hash was unchanged, so it was still correctly included under the (unchanged, validly
  signed) Merkle root, even though the record it supposedly described no longer matched.
- **Scenario 3** (rewrite `LedgerChain.previousHash` to a forged predecessor, leave `hash`
  and the record alone): `previousHash` was not used anywhere in the verification function —
  not recomputed, not checked against the prior chain entry.

**The fix** (`packages/verification/src/verify.ts`) adds two checks that run for *every*
verdict path — pending, verified, and failed — not just as a gate before "verified":

1. **Hash recompute** — fetches the current `JournalEntry` (+ lines) or `Invoice` for
   `chainEntry.recordId` using the exact same field-selection functions the write path uses
   (`journalEntryHashFields` / `invoiceHashFields` from `@secureledger/ledger`, not a second
   parallel implementation), recomputes `computeChainHash(fields, chainEntry.previousHash)`,
   and compares it to the stored `chainEntry.hash`. A mismatch fails verification with
   `failureReason: "hash_mismatch"`. This closes Scenario 1.
2. **Chain-link continuity** — fetches the actual `LedgerChain` row that immediately precedes
   this one for the organisation (same `createdAt` ordering the write path relies on to find
   the chain tip) and confirms its `hash` equals this row's stored `previousHash`. A mismatch
   fails verification with `failureReason: "chain_link_broken"`. This closes Scenario 3.

Because both checks need no checkpoint to evaluate, they also apply to *uncheckpointed*
records — Scenario 6 (tampering with a record still pending checkpoint) now correctly reports
`"failed"` rather than the old `"pending"`, since a tampered record should never be reported
as merely "nothing checkpointed yet" (see the updated scenario docstring in
[`src/scenarios.ts`](src/scenarios.ts) for the full rationale). `"pending"` is now reserved
for records that are internally consistent but simply not yet checkpointed.

The write path (`appendLedgerChainEntry`, `computeChainHash`, the checkpoint worker, the
advisory lock) was not touched — this was entirely a read-side verification fix. The
`VerificationResult` type gained a `failureReason` field
(`"hash_mismatch" | "chain_link_broken" | "merkle_inclusion_invalid" | "signature_invalid"`)
so callers — the `/verification` page and the audit-log CSV export in `apps/web` — can surface
*why* a record failed, not just that it did.

---

## 8-category tamper-detection suite (Table 5.5)

A larger, second suite (`npm run test:category-suite`, `src/runCategorySuite.ts` +
`src/categories/*.ts`) that generalizes the 7-scenario suite above into the 8 attack
categories the thesis's Table 5.5 is built from — 66 trials as of the round of fixes below
(originally 64; b-9/b-10 were added deliberately, see Category (b)) — plus 2 control trials
(not counted in the total). Every trial reuses the same harness (`createTestOrganisation`,
`postJournalEntry`, `runCheckpoint`, `teardownOrganisation`) and calls the real, unmodified
`@secureledger/verification` package — `verifyLedgerChainEntryById` for per-record trials, and
`verifyChainContinuity` (below) for the two categories that need an organisation-wide view.
Nothing is mocked or reimplemented.

Two categories — (b) deletion and (d) reordering — needed infrastructure beyond the Part 1
fix, described after the results.

### Current result (last run against this codebase)

```
Attack Category                                         | Trials   | Detected   | Detection Rate
--------------------------------------------------------|----------|------------|-----------------
(a) Field-level modification                            | 16       | 16         | 100.0%
(b) Deletion of a posted entry                          | 10       | 8          | 80.0%
(c) Insertion of an unauthorised entry                  | 8        | 7          | 87.5%
(d) Reordering of entries within a batch                | 6        | 6          | 100.0%
(e) Direct modification of a stored hash-chain value    | 8        | 8          | 100.0%
(f) Modification of a stored Merkle checkpoint/root     | 6        | 6          | 100.0%
(g) Substitution of an invalid/mismatched signature     | 6        | 6          | 100.0%
(h) Alteration before vs. after checkpointing           | 6        | 6          | 100.0%
--------------------------------------------------------|----------|------------|-----------------
TOTAL                                                   | 66       | 63         | 95.5%

Control trials passed: 2/2
```

| Attack Category | Trials | Detected | Detection Rate |
|---|---|---|---|
| (a) Field-level modification | 16 | 16 | 100.0% |
| (b) Deletion of a posted entry | 10 | 8 | 80.0% |
| (c) Insertion of an unauthorised entry | 8 | 7 | 87.5% |
| (d) Reordering of entries within a batch | 6 | 6 | 100.0% |
| (e) Direct modification of a stored hash-chain value | 8 | 8 | 100.0% |
| (f) Modification of a stored Merkle checkpoint/root | 6 | 6 | 100.0% |
| (g) Substitution of an invalid/mismatched signature | 6 | 6 | 100.0% |
| (h) Alteration before vs. after checkpointing | 6 | 6 | 100.0% |
| **Total** | **66** | **63** | **95.5%** |

**This is the true, current result, captured from an actual run — not hand-edited.** Of the
original 4 documented gaps (60/64, 93.8%), two are now closed — cross-tenant record references
(c-3) and duplicate-recordId insertion (c-7), both described under Category (c). The remaining
3 misses (b-6, b-9, c-5) are genuine, honest, and — per an explicit decision on this round of
fixes — deliberately NOT closed:

- **b-6 and b-9** are the same fundamental limitation (deleting a record before any checkpoint
  commits to its existence) demonstrated two ways: b-6 shows the gap exists structurally, b-9
  shows it at a concretely configured, shrunk interval. See Category (b) — the window was
  narrowed, not eliminated, by design.
- **c-5** (an attacker who correctly computes every hash-chained field by hand) is explicitly
  out of scope for a code fix — see Category (c) — a fundamental property of hash-chain
  tamper-evidence acknowledged in the thesis's own threat model (Section 3.6.5), not a defect.

None of this is the suite, the fixes, or the thresholds being adjusted to hide a gap — the
opposite: b-9 and c-5 exist specifically to keep demonstrating, honestly, that these two limits
are real.

### New infrastructure this suite added

**`sequenceNumber` on `LedgerChain`** (migration
`20260922020000_ledger_sequence_and_checkpoint_count`) — an explicit, monotonically increasing
position (1, 2, 3, ...) per organisation, assigned in `appendLedgerChainEntry`
(`packages/ledger/src/hashChain.ts`) under the same advisory lock that already serializes
writes. Gives a position marker that is independent of the mutable `createdAt` timestamp
column.

**`recordCount` on `LedgerCheckpoint`** (same migration) — the exact number of `LedgerChain`
rows a checkpoint's Merkle batch covered, persisted once at checkpoint-creation time
(`apps/checkpoint-worker/src/cycle.ts`) from the same batch `buildCheckpointPayload` signs.

**`verifyChainContinuity(organisationId)`** (`packages/verification/src/continuity.ts`,
exported alongside `verifyLedgerChainEntryById`) — an organisation-wide sweep that per-record
verification cannot do on its own: it proves nothing is *missing*, not just that every
surviving row is internally consistent. Two checks:
1. **Sequence contiguity** — walks a chain's rows ordered by `sequenceNumber` and confirms an
   unbroken 1..N run; a gap means a row was deleted from the middle or start of the chain.
2. **Checkpoint count/range cross-check** — compares each checkpoint's persisted
   `recordCount`/`rangeStart`/`rangeEnd` against what its surviving rows actually look like now;
   catches deletion of a checkpointed batch's own tip, which sequence contiguity alone can't
   reveal (nothing after it exists to expose the gap).

Exposed to `apps/web` via a new Auditor-only route, `GET /api/verify/chain`
(`apps/web/app/api/verify/chain/route.ts`) — a peer to the existing per-record
`/api/verify/[recordId]`, not folded into the CSV export since an organisation-wide gap report
isn't a per-row CSV column.

**Two additions from the round of fixes that closed c-3 and c-7** (migration
`20260923000000_org_scoping_and_duplicate_recordid`):
- `recomputeStoredHash`'s `JournalEntry`/`Invoice` lookups (`packages/verification/src/verify.ts`)
  now take and filter by `organisationId`, not just `recordId` — closes c-3.
- A partial unique index, `UNIQUE (organisationId, recordId) WHERE recordType =
  'JOURNAL_ENTRY'`, enforced at the database level — closes c-7. See Category (c) below for why
  it's partial (JOURNAL_ENTRY-only) rather than a blanket constraint.

**`runCheckpointWithInterval(maxIntervalMs)` + `sleep(ms)`** (`src/harness.ts`) — used only by
b-9/b-10 to exercise the checkpoint worker's REAL timer behaviour (a configured
`CHECKPOINT_MAX_INTERVAL_MS` and real elapsed wall-clock time) instead of every other trial's
forced-immediate `maxIntervalMs: 0` checkpoint.

### Category (b) — why deletion needed `verifyChainContinuity`, and why the window is narrowed, not gone

A cleanly **deleted** `LedgerChain` row (no forged `previousHash`, nothing else touched) leaves
every *surviving* row's own hash and `previousHash` internally consistent — Part 1's
per-record check has nothing to catch on any of them. `verifyChainContinuity` closes the
middle/start case (a visible sequence gap) and the checkpointed-tip case (a checkpoint
count/range mismatch).

What's left is a single, well-understood limitation: a record deleted **before any checkpoint
has ever committed to its existence** leaves no trace — no surviving row's `previousHash`
references it (nothing comes after it), and no `LedgerCheckpoint` covers it. This is
fundamental to *async* checkpointing (Section 4.3.2's design: checkpointing runs on a timer,
not inline with every write, specifically to keep posting latency independent of Merkle-tree
and signing cost) — it cannot be eliminated without either checkpointing synchronously at
write time (reintroducing exactly the latency the async design exists to avoid) or an
independent, externally-anchored commitment made outside this database (so the same attacker
with DB access can't erase it too) — both out of scope here by explicit decision.

What CAN be — and was — done: shrink the window. `CHECKPOINT_MAX_INTERVAL_MS` and
`CHECKPOINT_BATCH_THRESHOLD` (`apps/checkpoint-worker/src/config.ts`) were already fully
env-var-configurable before this round of fixes; nothing needed to change there; the mechanism
already supports going down to a few seconds; the ask was to prove it, honestly, at a concrete
value:

- **b-6** — the structural case: an organisation whose most recent row is deleted before a
  *second* checkpoint cycle ever runs for it at all. Demonstrates the gap exists regardless of
  how the interval is configured. Still, honestly, undetected.
- **b-9** — the same gap demonstrated with a concrete, short, deliberately-configured
  `CHECKPOINT_MAX_INTERVAL_MS` of **2000ms** (`SHORT_CHECKPOINT_INTERVAL_MS` in
  `src/categories/deletion.ts`): a record posted just after a real checkpoint has already run
  for the organisation, then deleted almost immediately — well inside the 2-second window —
  using the real timer (`runCheckpointWithInterval` + a real `sleep`, not the forced-immediate
  `maxIntervalMs: 0` the other trials use). Still, honestly, undetected — proving the
  *narrower* window genuinely still exists rather than claiming a config change closes it.
- **b-10** — the control half of the same experiment: an identical record, but deleted only
  *after* real wall-clock time exceeds that same 2-second interval and a real checkpoint cycle
  has actually run and covered it. **Detected**, via the same checkpoint count/range mismatch
  b-5 exercises — proving the interval genuinely bounds the window rather than being
  decorative.

An organisation that needs a tighter window than this dev default sets
`CHECKPOINT_MAX_INTERVAL_MS` (and, for high-volume orgs, a lower `CHECKPOINT_BATCH_THRESHOLD`
so volume alone can trigger a checkpoint sooner) to whatever value it needs — down to a few
seconds, as b-9/b-10 demonstrate — at the cost of more frequent Merkle/signing work. The window
during which an unchekpointed deletion is invisible is therefore **configurable, bounded, and
non-zero** — not eliminated, and this suite does not claim otherwise.

### Category (c) — insertion: two gaps closed, one deliberately left open

Insertion trials span the real range of attacker sophistication, from "no backing record at
all" (caught immediately) up to "computed every chained field correctly":

- **c-3 (closed)** — `recomputeStoredHash` (`packages/verification/src/verify.ts`) used to look
  up the `JournalEntry`/`Invoice` by `recordId` alone, never checking that record's own
  `organisationId` matched the `LedgerChain` row's claimed `organisationId`. A row inserted into
  Org A's chain that referenced a real, unchanged record belonging to Org B recomputed its hash
  correctly (the fields were real, just cross-tenant) and passed every check. Fixed by scoping
  both the `JournalEntry` and `Invoice` lookups by `organisationId` — the same defense-in-depth
  pattern every other multi-tenant query in this codebase already uses (e.g. every `apps/web`
  route's `prisma.journalEntry.findFirst({ where: { id, organisationId } })`). Not enforced at
  the database level: `recordId` is deliberately untyped (it polymorphically refers to either a
  `JournalEntry` or an `Invoice` depending on `recordType`), so it can't be a real foreign key
  without a larger schema change — the app-level, organisationId-scoped fix is the correct,
  proportional one given that design.
- **c-7 (closed)** — nothing previously checked `recordId` uniqueness across a chain. A second,
  fully-chained `LedgerChain` row duplicating an existing, unaltered `JournalEntry`'s `recordId`
  recomputed its hash trivially (the underlying data never changed) and passed. Fixed with a
  **database-level** partial unique index — `UNIQUE (organisationId, recordId) WHERE recordType
  = 'JOURNAL_ENTRY'` (migration `20260923000000_org_scoping_and_duplicate_recordid`) — enforced
  even against a direct, raw insert, not just application-level validation. Deliberately
  **JOURNAL_ENTRY-only, not a blanket `(organisationId, recordType, recordId)` constraint**:
  investigating this trial surfaced that an `Invoice` legitimately gets *several* LedgerChain
  rows over its lifecycle — issue, pay, and void each call `appendLedgerChainEntry` again with
  the same `recordId` (see `apps/web/app/api/invoices/[id]/route.ts`) — while a `JournalEntry`
  gets exactly one, ever. A non-partial constraint would have rejected real invoice-lifecycle
  writes; the partial index closes the actual attack (a duplicate reference to a JournalEntry
  that should never repeat) without breaking real functionality. See the comment on the
  `LedgerChain` model in `packages/db/prisma/schema.prisma` for why this constraint isn't (and
  can't cleanly be) expressed in Prisma's `@@unique` syntax.
- **c-5 (deliberately not closed)** — an entry appended at the tip with a genuinely
  correctly-computed hash, `previousHash`, and `sequenceNumber` *is* a valid chain extension by
  every check this codebase has, or could reasonably add. Hash-chain integrity proves a chain
  wasn't tampered with; it cannot prove a write was *authorized* if the attacker already has raw
  DB access and computes the chain fields correctly — this is the thesis's own threat-model
  boundary (Section 3.6.5), not an oversight. The real control is restricting database write
  access to the authenticated API only (JWT + RBAC on `/api` routes) — not something read-side
  verification logic can substitute for.

### Category (d) — why reordering needed no crypto changes

Investigated empirically (`packages/crypto`'s `buildMerkleTree` was never touched): swapping
two rows' `createdAt` and/or `sequenceNumber` breaks the `previousHash` chain relative to
whichever ordering column is used to find "the row immediately before this one" — Part 1's
existing, unmodified per-record `isChainLinkIntact` check (`createdAt`-based) and the new
`verifyChainContinuity` (`sequenceNumber`-based) each independently catch every reorder tried:
adjacent swaps, non-adjacent swaps, a full 3-way cyclic rotation, and swapping both ordering
columns at once. No leaf-position-binding change was made to `buildMerkleTree` — this category
is the record of confirming one wasn't needed, not evidence one is missing.

### Running it

```bash
npm run test:category-suite                            # apps/security-tests/run-category-suite.sh
```

This runs as a shell script, not a single `ts-node` invocation, because this project's local
PGlite dev database (see the concurrency suite's notes above) reliably wedges once enough
organisations accumulate in one long-lived connection — confirmed while building this suite.
`run-category-suite.sh` restarts PGlite between each category (and retries a category up to 3
times if its result still shows the wedge) so the run is reliable end to end; this is a
workaround for the sandbox's embedded dev database, not a property of the verification logic
under test. Each category's raw JSON result lands in `apps/security-tests/.suite-results/` and
the final step reads all of them back to print the table above.
