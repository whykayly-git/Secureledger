# Deploying SecureLedger on Render

Three pieces run together: the **web app**, the **checkpoint worker** (must stay on 24/7), and a **Postgres database**. `render.yaml` defines all three.

> Tested on Render on 9 November 2026. The web and worker images built, the migrations ran against the Render Postgres database, and an entry posted through the live web app was checkpointed by the worker and showed **Verified** on the Verification page. Not tested: Docker Compose on a local machine (Docker isn't installed on the dev machine), the performance of the deployed instance, and running more than one web instance. The first deploy attempts failed for the reasons in "Problems met on the first deploys" below.

## 1. Generate production secrets (on your own computer)

```bash
node scripts/generate-checkpoint-keys.js
```

Copy the two base64 lines it prints:

- `CHECKPOINT_PUBLIC_KEY` goes to the **web** service only.
- `CHECKPOINT_PRIVATE_KEY` goes to the **worker** service only.

`LEDGER_AUTH_KEY` is a third secret, a random string that goes to **both** the web and worker services with the **same value**. Generate it with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. It authenticates every ledger row, so someone with only database access cannot forge a row that passes verification. Never put it anywhere the database can read it, and do not change it later without a plan: rows tagged with the old value would fail verification.

Do not reuse your local keys, do not commit these, and keep the private key out of the web service. `JWT_SECRET` is generated for you by Render.

## 2. Push the repo to GitHub

`render.yaml` must be on the branch Render deploys (`main`).

## 3. Create the Blueprint

1. Render dashboard, **New**, **Blueprint**, connect GitHub, pick `Secureledger`.
2. Render reads `render.yaml` and lists: `secureledger-web`, `secureledger-checkpoint-worker`, `secureledger-db`.
3. It asks for the values marked `sync: false`:
   - `CHECKPOINT_PUBLIC_KEY` (web): paste the public key line.
   - `LEDGER_AUTH_KEY` (web and worker): paste the same value in both.
   - `PLATFORM_ADMIN_EMAILS` (web): your admin email(s), comma-separated.
   - `CHECKPOINT_PRIVATE_KEY` (worker): paste the private key line.
   - `MAIL_API_KEY`, `MAIL_FROM` and `APP_BASE_URL` (web): for password reset email. You can leave them blank now and fill them in later (see "Password reset email" below). Until then, password reset is unavailable.
4. Click **Apply**. If Render rejects a plan name in `render.yaml`, choose the plan in the dashboard instead.

Region is set to Frankfurt (usually closest to West Africa). Change `region` in `render.yaml` before applying if you prefer another.

## 4. Database migrations

The web service runs `prisma migrate deploy` before each deploy (`preDeployCommand`), calling the Prisma CLI directly with absolute paths. While the very first deploy is still running, the worker may log `The table public.organisations does not exist`. That is harmless: the worker started before the migration finished, and the errors stop once the tables exist. If your plan or Render rejects `preDeployCommand`, run it once from your computer instead:

```bash
DATABASE_URL="<External Database URL from the Render dashboard>" npx prisma migrate deploy --schema packages/db/prisma/schema.prisma
```

## 5. First login

The production database starts empty.

1. Open the web service URL and go to **/register** to create your organisation. The first user becomes organisation admin.
2. Register with the same email you put in `PLATFORM_ADMIN_EMAILS` to get the **Platform Admin** link.

## Password reset email

In production the app never shows a reset link on screen: anyone who knew an account's email address could use it to take over the account. It sends the link to the account's address instead. Until email is set up, the "Forgot password" page tells the person to contact whoever runs the system, and no reset link is created. The platform admin console can still reset a password.

Set it up once with a provider that has a free tier. The app sends over HTTPS, not SMTP (Render blocks SMTP on some plans). **Brevo** is the easiest because it lets you send from a single verified address with no domain of your own.

1. Create a free account at brevo.com.
2. In Brevo, add and verify a **sender**: the address the emails will come from. Brevo emails a confirmation link to it. A mailbox on your own domain is delivered more reliably than a free Gmail address, which can land in spam.
3. In Brevo, open **SMTP & API**, then **API keys**, and generate a key. Copy it once.
4. In Render, open `secureledger-web`, then **Environment**, and add:
   - `MAIL_PROVIDER` = `brevo`
   - `MAIL_API_KEY` = the key from step 3 (a secret: never paste it into chat or commit it)
   - `MAIL_FROM` = the verified sender address from step 2
   - `APP_BASE_URL` = the public address of the app, for example `https://secureledger-web.onrender.com` (use your custom domain if you add one)
5. Save. Render redeploys the web service.
6. Test: on the login page, choose **Forgot password**, enter the email of an account you own, and check that the email arrives and the link opens the reset page. The page itself will only say that a link has been sent; it never shows the link and never says whether the address is registered.

If the email does not arrive, check spam, check that the sender is verified in Brevo, and look at the web service logs for `Password reset email failed`. `Resend` is also supported (`MAIL_PROVIDER=resend`), but it only sends to addresses beyond your own once you have verified a domain.

## 6. Custom domain (optional)

Web service, **Settings**, **Custom Domains**. Render provides HTTPS automatically.

## 7. Verify after the first deploy

- Web service logs show a successful start, and `/login` loads.
- You can register, log in, and stay logged in across page loads (confirms `JWT_SECRET` works at runtime).
- Post a journal entry. Dashboard "Pending Checkpoint" should return to 0 within about 30 seconds (confirms the worker is running and signing).
- Open Verification for that entry and confirm it shows **Verified**.
- Worker logs show "Checkpoint cycle completed", then "Scheduled verification completed with no problems".
- At start-up the worker logs `"rowAuthentication":"on"`. If it says `OFF`, `LEDGER_AUTH_KEY` is missing on the worker.

If Verification shows **Failed**: `signature_invalid` means the web service's `CHECKPOINT_PUBLIC_KEY` does not match the worker's private key (set both again from one new pair), and `auth_tag_invalid` means `LEDGER_AUTH_KEY` differs between the web service and the worker.

## Problems met on the first deploys

These were found by deploying, and are fixed in the repository. They are listed so they are not repeated.

- **Build stage missing the root `package.json`.** Both images failed at `npm run build --workspace=...` with "Could not read package.json". Each Dockerfile's build stage now copies `package.json` and `package-lock.json`.
- **No OpenSSL in the Alpine image.** Prisma warned that it could not detect libssl and would have generated the wrong query engine. Both images now run `apk add --no-cache openssl`.
- **Pre-deploy migration exited with status 128 and no output.** The command was changed from `cd /repo && npx prisma migrate deploy ...` to a direct call to the Prisma CLI with absolute paths, and the next deploy passed. The root cause of the original exit was not confirmed.

## 8. Backups and costs

- The ledger is your accounting record. Keep Postgres on a paid plan and confirm backup retention in the database's dashboard page.
- You pay for three things: web service, worker service, database. Check current prices on Render's pricing page.
- Free-tier web services sleep and free databases expire, so don't use free plans for the worker or database.

## Checkpoint timing

The worker polls every 10 seconds and checkpoints an organisation when 500 entries are pending or 30 seconds have passed since its last checkpoint. Raise `CHECKPOINT_MAX_INTERVAL_MS` on the worker to produce fewer, larger checkpoints.
