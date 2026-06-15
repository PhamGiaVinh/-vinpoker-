# GE-2L — Apply Ordering & Readiness Plan (plan only, owner-gated)

**Status: PLAN ONLY. Nothing is applied, deployed, scheduled, or enabled.** Online poker is
fully **DARK**. This document fixes the safe order to apply the three merged-but-unapplied GE
online-poker migrations at a future, owner-gated Phase D — and re-verifies the dark posture from
source. No DB apply, no `db push`, no `deploy_db`, no Edge deploy, no cron, no flag flip, no
`schema_migrations` edit accompanies this doc.

- Frontend gate: `FEATURES.onlinePoker = false` (`src/lib/featureFlags.ts:84`)
- In-shell gate: `RUNTIME_LIVE = false` (`src/lib/onlinePoker/types.ts:18`)
- Runtime gate: `online_poker_config.enabled` **DEFAULT false** (`20260820000000_…:37`, live, super_admin only)
- Project ref: `orlesggcjamwuknxwcpk`

Companions: `GE2_ENABLEMENT_RUNBOOK.md`, `GE2_PHASE_D_READINESS.md`, `GE2K_TABLE_RUNNER_IMPLEMENTATION.md`.
Self-checks (read-only): `scripts/ge2-readiness-report.mjs`, `scripts/ge2-table-runner-dryrun.mjs`.

---

## 1. Source main is clean (verified post-#229)

No duplicate 14-digit migration version on `main`. The online-poker engine source, interleaved
with the parallel payroll merges:

| Slot | Migration | Owner | Applied live? |
|---|---|---|---|
| `20260907000000` | `op_submit_action_settlement_seat_writeback` (GE-2I) | engine | **NO** |
| `20260908000000` | `op_stand_up_block_folded_midhand` (GE-2J) | engine | **NO** |
| `20260909000000` | `payroll_p3_cross_month_overlap` | payroll | (payroll session) |
| `20260910000000` | `payroll_p4b_insurance_layer_phase1` | payroll | (payroll session) |
| `20260911000000` | `op_run_due_table_ticks` (GE-2K) | engine | **NO** |

**Live `schema_migrations` max = `20260820000002`** → every slot from `20260820…` onward,
including all three engine migrations above, is **unapplied**. Next free engine slot = `20260912000000`.

---

## 2. Apply order (controlled, single-file, owner-gated — NOT now)

Apply in **version order**, each as a controlled Management-API single-file operation (the proven
GE-2B/GE-2C/N2 process): **preflight → snapshot live object → apply only this migration → verify
the live body → record the version row (statements[] + rollback[]) → rollback note**. The
`enabled` flag stays **OFF** throughout (apply ≠ enable).

1. **`20260907000000` — GE-2I** `CREATE OR REPLACE op_submit_action` (+ settlement seat writeback).
   Verify live: the `IF p_new_state->>'status' = 'complete' THEN UPDATE online_poker_seats …`
   block is present; all G4 backstops intact (idempotency, CAS, seat-ownership, chip-conservation).
2. **`20260908000000` — GE-2J** `CREATE OR REPLACE op_stand_up` (folded mid-hand guard).
   Verify live: the active-hand guard status set is `('active','folded','allin')`.
3. **`20260911000000` — GE-2K** `CREATE op_run_due_table_ticks` + `op_table_runner_diag`.
   Verify live: both functions present, `SECURITY DEFINER` + `search_path=public`,
   `EXECUTE` granted to `service_role` only, gated by `op_is_enabled()`.

**Dependency rationale:** GE-2J's correctness depends on GE-2I's settlement writeback (so a folded
player who waits cashes out the corrected stack); GE-2K depends on both (the auto-deal loop relies
on per-hand settlement + the stand-up guard). Version order `07 → 08 → 11` satisfies this. Each
migration is idempotent (`CREATE OR REPLACE` / `DROP … IF EXISTS`), safe to re-run.

**Not in this engine apply:** Payroll P3 (`09`) and P4b (`10`) — the payroll session owns those.

---

## 3. Rollback snapshot per step (all present on main)

