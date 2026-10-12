# Deploying SecureLedger on Render

Three pieces run together: the **web app**, the **checkpoint worker** (must stay on 24/7), and a **Postgres database**. `render.yaml` defines all three.

> Not yet tested: Docker isn't installed on the dev machine, so the Render build and `prisma migrate deploy` against real Postgres have not been run end to end. Do the checks in step 7 after the first deploy.

## 1. Generate production secrets (on your own computer)

```bash
node scripts/generate-checkpoint-keys.js
```

Copy the two base64 lines it prints:

- `CHECKPOINT_PUBLIC_KEY` goes to the **web** service only.
- `CHECKPOINT_PRIVATE_KEY` goes to the **worker** service only.

Do not reuse your local keys, do not commit these, and keep the private key out of the web service. `JWT_SECRET` is generated for you by Render.

## 2. Push the repo to GitHub

`render.yaml` must be on the branch Render deploys (`main`).

## 3. Create the Blueprint

1. Render dashboard, **New**, **Blueprint**, connect GitHub, pick `Secureledger`.
2. Render reads `render.yaml` and lists: `secureledger-web`, `secureledger-checkpoint-worker`, `secureledger-db`.
3. It asks for the values marked `sync: false`:
   - `CHECKPOINT_PUBLIC_KEY` (web): paste the public key line.
   - `PLATFORM_ADMIN_EMAILS` (web): your admin email(s), comma-separated.
   - `CHECKPOINT_PRIVATE_KEY` (worker): paste the private key line.
4. Click **Apply**. If Render rejects a plan name in `render.yaml`, choose the plan in the dashboard instead.

Region is set to Frankfurt (usually closest to West Africa). Change `region` in `render.yaml` before applying if you prefer another.

## 4. Database migrations

The web service runs `prisma migrate deploy` before each deploy (`preDeployCommand`). If your plan or Render rejects `preDeployCommand`, run it once from your computer instead:

```bash
DATABASE_URL="<External Database URL from the Render dashboard>" npx prisma migrate deploy --schema packages/db/prisma/schema.prisma
```

## 5. First login

The production database starts empty.

1. Open the web service URL and go to **/register** to create your organisation. The first user becomes organisation admin.
2. Register with the same email you put in `PLATFORM_ADMIN_EMAILS` to get the **Platform Admin** link.

## 6. Custom domain (optional)

Web service, **Settings**, **Custom Domains**. Render provides HTTPS automatically.

## 7. Verify after the first deploy

- Web service logs show a successful start, and `/login` loads.
- You can register, log in, and stay logged in across page loads (confirms `JWT_SECRET` works at runtime).
- Post a journal entry. Dashboard "Pending Checkpoint" should return to 0 within about 30 seconds (confirms the worker is running and signing).
- Open Verification for that entry and confirm it shows **Verified**.
- Worker logs show "Checkpoint cycle completed".

## 8. Backups and costs

- The ledger is your accounting record. Keep Postgres on a paid plan and confirm backup retention in the database's dashboard page.
- You pay for three things: web service, worker service, database. Check current prices on Render's pricing page.
- Free-tier web services sleep and free databases expire, so don't use free plans for the worker or database.

## Checkpoint timing

The worker polls every 10 seconds and checkpoints an organisation when 500 entries are pending or 30 seconds have passed since its last checkpoint. Raise `CHECKPOINT_MAX_INTERVAL_MS` on the worker to produce fewer, larger checkpoints.
