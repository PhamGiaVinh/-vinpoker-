# Testing & Monitoring Guide

This project ships with three layers of QA: unit tests (Vitest), end-to-end tests
(Playwright), and runtime monitoring (Web Vitals + optional Sentry).

---

## 1. Unit tests (Vitest)

Run all unit tests:

```bash
npm test          # one-shot
npm run test:watch
```

Test files live in:
- `tests/**/*.test.ts` — pure logic (e.g. `tests/calculations.test.ts` covers
  bankroll & variance math).
- `src/**/__tests__/*.test.ts` — module-local tests
  (e.g. `src/lib/__tests__/stakingMath.test.ts`).

Unit tests run automatically in CI on every push and PR to `main`.

---

## 2. End-to-end tests (Playwright)

E2E tests verify real user flows in a real browser. They require a test user
in Lovable Cloud.

### One-time setup

1. **Install Playwright browsers** (only once per machine):

   ```bash
   npx playwright install --with-deps chromium
   ```

   `npm install` also tries to install chromium automatically via the
   `postinstall` script, but `--with-deps` (system libraries) requires sudo
   and may need to be run manually on Linux.

2. **Create a test user in Lovable Cloud:**
   - Open the project's backend (Lovable → Cloud → Authentication).
   - Click **Add user** and create one with a known email/password.
     Make sure the user is email-confirmed (auto-confirm is fine for test users).
   - Alternatively, sign up through the app's `/auth` page and confirm via the
     verification link.

3. **Set credentials locally:**

   ```bash
   cp .env.example .env.local
   # then edit .env.local and fill E2E_EMAIL / E2E_PASSWORD
   ```

### Running E2E tests

```bash
npm run dev          # in one terminal (or let Playwright start it)
npm run test:e2e     # in another terminal
```

Playwright will reuse a running dev server on port 8080 if it's already up,
otherwise it starts one automatically (see `playwright.config.ts`).

### Running E2E in CI

The `.github/workflows/ci.yml` workflow has an `e2e` job that runs Playwright
**only when both** repo secrets are set:

| Secret         | Where to set                                                |
| -------------- | ----------------------------------------------------------- |
| `E2E_EMAIL`    | GitHub repo → Settings → Secrets and variables → Actions    |
| `E2E_PASSWORD` | (same)                                                      |

If either is missing, the job logs a friendly skip message and exits cleanly —
it will never block a PR.

---

## 3. Health check endpoint

Edge function `health` returns `200 { status: "ok" }` when the database is
reachable. Point an uptime monitor (UptimeRobot, BetterStack, etc.) at:

```
https://<project-ref>.supabase.co/functions/v1/health
```

with header `apikey: <SUPABASE_ANON_KEY>`. Recommended interval: 1–5 minutes.

---

## 4. Real User Monitoring

### Web Vitals (always on)
LCP / INP / CLS / FCP / TTFB are reported from every real user session to the
`web_vitals_events` table via the `report-vitals` edge function. Super-admins
can view aggregates at `/admin/web-vitals`.

### Sentry (optional)
The Sentry SDK is installed and **lazy-loaded only in production when
`VITE_SENTRY_DSN` is set**. Dev builds and unconfigured prod builds pay zero
runtime cost.

To enable:

1. Create a project at [sentry.io](https://sentry.io) → copy the DSN from
   *Project Settings → Client Keys (DSN)*.
2. Set `VITE_SENTRY_DSN` as a **Build Secret** in Lovable
   (Workspace Settings → Build Secrets) so it's baked into production builds.
   For local prod testing, add it to `.env.local`.

---

## 5. Bundle analysis

```bash
npm run analyze
# then open dist/stats.html
```

Generates a treemap showing chunk sizes (gzip + brotli). Useful for spotting
unexpectedly heavy dependencies in route chunks.
