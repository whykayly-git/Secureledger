# SecureLedger

A cloud accounting application with a cryptographic integrity layer: every ledger-affecting
write is SHA-256 hash-chained inline, and an independent, always-on **Checkpoint Service**
periodically batches the chain into a Merkle tree and signs the root with ECDSA (P-256).
Anyone can independently verify a record's inclusion using only the public key — the web
application never signs anything.

## Architecture

```
/apps/web                 Next.js 14 (App Router) — frontend + accounting/auth/verification API
/apps/checkpoint-worker    Standalone, always-on Node.js process — owns the ECDSA private key
/apps/security-tests       Tamper-detection security test suite (see apps/security-tests/README.md)
/packages/db               Shared Prisma schema + generated client (used by all apps)
/packages/crypto           Shared hash-chaining, Merkle-tree, and signing/verification primitives
/packages/ledger           Shared hash-chain write path (used by apps/web and apps/security-tests)
/packages/verification     Shared verification logic (used by apps/web and apps/security-tests)
```

The web app and the checkpoint worker are **independent processes** that only share a
PostgreSQL database and the `packages/db` / `packages/crypto` code. The web app can be
horizontally scaled (stateless JWT auth, no server-side sessions); the worker runs as a
single always-on process with its own schedule, resources, and the only copy of the ECDSA
private key.

## Prerequisites

- Node.js 18.18+
- Docker + Docker Compose (for the full stack), or a local PostgreSQL instance

## 1. Local setup

```bash
npm install
npm run prisma:generate
cp .env.example .env
cp apps/web/.env.example apps/web/.env.local
cp apps/checkpoint-worker/.env.example apps/checkpoint-worker/.env
cp packages/db/.env.example packages/db/.env
```

Generate an ECDSA key pair for checkpoint signing:

```bash
node scripts/generate-checkpoint-keys.js
```

Copy the `CHECKPOINT_PUBLIC_KEY=...` line into `apps/web/.env.local` (and `.env` for
docker-compose), and the `CHECKPOINT_PRIVATE_KEY=...` line into
`apps/checkpoint-worker/.env` (and `.env`) **only**. Set a random `JWT_SECRET` in both
`.env` and `apps/web/.env.local`.

**Verify the private key never reaches the web app:**

```bash
grep -ri "CHECKPOINT_PRIVATE_KEY" apps/web/.env.local apps/web/package.json apps/web/**/*.ts
# should return nothing — apps/web only ever reads CHECKPOINT_PUBLIC_KEY
```

## 2. Running Prisma migrations

```bash
npm run prisma:migrate:dev
```

(In CI/production, apply already-generated migrations non-interactively with `npm run prisma:migrate`, which the `migrate` Docker Compose service also runs.)

This creates the Postgres schema (`User`, `Organisation`, `Account`, `JournalEntry`,
`JournalLine`, `Invoice`, `LedgerChain`, `LedgerCheckpoint`) shared by both processes.

## 3. Starting all three services

### With Docker Compose (recommended)

```bash
docker compose up --build
```

This brings up `db` (Postgres), runs `migrate` once to completion, then starts `web`
(http://localhost:3000) and `checkpoint-worker` (health check on http://localhost:8081/health).
The worker's `depends_on: migrate: condition: service_completed_successfully` means it
will not start until migrations have run.

### Without Docker

In three terminals:

```bash
# 1. Postgres must already be running locally, matching DATABASE_URL
npm run prisma:migrate:dev

# 2. Next.js app (also builds packages/db and packages/crypto first)
npm run dev:web

# 3. Checkpoint worker (also builds packages/db and packages/crypto first)
npm run dev:worker
```

## 4. Watching the checkpoint worker's logs

Docker Compose:

```bash
docker compose logs -f checkpoint-worker
```

Local dev, the worker logs directly to stdout, e.g.:

```
[2026-01-01T00:00:00.000Z] [checkpoint-worker] Checkpoint cycle completed for organisation {"organisationId":"...","reason":"interval","recordsProcessed":12,"merkleRoot":"...","rangeStart":"...","rangeEnd":"..."}
```

Each cycle logs, per organisation: records processed, the resulting Merkle root, and the
time range covered. Check liveness any time with:

```bash
curl http://localhost:8081/health
```

## 5. Manually verifying a transaction end-to-end (demo script)

1. Register an organisation at `/register`.
2. Go to **Chart of Accounts** and create at least: an ASSET account (e.g. `1000 Cash`),
   an ASSET account for receivables (e.g. `1100 Accounts Receivable`), an INCOME account
   (e.g. `4000 Sales Revenue`), and an EXPENSE account (e.g. `5000 Office Supplies`).
3. Go to **Journal Entries → New Entry**, post a balanced entry (e.g. debit `5000` $50,
   credit `1000` $50). This write is hash-chained inline, inside the same DB transaction,
   in well under 300ms.
4. Go to **Verification**, paste the journal entry's ID (visible in the Audit Log or the
   URL after creating it) and click **Verify**. Immediately after posting, it will show
   **Pending checkpoint** — the entry exists and is hash-chained, but the independent
   signing service hasn't batched it yet.
5. Wait for the checkpoint worker's next cycle (or lower `CHECKPOINT_POLL_INTERVAL_MS` /
   `CHECKPOINT_MAX_INTERVAL_MS` for the demo, e.g. to `10000` / `30000`), and watch its
   logs for a `Checkpoint cycle completed` entry.
6. Verify the same record again: the result now shows **Verified**, with the Merkle root,
   the ECDSA signature validity, the inclusion proof path, and the checkpoint's time range
   — all reconstructed and checked using only the public key.
7. As an `AUDITOR` role user, visit **Audit Log** and use **Export batch verification
   (CSV)** to verify every ledger entry for the organisation at once.

## Testing

```bash
npm test
```

Runs Jest for:
- `packages/crypto`: hash-chaining determinism, Merkle tree construction and inclusion
  proofs, ECDSA sign/verify.
- `apps/checkpoint-worker`: checkpoint payload construction (Merkle root + signature) and
  the interval/batch-threshold scheduling decision logic.

Both of the above are DB-free unit tests. Separately, `apps/security-tests` is a
DB-backed **tamper-detection security test suite** that directly corrupts already-committed
rows (bypassing the app's API, simulating an attacker with raw DB access) and asserts the
real verification logic catches it — see [apps/security-tests/README.md](apps/security-tests/README.md)
for how to run it and its current, honestly-reported detection rate:

```bash
cp apps/security-tests/.env.example apps/security-tests/.env   # set DATABASE_URL
npm run test:tamper-detection
```

## Non-functional notes

- Hash-chaining runs inline inside the same Prisma transaction as the accounting write —
  no Merkle work happens there, keeping it well under the 300ms budget.
- Verification only scans the rows in the *specific checkpoint batch* a record belongs to
  (bounded by the worker's batch size), never the whole chain, keeping proofs logarithmic
  and responses under the 2s target regardless of total ledger size.
- The web app is fully stateless: sessions are JWT-only (httpOnly cookie), so it can be
  scaled horizontally behind a load balancer without sticky sessions.
- The checkpoint worker's poll interval, max checkpoint interval, and batch threshold are
  all configured independently via its own environment variables, with no changes to the
  web app required.
