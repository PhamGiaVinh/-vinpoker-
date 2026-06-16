# GE-2O — Phase D Readiness Checklist / Runbook (docs-only, owner-gated)

**Status: CHECKLIST ONLY. Nothing is applied, deployed, scheduled, enabled, or flipped.**
Online poker is **fully DARK**. This document is the go/no-go checklist a human follows
*before* a future, owner-gated **Phase D enable drill**. Producing it changes **no** code,
migration, workflow, flag, cron, or DB state — and requires **no** live DB access and **no**
secrets.

This is the gate *before* the gate: it confirms the runtime is in the expected dark state,
lists every Phase D prerequisite, and lays out the deploy / cron / kill-switch / rollback /
drill plan so that — once the owner sends the exact phrase and the disposable logins exist —
the drill can run from a known-clean baseline.

Base: `origin/main`. Companions (read alongside): `GE2_PHASE_D_READINESS.md`,
`GE2_ENABLEMENT_RUNBOOK.md`, `GE2L_APPLY_ORDERING_READINESS.md`, `GE2M_APPLY_PREFLIGHT.md`,
`GE2K_TABLE_RUNNER_IMPLEMENTATION.md`, `GE2H_TABLE_RUNNER_AUTO_DEAL_SPEC.md`.
Read-only self-checks: `scripts/ge2-readiness-report.mjs`, `scripts/ge2-table-runner-dryrun.mjs`.

> ⛔ **This doc does NOT enable anything.** Applying ≠ deploying ≠ scheduling ≠ enabling.
> Phase D (enable) stays blocked behind the §3 gates. Project ref: `orlesggcjamwuknxwcpk`.

---

## 1. Current dark state (after GE-2N apply, 2026-06-16)

GE-2N applied the three engine function bodies live (single-file Management-API apply); the
runtime stayed dark. Confirm this baseline before Phase D:

| Item | Expected | How to re-confirm (read-only) |
|---|---|---|
| `op_submit_action` body | GE-2I (settlement writeback present) | `pg_get_functiondef` contains `IF p_new_state->>'status' = 'complete' THEN UPDATE … online_poker_seats … s.user_id = hs.user_id` |
| `op_stand_up` body | GE-2J (folded guard) | guard status set = `('active','folded','allin')` |
| `op_run_due_table_ticks` | GE-2K, **disabled** | call returns `{"outcome":"disabled","tables":[]}` |
| `op_table_runner_diag` | GE-2K, **disabled** | call returns `{"outcome":"disabled","tables":[]}` |
| `online_poker_config.enabled` | **false** | `SELECT enabled FROM online_poker_config` |
| `FEATURES.onlinePoker` | **false** | `src/lib/featureFlags.ts` |
| `RUNTIME_LIVE` | **false** | `src/lib/onlinePoker/types.ts` |
| `online-poker-table-runner` Edge | **not deployed** | absent from `supabase functions list` |
| `online-poker-timeout-sweep` Edge | **not deployed** | absent from `supabase functions list` |
| online-poker cron | **none** | `SELECT * FROM cron.job` → no `op-table-runner` / `op-timeout-sweep` |
| `schema_migrations` | **unchanged** (max `20260820000002`) | function bodies are ahead of the ledger (known live drift) — intended |

> `online-poker-action` Edge **is** deployed (since GE-2D) but is dark behind its own auth +
> the `op_is_enabled()=false` gate — expected, not a blocker.

**Triple dark gate:** `enabled=false` **AND** `onlinePoker=false` **AND** `RUNTIME_LIVE=false`.
All three must be true to start, and the FE pair stays false until the very last Phase D step.

---

## 2. Phase D readiness — top-level go/no-go

Phase D may begin **only** when every box below is checked. Any unchecked box ⇒ **STOP**.

- [ ] §1 dark baseline re-confirmed live (read-only, rotated creds via keyring — not chat)
- [ ] §3 gate 1: secrets rotated + present locally (no values in chat/repo/logs)
- [ ] §3 gate 2: **two disposable test logins** exist in local env/keyring (see §3 definition)
- [ ] §3 gate 3: owner has sent the **exact phrase** `Proceed with G4 DB enable drill`
- [ ] §10 no-real-users rule acknowledged (disposable accounts + play-money only)
- [ ] §11 stop conditions all clear (no unexpected flag/cron/edge/migration state)

---

## 3. Required Phase D gates (all three mandatory)

### Gate 1 — Rotated secrets confirmed
- DB password rotated and present locally (e.g. `scripts/.env.test.local` → `SUPABASE_DB_PASSWORD`).
- All previously-exposed tokens remain rotated: Supabase Mgmt PAT, service secret, Vercel token,
  any AI/Telegram tokens, DB password.
