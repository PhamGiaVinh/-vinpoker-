# Handoff — Open Table Flow: 6-minute dealer grace (follow-up)

Status (2026-06-13): **frontend visibility/scope fix DONE** in this PR; the **6-minute open-grace countdown is NOT implemented yet** — it is gated on a DB column.

## Shipped in this PR (frontend-only, no DB read/write of opened_at)
- Dealer Swing map (`DealerSwingTab` → `TableGrid`) `filteredTables`:
  - "Tổng thể" (All) now shows ALL active tables, including newly-opened dealerless ones (was hidden by `tableAssignmentMap[t.id] != null`).
  - A specific tour shows ONLY `shift_id === selectedTour` (removed the `shift_id == null` pool fallback that leaked global tables into a tour).
- Empty active table label `Trống` → **`Đợi dealer`** (only for `status==='active'` tables with no dealer and no pre-assign — never pool/inactive).
- "+ Thêm bàn" dialog shows scope helper: All → "Thêm bàn tổng thể (không thuộc tour nào)"; tour → "Thêm bàn vào: {tour}".
- Available-dealer pre-assign already works: the create-table handler calls `massAssign()` → `fillEmptyTables` (respects `minInterSwingRest`).
- Empty tables are already never marked overdue (overdue is per-assignment; `getSwingTableStatus` → `empty`).

## Source-only migration (NOT applied)
`supabase/migrations/20260820000001_game_tables_opened_at.sql` — `ALTER TABLE game_tables ADD COLUMN IF NOT EXISTS opened_at timestamptz;` (nullable, additive, no backfill). Manual-gated; apply in a controlled owner-approved DB session. Slot `20260820000001` verified free vs origin/main + open PRs (PR #74 holds `20260820000000`) + live schema_migrations. **Nothing reads/writes it yet** — inert until applied.

## Follow-up PR (AFTER opened_at is applied live)
1. **Write `opened_at = now()`** in the "+ Thêm bàn" activation UPDATE (`game_tables.update({ shift_id, status, table_type, opened_at: ... })`). Do NOT add this before the column is live — it would break table activation.
2. **Grace countdown UI** on the table card: while `now − opened_at < 6 min` show "Mở bàn sau M:SS"; the table is visible but treated as in pre-open grace (not overdue). After 6 min:
   - dealer assigned/pre-assigned → start the normal swing countdown from that point;
   - still no dealer → status "Thiếu dealer".
3. **Normal swing countdown** must start only after the grace, never immediately on open. Empty tables must never be marked swing-overdue.
4. **Reset semantics (define + implement):** set/clear `opened_at` consistently so reused pool tables don't carry a stale value —
   - table opened into a shift → `opened_at = now()`;
   - table closed / returned to pool (`shift_id = NULL`, status inactive) → `opened_at = NULL`;
   - table moved to another shift/tour → `opened_at = now()` (re-open);
   - reopened after close → `opened_at = now()`.
   Decide whether this lives in the frontend UPDATE(s) or a small RPC; prefer a single open/close RPC if the write happens from multiple paths.
5. **Pre-assign from a dealer on break** (assign a soon-available dealer during the grace) is OUT OF SCOPE — existing rotation APIs (`set_rotation_slot_dealer`, `lock_rotation_slot`, Pass R) require an EXISTING active assignment to relieve and cannot target an empty/just-opened table. Needs a new safe API (respecting rest/eligibility); design as its own session.

## Hard constraints (unchanged)
No widening of DB guards / RLS. No TableDrawPanel / seat add-move-bust changes (that surface is tournament_id-scoped and already correct). No Payroll/Tracker/TV/Engine/HRC.
