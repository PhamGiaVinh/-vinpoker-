# GE-2 Phase D — Readiness & Gate (owner-gated)

**Status: NOT STARTED. Online poker is fully DARK.** This document is the source-only
readiness pack for a *future* Phase D drill. Nothing here runs, enables, or deploys
anything. Phase D begins only in a dedicated, owner-approved session.

- Frontend gate: `FEATURES.onlinePoker = false`
- In-shell gate: `RUNTIME_LIVE = false` (`src/lib/onlinePoker/types.ts`)
- Runtime gate: `online_poker_config.enabled = false` (live DB, super_admin only)
- Project ref: `orlesggcjamwuknxwcpk`

Companion: `docs/engine/GE2_ENABLEMENT_RUNBOOK.md` (the full enablement sequence).
Self-check: `node scripts/ge2-readiness-report.mjs` (read-only PASS/FAIL).

---

## 1. Gate prerequisites (ALL required before any Phase D step)

Phase D stays **blocked** until every one of these is true:

1. **DB password rotated + present locally** in `scripts/.env.test.local`
   (`SUPABASE_DB_PASSWORD`). The old password was committed historically and MUST be
   rotated in the Supabase dashboard first.
2. **Two disposable test logins** present locally in `scripts/.env.ge2-drill.local`
   (`P1_EMAIL`/`P1_PASSWORD`, `P2_EMAIL`/`P2_PASSWORD`) plus `SUPABASE_URL` +
   `SUPABASE_ANON_KEY`. These are throwaway accounts — never real players.
3. **The owner sends the EXACT gate phrase:**

   ```
   Proceed with G4 DB enable drill
   ```

Until all three hold, GE-2 work is **review / docs / harness / prep only** — never
`enabled=true`, never flip `FEATURES.onlinePoker` / `RUNTIME_LIVE`, never touch the
production DB flag, no real users.

The readiness script enforces this **fail-closed**: it reports `PROCEED: NO` unless the
source pack passes **and** the prerequisites are present **and** the exact phrase is given.
The script enables nothing regardless — the phrase only flips a report line.

---

## 2. Dry-run checklist (safe while dark — proves the harness without enabling)

Run these now, repeatedly; none enables anything:

- [ ] `node scripts/ge2-readiness-report.mjs` → section A (source/dark) all ✅.
- [ ] `node --env-file=scripts/.env.ge2-drill.local scripts/ge2-online-poker-drill.mjs disabled-check`
      → unauthenticated `401`; every op `403 disabled`. Proves auth path + that nothing can act.
- [ ] Confirm Edge `online-poker-action` returns `403 {"error":"online poker is disabled"}`
      for a valid JWT (flag off) — no write reaches the runtime.
- [ ] Confirm `online-poker-timeout-sweep` edge is **not deployed** and cron migration
      `20260903000000` is **not applied** (`schema_migrations` max is `20260820000002`).

---

## 3. Phase D execution order (only after §1 gate — see runbook for full detail)

1. Deploy Edge `online-poker-action` (already dark-deployed) — verify `403 disabled`.
2. Flip DB flag ON: `UPDATE online_poker_config SET enabled=true;` (super_admin). **UI stays dark.**
3. Run the **G4 live drill** on a disposable table: idempotency replay · forbidden-seat ·
   race_lost · chip-conservation · hole-card secrecy.
4. **Wire the timeout sweep BEFORE real humans play:** deploy `online-poker-timeout-sweep`
   with `OP_TIMEOUT_SWEEP_SECRET`, set DB GUC `app.op_timeout_sweep_secret` to the same value,
   then apply cron migration `20260903000000` (controlled op — NOT via the deploy workflow).
5. Only if the drill PASSES → expose UI in a **separate** frontend PR
   (`FEATURES.onlinePoker=true` + `RUNTIME_LIVE=true`).

---

## 4. Rollback / disable checklist (instant, server-side)

| Scope | Action |
|---|---|
| **Master kill** | `UPDATE online_poker_config SET enabled=false;` → Edge returns `403`, RPCs refuse. No redeploy. |
| **Frontend off** | revert `FEATURES.onlinePoker` / `RUNTIME_LIVE` to `false`, redeploy. |
| **Edge off** | `supabase functions delete online-poker-action` (optional; flag-off already neutralises it). |
| **Timeout sweep off** | unschedule the cron job; the sweep edge is inert without the GUC secret. |
| **Runtime rollback** | `docs/emergency_rollbacks/PRE_GE2C_20260820000000_*` (+ N2 `PRE_GE2C_N2_20260820000002_*`). |

Kill switch on ANY drill failure: `UPDATE online_poker_config SET enabled=false;` immediately,
then fix and re-drill. Never expose the UI on a failed drill.

---

## 5. What NOT to do (until §1 gate is satisfied in a dedicated session)

- Do **NOT** flip `online_poker_config.enabled`, `FEATURES.onlinePoker`, or `RUNTIME_LIVE`.
- Do **NOT** `supabase db push`, do **NOT** use `deploy_db=true`, do **NOT** edit `schema_migrations`.
- Do **NOT** apply the timeout-sweep cron migration or create a live cron job.
- Do **NOT** deploy the timeout-sweep edge or set its secret/GUC.
- Do **NOT** link any `online_poker_*` write to cashier / payroll / staking / real wallet — **play chips only**.
- Do **NOT** point the drill at a real player's hand — disposable table + throwaway logins only.
- Do **NOT** print, commit, or paste secret values (DB password, service-role key, tokens). If one
  leaks, report it and rotate immediately.

---

## 6. Invariants (always)

- **Play-money only**; zero links to real money / business-ops modules.
- **Server-authoritative**; the client sends intent, the engine (in the Edge) decides
  cards/winner/pot/chips.
- **Hole-card secrecy**; public `hands.state` never carries `deck`/`holeCards`.
- **Closed alpha**; expose to a small known group first, widen only on explicit owner approval.
