# Floor Ops Spec — Mở bàn / Thêm người / Đóng bàn (open table · add player · close table)

**Status:** DESIGN-ONLY. No code, no DB, nothing applied. Per `CLAUDE.md` §8, open/close-table
RPCs are deferred until the Floor Phase 1 smoke test is stable and the owner explicitly approves.
This document is the design the owner asked for ("lên plan về phần mở bàn thêm người và đóng bàn").

**Author session:** `agent/floor-tabs-ops` (Floor / Seat Ops). Branch off `origin/main`.

**What this replaces:** the three disabled "Sắp có" buttons in
[`FloorTableDetailSheet.tsx`](../../src/components/cashier/tournament-live/FloorTableDetailSheet.tsx)
— **Mở bàn**, **Thêm người**, **Đóng bàn**. ("Gán dealer" was removed in this same session; dealer
assignment stays in Dealer Swing, not Floor.)

---

## 0. Grounding — confirmed live data model & reusable patterns

Read directly from current `origin/main`. These are the contracts the new RPCs must respect.

| Object | Key columns / notes |
|---|---|
| `tournament_tables` | `id` (PK), `table_id` → `game_tables.id` (nullable in old rows), `table_number`, `table_name`, `max_seats`, `status` ('active' = open). The floor map treats `status <> 'active'` as **closed**. |
| `tournament_seats` | `id`, `tournament_id`, `table_id` (⚠️ **dual convention** — may be `game_tables.id` OR `tournament_tables.id`; the map normalizes both), `seat_number`, `player_id`, `player_name`, `entry_id`, `is_active`. **Partial unique index `(table_id, seat_number) WHERE is_active = true`** — this is the real race guard. |
| `tournament_entries` | `status` ('registered' / 'seated' / 'busted' / 'cancelled'), `table_id` → `game_tables.id`, `seat_number`, `source` ('online' / 'offline' / 'manual' / 'staff'). |
| `seat_draw_receipts` | per-assignment receipt; superseded (status='cancelled') on move/void. |
| `seat_assignment_history` | append-only audit; every seat change writes a row with a `reason`. |

**Reusable RPCs (mirror, do not rewrite the live ones):**
- `create_offline_buyin_and_seat(p_tournament_id, p_player_name, p_buy_in, p_fee, p_draw_mode)` — actor from `auth.uid()`, synthetic walk-in `player_id`, **auto-draws** table+seat, `reference_code` `CASH-…`, `source='offline'`. Already built (flag `offlineBuyIn`).
- `move_player_seat(p_entry_id, p_to_tournament_table_id, p_to_seat_number, p_actor_user_id, p_reason)` — moves a seated entry to a **specific** seat; supersedes the old receipt, writes a new one, audits the reason. This is the canonical "claim a specific seat atomically" pattern.
- `confirm_registration_and_assign_seat(...)` — online auto-draw.
- `void_registration` / `reenter_tournament_player` — cancel/free + re-buy (flag `registrationExtensions`).

**Edge fn** `tournament-live-draw` actions: `get_seats`, `update_seats` (the floor map uses
`update_seats` with `is_active=false` to bust a player).

**Security invariants every new RPC MUST follow** (from `CLAUDE.md` + the offline-buyin guard-v2 rule):
- Actor is **`auth.uid()` only** — never a client-passed `p_actor_user_id`. Reject null → `unauthorized`.
- Actor must be the tournament club's **owner OR a `club_cashiers`** of that club, else `actor_not_allowed`.
- Tournament must be open; `SELECT … FOR UPDATE` to serialize per tournament.
- All writes in the single RPC transaction; seat claims rely on the partial unique index — on
  `unique_violation` the whole RPC **rolls back** (no orphan reg/entry/seat/receipt).
- Append to `seat_assignment_history` with a clear `reason`.
- `REVOKE ALL FROM PUBLIC, anon; GRANT EXECUTE TO authenticated`. `SECURITY DEFINER`, `search_path=public`.
- Tournament **buy-in is prize-pool pass-through** (not revenue); the **fee (rake)** flows to revenue
  exactly like offline buy-in. Fee field default = `tournaments.rake_amount` (consistent with the
  cashier panels).

---

## 1. Feature — Mở bàn (open table)

**Goal:** add room capacity when more players arrive, or re-open a table that was closed.

**IA decision:** "open a *new* table" is a **room-level** action, not really per-table. Recommend:
- A room-level **"+ Mở bàn"** button on `FloorTableMapPanel` header (next to "Làm mới").
- The per-table sheet's "Mở bàn" is shown **only when that table is closed** → re-opens it; hidden otherwise.