| Step | Rollback file | Restores |
|---|---|---|
| GE-2I | `docs/emergency_rollbacks/PRE_GE2I_20260907000000_*_rollback.sql` | the `20260820000002` `op_submit_action` body (no writeback) |
| GE-2J | `docs/emergency_rollbacks/PRE_GE2J_20260908000000_*_rollback.sql` | the `20260820000000` `op_stand_up` body (guard = `active`/`allin`) |
| GE-2K | `docs/emergency_rollbacks/PRE_GE2K_20260911000000_*_rollback.sql` | DROPs `op_run_due_table_ticks` + `op_table_runner_diag` |
| Runtime | `PRE_GE2C_20260820000000_*` (+ N2 `PRE_GE2C_N2_20260820000002_*`) | full GE-2C runtime revert |

Each apply records its own `rollback[]` in the version row (per the GE-2B precedent).

---

## 4. Edge table-runner NOT deployed (verified from source)

The deploy workflow's **"Deploy Edge Functions"** step deploys a **fixed list of 7 named
functions**: `process-swing`, `assign-dealer`, `close-table`, `swing-metrics`, `telegram-bot`,
`send-shift-schedule`, `td-ai-assistant`. **`online-poker-table-runner` is NOT in that list** →
it is not auto-deployed. (`online-poker-action` and `online-poker-timeout-sweep` are also absent —
they deploy manually, owner-gated.) Live confirmation via `supabase functions list` is Phase-D.

---

## 5. Cron NOT created (verified from source)

- The GE-2K migration `20260911000000` contains **no** `cron.schedule` (the runner cron is a
  separate Phase-D step).
- The timeout-sweep cron `20260903000000_online_poker_timeout_sweep_cron.sql` exists as **source
  only** and is **unapplied** (live max `20260820000002`).
- **No table-runner cron migration exists.** No live online-poker cron is scheduled.

---

## 6. Flags dark (verified in source)

- `FEATURES.onlinePoker = false` (`src/lib/featureFlags.ts:84`)
- `RUNTIME_LIVE = false` (`src/lib/onlinePoker/types.ts:18`)
- `online_poker_config.enabled` DEFAULT `false` (read-only live confirm at Phase D)

Triple dark gate intact. Applying §2's migrations does **not** change any of these.

---

## 7. Timeout-sweep plan (Phase-D, after the drill)

The timeout sweep is source-only (edge `online-poker-timeout-sweep` + cron `20260903000000`). An
AFK/disconnected player must not stall a table, so wire it **before real humans play**:

1. Deploy the edge: `supabase functions deploy online-poker-timeout-sweep --no-verify-jwt`.
2. Set `OP_TIMEOUT_SWEEP_SECRET` (Edge env) + DB GUC `app.op_timeout_sweep_secret` (same value).
3. Apply cron `20260903000000` (controlled op — NOT via the deploy workflow).
4. Verify: a hand past `act_deadline` auto-folds/checks; idempotent (re-run = no double action).

The future **table-runner** cron + edge deploy follow the same pattern (authored in a later PR; see
`GE2K_TABLE_RUNNER_IMPLEMENTATION.md §4`).

---

## 8. Phase D gate (3 prerequisites — unchanged)

Phase D stays **blocked** until ALL three hold:

1. **DB password rotated + present locally** in `scripts/.env.test.local` (`SUPABASE_DB_PASSWORD`).
2. **Two disposable test logins** in `scripts/.env.ge2-drill.local` (+ `SUPABASE_URL`/`SUPABASE_ANON_KEY`).
3. **Owner sends the EXACT phrase:** `Proceed with G4 DB enable drill`.

---

## 9. 🔐 SECURITY — rotate leaked tokens BEFORE any production apply/deploy

Before **any** further production apply/deploy/enable, rotate the exposed secrets (owner dashboard
action — a hard prerequisite to Phase D):

- the **DB password** (committed historically in `seed-swing-test.mjs`; removed from source but
  still in git history);
- the **Supabase access token** and **Telegram bot token** pasted in chat earlier.

Until rotation, do not run any controlled production operation.

---

## 10. What NOT to do (now)

No DB apply · no `supabase db push` · no `deploy_db=true` · no `schema_migrations` edit · no Edge
deploy · no cron create · no flag flip (`online_poker_config.enabled` / `FEATURES.onlinePoker` /
`RUNTIME_LIVE`). No business-ops files. This document changes ordering knowledge only.
