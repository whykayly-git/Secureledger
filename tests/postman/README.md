# SecureLedger Postman/Newman Integration Tests

Covers every route grouping — authentication, accounts, journal entries, invoices,
verification, reports, and audit log — with a success case and at least one
expected-failure case per endpoint (unbalanced journal entry, unauthenticated request,
forged/invalid JWT, and a role attempting an action it isn't authorised for).

## Running it

The app **and** its database must already be running (this hits real HTTP endpoints, not
mocks):

```bash
npm run dev:db      # if using the local PGlite dev DB — see root README
npm run dev:worker   # optional, not required for these tests
npm run dev:web
```

Then, from the repo root:

```bash
npm run test:integration
```

This runs `newman run tests/postman/secureledger.postman_collection.json -e tests/postman/secureledger.postman_environment.json`
headlessly and prints a pass/fail summary per request, e.g.:

```
┌─────────────────────────┬────────────────────┬───────────────────┐
│                         │           executed │            failed │
├─────────────────────────┼────────────────────┼───────────────────┤
│              iterations │                  1 │                 0 │
│                requests │                 35 │                 0 │
│            test-scripts │                 35 │                 0 │
│              assertions │                 54 │                 0 │
└─────────────────────────┴────────────────────┴───────────────────┘
```

By default it targets `http://localhost:3000` (`baseUrl` in the environment file). Point it
elsewhere with `-e` pointing at a copy of the environment file with `baseUrl` changed, or
`--env-var baseUrl=https://your-host`.

Each run registers a fresh, uniquely-emailed test organisation
(`qa+<timestamp>@example.com`), so the collection is safe to run repeatedly against the same
database without manual cleanup or collisions.

## How auth is handled

The app uses real httpOnly cookie sessions, not `Authorization: Bearer` headers. Newman
maintains its own cookie jar across requests within one run, so logging in once via
`1. Authentication / Login — success` carries the session automatically into every later
folder — no manual token-passing needed for the success paths.

The **one gotcha**: once the jar holds a valid session cookie for a host, simply adding a
conflicting `Cookie` header to a single request does **not** reliably override it — Newman
still attaches the jar's real cookie alongside it. The only reliable way to test
"unauthenticated" or "forged token" behavior against an already-logged-in host is to mutate
the jar itself via the `pm.cookies.jar()` API. That's why every negative auth test is grouped
into the final **`8. Unauthenticated & Invalid-Session Access`** folder, with a
folder-level pre-request script that clears the session cookie from the jar before each
request in it (and one request within it that instead *sets* the jar to a forged token, to
test that specific case). Keeping this folder last means nothing after it needs the session
restored.

## Structure

| Folder | Coverage |
|---|---|
| 1. Authentication | register, duplicate-email, logout, login (success + wrong password), `/auth/me` |
| 2. Accounts | create (success + missing fields), list, update |
| 3. Journal Entries | post (success + unbalanced), list |
| 4. Invoices | create (success + missing fields), issue, issue-twice (conflict), pay, list |
| 5. Verification | verify a real record, verify an unknown record (404) |
| 6. Reports | trial balance, income statement |
| 7. Audit Log | list, batch-verification export as a non-AUDITOR role (403) |
| 8. Unauthenticated & Invalid-Session Access | every protected endpoint with no session, plus a forged-JWT case |

Note on the RBAC failure test: the Postman test user registers as `ACCOUNTANT` (there's no
self-service way to become `AUDITOR` through the API), so `Export Batch Verification` is
exercised as an expected-failure (403) case only — proving the real RBAC gate rejects an
unauthorised role, which is the property that matters.