- **Never** paste new secret values into chat, PRs, docs, or logs. If a value appears anywhere,
  treat it as exposed → rotate it.

### Gate 2 — Two disposable test logins present
The drill needs **two** logins to play both seats of a heads-up hand. They must be **disposable**:

**A login counts as "disposable" only if ALL of these hold:**
- It is a **throwaway** account created for the drill (not anyone's real/daily account).
- It has **no** elevated role: not `super_admin`, not club owner (`clubs.owner_id`), not admin,
  not finance, not dealer/operator — a plain player account.
- It is tied to **play-money only** — no real-money wallet, no production chip/ledger linkage.
- Losing/rotating its password has **zero** production impact.

**NOT disposable (do NOT use — STOP if provided):** the owner's own login, any club-owner
account (`clubs.owner_id`), any organizer/admin/finance account, any account that can see the
Finance dashboard or operator screens. Using such an account would violate §10.

> Store the two logins **by reference** in `scripts/.env.ge2-drill.local` (gitignored; template
> `scripts/.env.ge2-drill.example`) alongside `SUPABASE_URL` / `SUPABASE_ANON_KEY`. **No service
> role key.** This doc and all drill output reference them **by name only, never by value.**

### Gate 3 — Exact owner phrase
The owner must send, verbatim: **`Proceed with G4 DB enable drill`**.
`scripts/ge2-readiness-report.mjs` only emits `proceed` on an exact match (fail-closed).
No phrase ⇒ no enable. (No phrase is needed for *this* checklist or for any read-only re-confirm.)

---

## 4. Edge deploy plan (Phase D — not now)

Both runner edges are **source-only** and **absent from the deploy workflow's fixed 7-fn list**
(`process-swing`, `assign-dealer`, `close-table`, `swing-metrics`, `telegram-bot`,
`send-shift-schedule`, `td-ai-assistant`) → a normal push **never** deploys them. They deploy
**manually**, owner-gated, in Phase D:

| Edge function | Source | Deploy command (Phase D) |
|---|---|---|
| `online-poker-timeout-sweep` | `supabase/functions/online-poker-timeout-sweep/index.ts` | `supabase functions deploy online-poker-timeout-sweep --no-verify-jwt` |
| `online-poker-table-runner` | `supabase/functions/online-poker-table-runner/index.ts` | `supabase functions deploy online-poker-table-runner --no-verify-jwt` |

**Order:** deploy the **timeout-sweep first** (an AFK player must never stall a table once humans
play), then the **table-runner**. Both authenticate by a shared cron secret (see §5); without the
secret each returns **401**, so deploying them while their secret is unset is itself a safe no-op.

Post-deploy read-only confirm: `supabase functions list` shows both ACTIVE; an unauthenticated
POST to each returns **401** (the function's own gate, proving the secret check is live).

---

## 5. Required secrets / GUCs (names only — never values)

Each runner reads a shared secret from **both** an Edge env var **and** a matching DB GUC; the
cron passes the GUC value as a `Bearer` header and the Edge compares it to its env var. Set the
**same random value** in both places (generated at Phase D, never written here).

| Edge function | Edge env var | DB GUC (same value) |
|---|---|---|
| `online-poker-timeout-sweep` | `OP_TIMEOUT_SWEEP_SECRET` | `app.op_timeout_sweep_secret` |
| `online-poker-table-runner` | `OP_TABLE_RUNNER_SECRET` | `app.op_table_runner_secret` |

Supporting GUC already referenced by the cron callers: `app.supabase_url` (falls back to the
public project URL if unset — not a secret).

**Rules:** generate values at Phase D; set via the dashboard / Management API / CLI secret channel;
**never** echo, commit, or doc them. While a secret GUC is unset, its cron caller logs + no-ops
(fail-safe) and its Edge refuses (401) — so a half-provisioned state is safe.

---

## 6. Cron plan (Phase D — create / verify / disable)

Two crons, **both created in Phase D only** (a normal migration push does **not** apply them):

| Cron job | Calls | Interval | Source / status |
|---|---|---|---|
| `op-timeout-sweep` | `op_run_timeout_sweep()` | `15 seconds` | `migrations/20260903000000_online_poker_timeout_sweep_cron.sql` — **authored, UNAPPLIED** |
| `op-table-runner` | `op_run_table_runner()` | ~5 s (tunable) | **not authored yet** — a separate Phase D migration authors `op_run_table_runner()` + `cron.schedule(...)` |

**Apply (Phase D, controlled single-file — NEVER `db push` / `deploy_db`):**
- Timeout-sweep: apply `20260903000000_…_cron.sql` as a single-file Management-API op (the GE-2N
  process). It `cron.unschedule`s any prior `op-timeout-sweep` then `cron.schedule`s it — idempotent.
- Table-runner: author `op_run_table_runner()` (SQL fn doing `net.http_post` to the runner edge
  with the `Bearer` GUC) + `cron.schedule('op-table-runner', …)`; apply single-file.

**Verify a cron exists:**
```sql
SELECT jobid, jobname, schedule, active FROM cron.job
WHERE jobname IN ('op-timeout-sweep','op-table-runner');
```
(Pre-Phase-D this MUST return zero rows — see §1 / §11.)

**Disable / drop a cron (stop new work, finish in-flight):**
```sql
SELECT cron.unschedule('op-table-runner');   -- stop auto-dealing; running hands finish
SELECT cron.unschedule('op-timeout-sweep');  -- stop the sweeper
```
Unscheduling is reversible (re-`schedule` to resume). It does **not** enable/disable the engine —
that is the master flag (§7).

---

## 7. Kill switch plan

Ordered by blast radius — the **master flag is the instant, no-redeploy kill**:

1. **Master kill (instant):** `UPDATE online_poker_config SET enabled = false;`
   → `op_is_enabled()=false` ⇒ `op_run_due_table_ticks` / `op_table_runner_diag` /
   `op_timeout_sweep` / every write RPC return `disabled`; the runner + sweeper edges no-op on
   their next tick. No redeploy, no cron change needed.
2. **Frontend stays dark:** `FEATURES.onlinePoker` and `RUNTIME_LIVE` remain **false** unless the
   owner explicitly flips them in a FE PR — this is the **last** Phase D step and is independent of
   the DB enable. The DB enable + drill happens entirely behind a dark UI.
3. **Stop dealing only:** `cron.unschedule('op-table-runner')` (§6) — existing hands complete; no
   new deals. (`op-timeout-sweep` likewise.)
4. **Neutralise an edge:** unset `OP_TABLE_RUNNER_SECRET` / `OP_TIMEOUT_SWEEP_SECRET` (or the GUC)
   → the edge refuses (401).

The runner has **no independent authority**: with the master flag off it does nothing, regardless
of cron/edge/secret state.

---

## 8. Rollback plan (Phase D)

**De-escalate first (flags/cron), then revert function bodies if truly needed.**

1. **Disable config first:** `UPDATE online_poker_config SET enabled = false;` (master kill, §7).
2. **Drop crons:** `cron.unschedule('op-table-runner')`, `cron.unschedule('op-timeout-sweep')` (§6).
3. **Undeploy / ignore edges:** an undeployed-or-secretless edge is inert; remove the secret/GUC so
   it 401s. (Edge undeploy is optional — with the master flag off it does nothing anyway.)
4. **Revert function bodies (only if required), reverse of GE-2N apply order — single-file
   Management-API apply of each rollback file:**

| Step | Rollback file | Effect |
|---|---|---|
| 1 | `docs/emergency_rollbacks/PRE_GE2K_20260911000000_op_run_due_table_ticks_rollback.sql` | DROP `op_run_due_table_ticks` + `op_table_runner_diag` |
| 2 | `docs/emergency_rollbacks/PRE_GE2J_20260908000000_op_stand_up_block_folded_midhand_rollback.sql` | restore `20260820000000` `op_stand_up` body |
| 3 | `docs/emergency_rollbacks/PRE_GE2I_20260907000000_op_submit_action_settlement_seat_writeback_rollback.sql` | restore `20260820000002` `op_submit_action` body |
| (full runtime) | `PRE_GE2C_20260820000000_*` (+ N2 `PRE_GE2C_N2_20260820000002_*`) | full GE-2C runtime revert |

> ⛔ Rollback is also **single-file Management-API only** — NEVER `db push`/`deploy_db`.

---

## 9. G4 drill cases (Phase D — run on a disposable table)

Run on **one disposable table** + the **two disposable logins**, UI still dark, behind the master
flag (flipped on only for the drill window). Existing harness:
`scripts/ge2-online-poker-drill.mjs` (Edge path) + `scripts/ge2-drill/sql/*` (service-role
adversarial path) + `scripts/ge2-table-runner-dryrun.mjs` (runner dry-run).

| # | Case | Expected | Harness ref |
|---|---|---|---|
| 1 | **Disabled-before-flag** | every RPC + runner + sweep return `disabled` while `enabled=false` | dry-run / `disabled-check` |
| 2 | **Idempotency replay** | replaying an action key returns the stored response, no second apply | drill `idempotency` |
| 3 | **Forbidden seat / action** | acting on a seat you don't own / out of turn → `forbidden` / `seat_not_in_hand` | drill `forbidden-seat` |
| 4a | **Chip conservation — PASS** | a valid action conserves Σ(stacks)+pot | drill `chip-conservation` |
| 4b | **Chip conservation — FAIL** | a tampered `p_new_state` is **rejected** | `sql/02_chip_conservation_fail.sql` |
| 5 | **Secrecy / no card leak** | a player reads only their own holes; opponents' holes never leak pre-showdown | `sql/04_secrecy_read.sql` |
| 6 | **race_lost / concurrency** | stale `state_version` → `race_lost`; never two hands/table (partial unique index) | `sql/03_race_lost.sql` |
| 7 | **Settlement writeback** (GE-2I) | on hand complete, final stacks land in `online_poker_seats.stack` | `sql/05_settlement_writeback.sql` |
| 8 | **Stand-up guard** (GE-2J) | a folded player can't leave mid-hand and over-cash-out | `sql/06_standup_guard.sql` |
| 9 | **Timeout sweep** | a hand past `act_deadline` auto-folds/checks; idempotent (no double action) | sweep edge + `op_timeout_sweep` |
| 10 | **Table runner auto-deal — disabled→enabled proof** | disabled: lister empty, no deal; enabled: deals next hand, button advances, stacks carry, no freeze; master kill stops it | `sql/07_table_runner.sql` + dry-run |

**Acceptance (GE-2H §19):** deal hand 1 → play to completion → **auto-deal hand 2** (button moved,
stacks carried) → timeout one player → sweep forces fold, runner deals on → **no table freeze** →
`enabled=false` → **runner + sweep both stop** → verify `hand_started`/`hand_complete` audit rows +
tick logs (counts only, no cards).

---

## 10. No-real-users rule (hard)

- **Disposable accounts only** (§3 gate 2). Never a real/owner/admin/finance/organizer account.
- **No production players.** The drill is a closed two-account heads-up on a disposable table only.
- **No real-money wallet / chip / ledger.** Play-money only; `online_poker_*` is isolated from
  production financial tables.
- **No public frontend flag.** `FEATURES.onlinePoker` / `RUNTIME_LIVE` stay false; the DB drill runs
  behind a dark UI. Flipping FE flags (closed alpha) is a **later, separate** owner decision.
- **No touching** Payroll / Tracker / Dealer Swing / Cashier / Finance / GTO during the drill.

---

## 11. Stop conditions (abort Phase D immediately if ANY is true)

- Either **disposable login is missing** — or a provided "test" login is actually an
  owner/admin/finance/organizer/production account (§3).
- The **exact phrase** `Proceed with G4 DB enable drill` has **not** been sent.
- **A flag is already ON unexpectedly** (`online_poker_config.enabled=true`, or
  `FEATURES.onlinePoker`/`RUNTIME_LIVE` true) without an owner decision.
- **A cron already exists unexpectedly** (`op-table-runner` / `op-timeout-sweep` present in
  `cron.job`) before the planned Phase D create.
- **An edge is already deployed unexpectedly** (`online-poker-table-runner` /
  `online-poker-timeout-sweep` present) without owner approval.
- **schema_migrations inconsistency beyond the known drift** (anything other than: live max
  `20260820000002`, GE-2I/2J/2K bodies applied-but-unregistered, the documented pending chain).
- A secret value appears in chat / repo / logs (→ rotate, then re-baseline).
- Live state does not match §1.

On any stop: do not apply / deploy / schedule / enable. Report the discrepancy and wait for the owner.

---

## 12. Verification (this GE-2O session)

- **Docs-only:** `git diff --name-only origin/main...HEAD` shows exactly one added file —
  `VinPoker/docs/online-poker/GE2O_PHASE_D_READINESS_CHECKLIST.md`.
- **No** migration / code / workflow / flag / `schema_migrations` change. **No** DB access required.
  **No** secret values printed or stored. Logins referenced by name only.
- Engine remains dark; nothing applied, deployed, scheduled, or enabled.

## 13. What this doc does NOT do

No DB apply · no `supabase db push` · no `deploy_db=true` · no `schema_migrations` edit · no Edge
deploy · no cron create · no flag flip (`online_poker_config.enabled` / `FEATURES.onlinePoker` /
`RUNTIME_LIVE`) · no Phase D drill · no real users · no business-ops files. It records readiness
knowledge only. **Phase D enable stays gated behind §3.**