### RPC `open_tournament_table`
```
open_tournament_table(
  p_tournament_id        uuid,
  p_table_number         int  default null,   -- null → next available number
  p_max_seats            int  default null    -- null → tournament default (fallback 9)
) returns jsonb
```
Behavior:
1. Auth + tournament-open checks (above). Lock tournament `FOR UPDATE`.
2. If a **closed** `tournament_tables` row exists for `p_table_number` (or the resolved number) →
   flip `status='active'` (re-open). Else **create**: `table_number = COALESCE(p_table_number, MAX(table_number)+1)`,
   `max_seats = COALESCE(p_max_seats, tournament.default_table_size, 9)`, `status='active'`.
3. **game_tables link** (⚠️ open question §5): a new `tournament_tables` row needs a `table_id` →
   `game_tables.id` for the draw/move RPCs to treat it as a valid destination
   (`move_player_seat` filters `table_id IS NOT NULL`). Either create a `game_tables` row and link it,
   or confirm the current table-creation path (the `tournament-live-draw` edge fn) and reuse it.
4. `seat_assignment_history` row, `reason='open_table'`.
5. Return `{ ok, tournament_table_id, table_id, table_number, max_seats, status:'active' }`.

Errors: `unauthorized`, `actor_not_allowed`, `tournament_not_open`, `table_number_taken`
(active row already uses that number).

### UI
- Room-level: small **"+ Mở bàn"** → tiny form (table number auto-suggested, max_seats default) →
  confirm → calls RPC → toast + map refresh.
- Per-table (closed only): "Mở lại bàn" button in the detail sheet → re-open RPC path.

---

## 2. Feature — Thêm người (add a walk-in to a seat)

**Goal:** a walk-in pays cash → floor seats them at **this** table (a chosen empty seat), prints a receipt.
This is offline buy-in **targeted to a specific seat** instead of auto-draw.

**Recommendation:** add a **sibling RPC** rather than changing the live offline RPC's signature.

### RPC `add_offline_player_to_seat`
```
add_offline_player_to_seat(
  p_tournament_id         uuid,
  p_player_name           text,
  p_buy_in                bigint,
  p_fee                   bigint,
  p_tournament_table_id   uuid,
  p_seat_number           int
) returns jsonb
```
Behavior (mirrors `create_offline_buyin_and_seat`, minus the draw):
1. Auth + tournament-open + input validation (`name>=2`, `buy_in>0`, `fee>=0`, seat in `1..max_seats`).
2. Synthetic `player_id = gen_random_uuid()`, `entry_no=1`.
3. Insert `tournament_registrations` (`confirmed`, `buy_in`, `platform_fixed_fee=p_fee`,
   `total_pay=buy_in+fee`, `reference_code` `CASH-…`, `confirmed_by=auth.uid()`).
4. Insert `tournament_entries` (`source='offline'`, `status='seated'`, table/seat set).
5. **Claim the seat**: insert `tournament_seats` (`player_name=p_player_name`, `is_active=true`).
   The partial unique index is the guard — `unique_violation` → whole RPC rolls back, return
   `seat_occupied` (UI: "Ghế vừa bị lấy — chọn ghế khác").
6. Insert `seat_draw_receipts` + `seat_assignment_history` (`reason='walk_in_add'`, `draw_type='manual'`).
7. Return `{ ok, table_number, seat_number, receipt_code, display_name, starting_stack }` — same shape
   the cashier panels already render via `SeatReceiptDialog`.

### UI
- "Thêm người" in the detail sheet → form: name (required), buy-in (default `tournament.buy_in`),
  **fee default = `tournament.rake_amount`** (matches `OfflineBuyInPanel`/`ReentryPanel`), seat picker.
- **Seat picker MUST hide occupied seats** — reuse the same "selectable seats" logic just shipped in
  `MovePlayerDialog` (free seats only; occupied seats never shown). Owner rule 2026-06-16.
- Confirm (restate amount+name) → RPC → `SeatReceiptDialog`.

---

## 3. Feature — Đóng bàn (close / break a table)

**Goal:** standard table break — relocate this table's seated players to other open tables, then close it.

### RPC `close_tournament_table`
```
close_tournament_table(
  p_tournament_table_id  uuid,
  p_draw_mode            text default 'random_balanced',  -- or 'fill_lowest_table'
  p_reason               text default 'table_break'
) returns jsonb
```
Behavior:
1. Auth + tournament-open. Lock tournament `FOR UPDATE`.
2. Load this table's **active** seats (the players to relocate).
3. **Empty table** → just set `status='closed'`, history `reason='close_empty_table'`, return `{ok, moved:[], closed:true}`.
4. **Capacity precheck**: free seats across **other active tables** must be ≥ players to move; else
   fail atomically with `insufficient_capacity` (open another table first). This keeps the break
   all-or-nothing — no half-broken table.
