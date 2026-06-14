# Step 2 — predictive pre-assign of a soon-free dealer to an EMPTY open table (implementation design)

**Status:** DRAFT — awaiting owner approval. Needs a DB migration → heavier gate than Step 1.
**Depends on:** Step 1 ([#145](https://github.com/PhamGiaVinh/-vinpoker-/pull/145), merged). Builds on spec [#141](https://github.com/PhamGiaVinh/-vinpoker-/pull/141).
**Investigation:** workflow `wf_10e53b8b-347` (5 read-only readers over pre-assign passes, RPCs, state machine, rotation planner, break-end).

## 1. Goal
Empty active table + NO dealer free right now, but dealer A frees soon (e.g. 6 min left on break) → **reserve A for that table now**, send open-table Telegram + countdown, and **execute (assign A) when A's break ends** and A passes the 13-min execute rest gate. Never opens new tables; never yanks A off break early.

## 2. Why it can't reuse the existing pre-assign machinery (confirmed in source)
- `pre_assign_next_dealer_for_table` (RPC) and `lock_rotation_slot` / `set_rotation_slot_dealer` only **CAS-UPDATE an existing active `dealer_assignments` row** (the outgoing dealer). An empty table has no such row → all return race_lost / require `assignment_id IS NOT NULL`.
- `execute_pre_assigned_swing(p_old_assignment_id, …)` requires an outgoing assignment to close — an empty table has none.
- Pass 2 / Pass 3 discovery queries only select `status='assigned' AND released_at IS NULL` → empty tables never enter them.
- State machine: **`on_break → pre_assigned` is NOT legal**; existing RPCs raw-UPDATE to `pre_assigned` guarded by `current_state='available'`, so a still-resting dealer can't be marked pre_assigned that way.
- 3 orphan-reapers (Pass 0c step 1b, Pass 1c, `reconcile_dealer_states` STEP 3) flip any `pre_assigned` attendance with no backing active assignment back to `available` within ~1 tick.

## 3. Chosen representation — dedicated reservation row (Option A)
Create a **`dealer_assignments` reservation row** for the empty table:
`{ table_id = empty table, attendance_id = reserved dealer, status = 'pre_assigned', swing_due_at = predicted arrival + grace, pre_announce_due_at = now, is_empty_table_reservation = true }`.

- The **reserved dealer keeps `current_state` unchanged** (stays `on_break`) — the reservation lives in the row, NOT the FSM state → **avoids the illegal `on_break → pre_assigned` transition entirely.**
- `fillEmptyTables` already treats a table with a `status IN (assigned, pre_assigned)` row as **occupied** → it won't double-staff the reserved table. ✔ (no change needed there)
- `pickNextDealer` already excludes a dealer who has a `pre_assigned` `dealer_assignments` row elsewhere (B6 defense) → the reserved dealer won't be picked for another table. ✔
- A new boolean column `is_empty_table_reservation` (or reuse an existing flag) distinguishes these rows from the normal pointer-based pre-assign so reapers can skip them.

## 4. New DB objects (source-only migration; controlled Management-API apply, NOT db push)
- **`reserve_empty_table_for_dealer(p_table_id, p_attendance_id, p_predicted_arrival, p_club_id)`** — SECURITY DEFINER, CAS/idempotent: INSERT the reservation row only if (a) table is active + empty, (b) dealer has no other active/pre_assigned assignment, (c) no existing reservation for this table. Returns ok / table_occupied / dealer_busy.
- **`execute_empty_table_reservation(p_reservation_id)`** — SECURITY DEFINER: promote `status='pre_assigned' → 'assigned'`, set `assigned_at=now`, `swing_due_at = now + grace + duration`, set dealer `current_state='assigned'` (legal: available→assigned). Guarded: only if dealer `current_state='available'` (break ended) — else no-op (wait).
- **Reaper exceptions:** teach Pass 0c step 1b, Pass 1c, and `reconcile_dealer_states` STEP 3 to SKIP rows where `is_empty_table_reservation=true` (+ a freshness timeout reaper so a reservation that never materialises self-clears, mirroring reconcile STEP 4's 15-min dual-clock).
- Migration adds 1 column + the 2 RPCs + reaper tweaks. **Authored source-only; applied as a controlled single op (owner-gated), schema_migrations untouched — same method as the finance RPC.**

## 5. process-swing changes (edge, per-club gated)
Runs in the Pass 1 region, AFTER Pass 0e (so freed dealers are already `available`):
- **Reserve:** for each empty active table with no `available` dealer to fill now (Step 1 already filled the easy ones), use `buildRotationSupply` (reservationMode, 15-min horizon) to find the **soonest-free** dealer eligible by arrival; call `reserve_empty_table_for_dealer` + send countdown Telegram (`📋 Mở bàn {table}: {@dealer} vào sau ~{n} phút`).
- **Execute:** scan reservation rows whose dealer is now `available`; if they pass the shared **13-min execute rest gate** (extract the existing `EXECUTE_MIN_REST_MINUTES` check into a shared helper), call `execute_empty_table_reservation` + send "đã vào bàn" + the swing clock starts.
- Gating: reuse the per-club env allowlist (a Step-2-specific flag, e.g. `AUTO_PREASSIGN_EMPTY_TABLES_CLUB_IDS`, default OFF) so Step 2 can be enabled independently of Step 1.

## 6. Policy note
Step 2 deliberately RESERVES an `on_break` (resting) dealer — the **opposite** of Step 1's `availableOnly` (which never pulls on_break). That is the intended Step-2 behavior (predictive). It still **does not pull them off break early** — execution waits until the break naturally ends + 13-min rest. Owner must confirm this distinction.

## 7. Rollout (3 sub-PRs, all owner-gated)
- **2A** — DB migration (column + 2 RPCs + reaper tweaks), source-only; controlled Management-API apply in owner window.
- **2B** — process-swing reserve+execute passes + Telegram, behind per-club flag default OFF; deploys on merge.
- **2C** (optional) — UI: show reserved empty tables with a countdown in the operator panel.

## 8. Hard constraints (carry over from Step 1)
Never open/activate new tables · never pull a dealer off break early · rest guard preserved (10-min pick, 13-min execute) · no double-booking (CAS + uniqueness) · don't touch payroll/tracker/shift-planner · no `db push` / `deploy_db=true` · default OFF.

## 9. Open decisions for owner
1. Approve the **dedicated reservation-row** representation + the **2 new RPCs + 1 column migration** (this is a DB change, controlled apply, owner-gated)?
2. Confirm Step 2 **reserving a still-resting (on_break) dealer** is intended (vs Step 1's available-only).
3. Separate Step-2 flag vs reuse Step-1's `AUTO_STAFF_EMPTY_TABLES_CLUB_IDS`?

## 10. Risks
- New column/RPC = DB migration; the pending `20260801→20260813` chain + perform_swing overload mean `db push` stays forbidden — apply must be a controlled single op.
- Reaper changes touch Patch K (`reconcile_dealer_states`) — golden before/after needed.
- Two near-duplicate emergency-pre-assign writer blocks exist; keep Step 2 in its own path, don't copy the raw-UPDATE anti-pattern.
- Live DB has drifted from migrations — verify `transition_dealer_state` matrix + dealer_assignments status enum on the live DB before authoring the migration.
