# GE-2K — Table Runner / Auto-deal Loop (implementation notes)

**Status: SOURCE ONLY. Nothing applied, deployed, scheduled, or enabled. Online poker DARK.**
Implements the GE-2H spec (`GE2H_TABLE_RUNNER_AUTO_DEAL_SPEC.md`, Option C — hybrid): a DB
eligibility lister + a service-role Edge runner that deals the next hand per table. No cron,
no Edge deploy, no secret, no flag flip in this PR.

- DB: `supabase/migrations/20260909000000_op_run_due_table_ticks.sql` (lister + dry-run diag)
- Engine/runner core (unit-tested): `supabase/functions/_shared/pokerRuntime/{dealNextHand,tableRunner}.ts`
- Edge: `supabase/functions/online-poker-table-runner/index.ts`
- Harness: `scripts/ge2-table-runner-dryrun.mjs`
- Phase-D probe: `scripts/ge2-drill/sql/07_table_runner.sql`
- Rollback: `docs/emergency_rollbacks/PRE_GE2K_20260909000000_*_rollback.sql`
- Depends on: GE-2I `20260907000000` (settlement writeback) + GE-2J `20260908000000` (stand-up guard)

---

## 1. Design (Option C — DB lists, Edge deals)

A "deal" = `shuffledDeck()` + `createHand()`, which are the **TS engine** and run **only in the
Deno Edge**. So the DB cannot deal; it only *finds* due tables, and the Edge runs the engine.

```
pg_cron (Phase-D, NOT created here)
  └─▶ op_run_table_runner() (Phase-D)  ──net.http_post + Bearer secret──▶  Edge: online-poker-table-runner
                                                                              │ auth: OP_TABLE_RUNNER_SECRET
                                                                              │ runTableRunner(adminServiceRole):
                                                                              │   op_is_enabled()  → no-op if dark
                                                                              │   op_run_due_table_ticks(limit)  ← eligibility list (SQL)
                                                                              ▼   for each table: dealNextHand()
                                                                                    nextButton → createHand(shuffledDeck) → op_start_hand
```

- **`op_run_due_table_ticks(p_limit)`** (SQL, service-role, gated): returns tables that are
  `open` · have **no** active hand · have **≥2** seats `sitting` with `stack>0` · whose last hand
  is older than the 4s inter-hand cooldown. Returns `{table_id, bb, last_button_seat, last_hand_no}`.
- **`op_table_runner_diag(p_limit)`** (SQL, read-only, gated): classifies every open table into
  `eligible | active_hand | no_quorum | cooldown` — powers the dry-run "why skipped" report.
- **`dealNextHand(admin, tableId, null)`** (TS): the per-table deal recipe (same as
  `online-poker-action`'s `handleStart`), behind a minimal `AdminClient` so it is unit-tested.
- **`runTableRunner(admin, {limit, dryRun})`** (TS): the loop. `op_is_enabled` gate → list → deal
  each (or, in dryRun, classify only). Returns **count-only** telemetry; per-table isolation
  (one failure never aborts the rest).
- **Edge** `online-poker-table-runner`: Deno.serve wrapper — `OP_TABLE_RUNNER_SECRET` Bearer auth +
  service-role client + `runTableRunner`. Mirrors `online-poker-timeout-sweep` 1:1.

---

## 2. Idempotency / race proof

- **Hard guard:** the partial unique index `online_poker_hands(table_id) WHERE status IN
  ('dealing','betting')`. `op_start_hand` returns `already_active` if a hand already exists, so a
  concurrent/duplicate deal is a **no-op** (`runTableRunner` counts it as `skippedAlreadyActive`,
  never `errors`, never a second hand).
- **Why no DB advisory lock spans the deal:** the deal runs in the Edge, *outside* any DB
  transaction the lister could hold a lock across. `op_run_due_table_ticks` takes only a
  best-effort `pg_try_advisory_xact_lock` over the already-limited candidate set (reduces
  duplicate work between overlapping ticks); it releases at the lister's txn end. The unique index
  is the real CAS guard. No persisted "tick attempt" marker is needed.
- **Fail-closed:** `op_is_enabled()=false` ⇒ both SQL functions return `disabled`/empty and
  `runTableRunner` returns `{outcome:'disabled'}` before any list/deal.
- Verified in `tests/onlinePoker/tableRunner.test.ts`: disabled→no deal; skip active hand
  (`already_active`); skip `<2` funded; duplicate attempts → no-op (no error); dry-run never deals;
  no secret in telemetry.

---

## 3. Observability (G1: counts only, never cards)

`runTableRunner` returns / the Edge logs:
`{ outcome, dryRun, scanned, dealt, skippedAlreadyActive, skippedNotEnough, errors, diag? }`.
Per-hand, `op_start_hand` already writes a `hand_started` event into `online_poker_hand_events`.
Never logged: deck, board_future, holes, hole cards, private views.

---

## 4. Future apply / deploy sequence (Phase-D ONLY, owner-gated)

All steps below are **NOT** done in this PR. Run only in a dedicated Phase-D session
(gate phrase `Proceed with G4 DB enable drill`), after GE-2I + GE-2J are applied:

1. Apply migrations (controlled, single-file): `20260907000000` (GE-2I), `20260908000000` (GE-2J),
   `20260909000000` (GE-2K lister) — verify each live, flag stays OFF.
2. Deploy the Edge: `supabase functions deploy online-poker-table-runner --no-verify-jwt`.
3. Set the Edge secret `OP_TABLE_RUNNER_SECRET` (random) + the matching DB GUC
   `app.op_table_runner_secret`.
4. Authoring a cron is a **separate** step (a `op_run_table_runner()` SQL fn + `cron.schedule(
   'op-table-runner', '5 seconds', …)` `net.http_post`) — authored + applied in Phase-D, **not here**.
5. Enablement drill: dry-run (`scripts/ge2-table-runner-dryrun.mjs`) → expect `disabled` while the
   flag is off; flip `online_poker_config.enabled=true` on a disposable table → the alpha
   acceptance plan (GE-2H §19): deal → complete → auto-deal next → no freeze → kill switch stops it.

---

## 5. Rollback / kill switch

| Scope | Action |
|---|---|
| **Master kill** | `UPDATE online_poker_config SET enabled=false` → lister/diag/runner all no-op instantly. No redeploy. |
| **Stop dealing only** | `cron.unschedule('op-table-runner')` (once created) — existing hands finish; no new deals. |
| **Neutralise the Edge** | remove `OP_TABLE_RUNNER_SECRET` / the GUC → the runner Edge refuses (401). |
| **Remove the lister** | `docs/emergency_rollbacks/PRE_GE2K_20260909000000_*_rollback.sql` (DROPs both functions). |

The runner has **no independent authority**: with the master flag off it does nothing.

---

## 6. What is NOT in this PR (scope guard)

No cron created/scheduled · no Edge deploy · no secret set · no DB apply · no `db push` · no
`deploy_db=true` · `schema_migrations` untouched · no flag flip (`online_poker_config.enabled` /
`FEATURES.onlinePoker` / `RUNTIME_LIVE` all stay false). No business-ops files touched.

**Follow-up (not here):** `online-poker-action`'s `handleStart` can later be refactored to call the
shared `dealNextHand` (converge the two copies of the deal recipe); GE-2H PR-A's busted-seat
auto-`sitting_out` can ride the next runner change.