5. For each seated entry: draw a destination at another open table (per `p_draw_mode`), claim it via
   the partial unique index (mirror `move_player_seat`), supersede old receipt → new receipt, append
   history `reason='table_break'`. `unique_violation` on a race → reload + retry that one seat; if it
   still can't place after retry, **roll back the whole break**.
6. Set the source table `status='closed'`.
7. Return `{ ok, table_number, closed:true, moved:[{player_name, from_seat, to_table_number, to_seat_number, receipt_code}] }`.

Errors: `unauthorized`, `actor_not_allowed`, `tournament_not_open`, `table_not_found`,
`insufficient_capacity`.

### UI (danger-styled, like `SeatDrawDialog`)
- "Đóng bàn" → confirmation: "Bàn N có K người — sẽ chuyển sang các bàn khác rồi đóng bàn." + draw-mode select.
- Progressive reveal of each move (reuse the `SeatDrawDialog` result-row pattern).
- On `insufficient_capacity`: block with "Không đủ ghế trống — mở thêm bàn trước khi đóng."

---

## 4. Cross-cutting

- **Feature flag** `floorTableOps` (new, default **false**) gates all three UI actions. While off, the
  buttons stay disabled "Cần bật RPC" AND the click handlers guard `if (!FLAG) return;` (defence in
  depth — never call a missing RPC). Mirrors `offlineBuyIn` / `registrationExtensions`.
- **Source-only migrations**, owner-gated controlled apply later (preflight → CREATE OR REPLACE →
  verify grants/SECURITY DEFINER/search_path → idempotency rerun → rollback note). No `supabase db push`,
  no `deploy_db=true`, no `schema_migrations` edit.
- **Untouched:** payroll, dealer swing, game engine, tracker runtime, online registration behavior.
- **Revenue:** the fee (rake) on "Thêm người" reconciles through `tournament_registrations` exactly like
  offline buy-in — do not double-count vs online. Buy-in stays prize-pool pass-through.
- **Types:** new RPCs aren't in generated Supabase types until applied → narrow local cast at the call
  site only (`(supabase.rpc as any)(...)` with a `// TODO: remove after DB apply + types regen`).

## 5. Open questions for the owner (decide before build)

1. **game_tables link on open-table:** create a `game_tables` row + link, or reuse the existing
   table-creation path (`tournament-live-draw` edge fn)? (Confirm the current "how does a table get
   created today" path — `TableDrawPanel` was removed in #174.)
2. **Add-player RPC:** new sibling `add_offline_player_to_seat` (recommended, keeps the live offline RPC
   untouched) vs. extend `create_offline_buyin_and_seat` with optional seat params?
3. **Close-table when room is full:** hard-fail `insufficient_capacity` (recommended) vs. allow a partial
   relocation + leave the rest?
4. **Default `max_seats`** for a newly opened table: fixed 9, or read a tournament-level table-size?
5. **"Mở bàn" scope:** room-level "+ Mở bàn" (new table) + per-table "re-open closed table" — confirm both.

## 6. Build order (one branch, when approved)

1. Source-only migrations: `open_tournament_table`, `add_offline_player_to_seat`, `close_tournament_table`.
2. UI: `OpenTableDialog`, `AddPlayerDialog` (reuse offline-buyin + hidden-occupied seat picker),
   `CloseTableDialog`; wire the three buttons in `FloorTableDetailSheet` (+ room-level "+ Mở bàn").
3. `featureFlags`: `floorTableOps=false`; buttons "Cần bật RPC".
4. `npx tsc --noEmit` + `npm run build`; diff + forbidden-path proof; draft PR (mixed FE + source-only
   migrations → flag to Coordinator; nothing applied by merge).
5. Owner-gated: controlled apply of the three migrations → flip `floorTableOps=true` → floor UAT
   (open a table, walk-in add to a chosen empty seat with receipt, break a table and verify all players
   relocated + table closed).

## 7. Risks

- Walk-in identity is name-only (synthetic `player_id`) → re-entry of the same person makes a new
  identity (acceptable MVP; phone/member link later).
- Draw logic is duplicated from the online/offline RPCs by design (keeps the live confirm/move RPCs
  untouched) — keep them in sync if draw rules change.
- Table break is the highest-risk RPC (multi-move transaction). Must be atomic; the capacity precheck +
  full rollback on any unplaceable seat is the safety net. Needs a golden before/after on a fixture
  tournament during UAT.
- `tournament_seats.table_id` dual convention — new RPCs must write the **same** convention the floor map
  and `move_player_seat` expect (`tournament_seats.table_id = tournament_tables.id` for move-created
  seats; confirm during implementation).
