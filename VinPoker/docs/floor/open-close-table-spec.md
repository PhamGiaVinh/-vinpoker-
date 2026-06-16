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

## 2. Feature — Thêm người (seat a walk-in — PURE seat placement, NO money)

**Goal:** the floor seats a player into a **specific empty seat** and prints a seat ticket. **No money
is taken here.**

**Owner-locked (2026-06-16): floor action ≠ cashier money flow.** "Thêm người" is a **new floor RPC**,
NOT an extension of the cashier offline buy-in. It does **pure seat placement** — no buy-in, no fee, no
revenue impact. If the walk-in actually pays cash, the **cashier** "Buy-in tại quầy"
(`create_offline_buyin_and_seat`) handles money + seating separately. The two flows stay disjoint.

### RPC `floor_assign_player_to_seat`
```
floor_assign_player_to_seat(
  p_tournament_id         uuid,
  p_player_name           text,
  p_tournament_table_id   uuid,
  p_seat_number           int
) returns jsonb
```
Behavior (seat only — never touches money):
1. Auth (`auth.uid()` = owner/cashier of the tournament's club) + tournament-open + validation
   (`name>=2`, seat in `1..max_seats`).
2. Synthetic `player_id = gen_random_uuid()`, `entry_no=1`.
3. Create the entry/seat anchor with **zero money** — `buy_in=0`, `platform_fixed_fee=0`, `total_pay=0`,
   `reference_code` `FLOOR-…`. **Must NOT count as a paying confirmed registration** → zero revenue /
   rake impact (stays out of `rake_amount × paying confirmed entries`). Exact anchoring (a non-counting
   registration status vs. entry-only) = Phase-A detail; the invariant is **finance-neutral**.
4. **Claim the seat**: insert `tournament_seats` (`player_name=p_player_name`, `is_active=true`). The
   partial unique index guards — `unique_violation` → roll back, return `seat_occupied`
   (UI: "Ghế vừa bị lấy — chọn ghế khác").
5. Insert `seat_draw_receipts` (seat ticket, **no amounts**) + `seat_assignment_history`
   (`reason='floor_seat_add'`, `draw_type='manual'`).
6. Return `{ ok, table_number, seat_number, receipt_code, display_name }`.

### UI
- "Thêm người" in the detail sheet → form: **name (required)** + seat picker. **No money fields.**
- **Seat picker MUST hide occupied seats** — reuse the "selectable seats" logic shipped in
  `MovePlayerDialog` (free seats only; occupied seats never shown). Owner rule 2026-06-16.
- Confirm (restate name + table/seat) → RPC → `SeatReceiptDialog` (seat ticket, no amount).

---

## 3. Feature — Đóng bàn (close / break a table) + REDRAW + fill empty seats

**Goal:** standard tournament table break — when a table is closed, its players are **re-drawn** and
used to **fill the empty seats** at the remaining tables, keeping the room balanced.

**Owner-locked decisions (2026-06-16):**
- **Redraw scope = broken-table players ONLY.** Players already seated at other tables do not move;
  only the closed table's players are re-drawn. (Least disruptive, TDA-standard.)
- **Fill style = random, shortest-table-first.** The closed table's players are assigned to empty seats
  in **random** order (fairness) while filling the **currently shortest** table first (balance) — so no
  remaining table is left short.
- **No auto-open.** If there aren't enough empty seats, the break is **blocked** and the operator is told
  to open a table first — never auto-open (owner policy).

### RPC `close_tournament_table`
```
close_tournament_table(
  p_tournament_table_id  uuid,
  p_draw_mode            text default 'redraw_balanced',  -- 'redraw_balanced' | 'fill_lowest_table'
  p_reason               text default 'table_break'
) returns jsonb
```
`redraw_balanced` = the owner-locked default (random order, shortest-table-first).
`fill_lowest_table` = deterministic alternative (gom người vào bàn số nhỏ trước, no shuffle).

**Behavior (one atomic transaction — all-or-nothing):**
1. **Auth + lock.** actor = `auth.uid()` = owner/cashier of the tournament's club; tournament open;
   `SELECT … FOR UPDATE` on the tournament (serialize concurrent floor actions).
2. **Movers** = active `tournament_seats` at `p_tournament_table_id` → (entry_id, player_name, from_seat).
3. **Empty closed table** (no movers) → just `status='closed'`, history `reason='close_empty_table'`,
   return `{ok, closed:true, moved:[]}`.
4. **Holes** = every empty seat at OTHER active tables (`table_id` linked, `status='active'`,
   `id <> p_tournament_table_id`): for each, `seat_number ∈ 1..max_seats` with no `is_active` seat.
   Each hole carries its table's current occupancy.
5. **Capacity precheck:** `count(holes) ≥ count(movers)`? If NOT → **ROLLBACK**, return
   `insufficient_capacity {need, have}`. (No auto-open.)
6. **Redraw (`redraw_balanced`):**
   - Shuffle `movers` (random order → fairness).
   - Repeatedly pick the hole whose table currently has the **fewest** players (ties broken randomly);
     after each assignment, increment that table's running occupancy so the next pick re-balances.
     → players land on the shortest tables first, randomly ordered.
   - (`fill_lowest_table`: order holes by `table_number ASC, seat ASC`, no shuffle.)
7. **Apply each move** (mirror `move_player_seat`): claim the destination seat via the **partial unique
   index** `(table_id, seat_number) WHERE is_active=true`. On `unique_violation` (a concurrent grab) →
   re-pick another still-free hole; if none remain → **roll back the whole break**. Per move: flip the
   old seat inactive, insert the new active seat, **supersede old receipt → new receipt**
   (`draw_type='table_break'`), append `seat_assignment_history` (`reason='table_break_redraw'`,
   records from/to).
8. **Close source table:** `status='closed'`.
9. **Return** `{ ok, closed:true, table_number, moved:[{player_name, from_seat, to_table_number,
   to_seat_number, receipt_code}] }` — UI reprints each moved player's new receipt.

Errors: `unauthorized`, `actor_not_allowed`, `tournament_not_open`, `table_not_found`,
`insufficient_capacity`, `race_lost` (rollback after retry exhausted).

### "Cân bàn" (assisted) — auto-pick the shortest table
Optional companion: a room-level **"Cân bàn"** button computes the **shortest active table** and proposes
closing it (same RPC, **operator confirms** — no silent auto-close). This is "fill vào những ghế trống"
generalized: break the most-empty table to fill the scattered holes left by busts.

### UI (danger-styled, like `SeatDrawDialog`)
- **"Đóng bàn"** (per-table) → confirm: *"Bàn N có K người — sẽ bốc ngẫu nhiên sang ghế trống ở các
  bàn khác rồi đóng bàn."* + draw-mode toggle (mặc định: redraw cân bàn).
- **Progressive reveal** of each redraw move (reuse the `SeatDrawDialog` result-row pattern):
  "Nguyễn A → Bàn 3 · Ghế 5".
- On `insufficient_capacity`: block — *"Không đủ ghế trống (cần K, có M) — mở thêm bàn trước khi đóng"* —
  with a shortcut to **"+ Mở bàn"**.
- After success: list of moved players + **"In lại phiếu"** per player (new table/seat).

---

## 3B. Scheduled / Tournament Redraw (SEPARATE from close-table)

**Why separate:** the §3 broken-table redraw fires when *closing a table* and re-draws **only that
table's players**. A tournament also needs **scheduled** redraws driven by tournament rules, which may
re-seat a **wider eligible set**. These are a **distinct RPC** — never mixed into `close_tournament_table`.

### Redraw modes
| Mode | Eligible set | Buildable on current schema? |
|---|---|---|
| `broken_table` | the closed table's players only (= §3) | ✅ handled by `close_tournament_table` |
| `final_table` | all remaining active players when the **final table** is reached → consolidate onto 1 table | ✅ `final_table` status + `players_remaining` |
| `table_count_threshold` | all remaining active players when active table count ≤ a **configured** N → consolidate | ✅ count active `tournament_tables` |
| `itm` | players who are **ITM** (`is_itm` from `itm_places` + eliminations/leaderboard view) | ✅ ITM is derivable |
| `day2_itm` | players qualified to **Day 2** (multi-day) | ⛔ **schema-gated (deferred)** — no day/flight columns |
| `manual_custom` | a **TD-selected** entry/player set | ✅ no schema dependency |

**`table_count_threshold` is configurable** per tournament/series (not hardcoded). UI presets **3** and
**4**; **default 3** when unconfigured. **Day 2 is deferred** — needs a flight/day/bag/qualified schema
(`tournaments.day_number`, `tournament_seats.day`, …); spec the design, do **not** build in Phase A.

### RPC `redraw_tournament` (Phase A2 — not built in A1)
```
redraw_tournament(
  p_tournament_id        uuid,
  p_mode                 text,            -- final_table | table_count_threshold | itm | manual_custom | day2_itm(future)
  p_eligible_entry_ids   uuid[] default null,  -- required for manual_custom; ignored otherwise
  p_target_table_count   int  default null,    -- consolidation target (threshold / final_table)
  p_draw_mode            text default 'redraw_balanced',  -- random, shortest-table-first (reuse §3)
  p_dry_run              boolean default true  -- true → PREVIEW only, NO writes
) returns jsonb
  -- dry-run → { ok, mode, preview:true,   moves:[{player_name, from_table, from_seat, to_table, to_seat}] }
  -- commit  → { ok, mode, committed:true, moves:[{…, receipt_code}] }  |  { ok:false, blocked:{reason} }
```

### Rules (every scheduled redraw)
- **Never auto-run.** TD/Floor must confirm. `Cân bàn` / threshold may *suggest*, never execute silently.
- **Preview first** = `p_dry_run=true` returns the full assignment (ai → bàn nào · ghế nào) with **no
  writes**; operator reviews → commits with `p_dry_run=false`.
- **Atomic:** any mid-way error rolls back the whole redraw.
- **Receipts:** cancel old receipts, issue new ones for everyone moved.
- **Audit:** `seat_assignment_history` records the redraw type —
  `table_break_redraw | final_table_redraw | threshold_redraw | day2_itm_redraw | manual_redraw`.
- **Lock during redraw:** advisory lock / status flag on the tournament so concurrent hand-input /
  move-seat can't race the redraw.
- **Insufficient valid seats → block** with a clear reason (never auto-open a table).
- **No cashier money flow** — redraw moves seats only.

### Reuse
The §3 `redraw_balanced` fill (random order, shortest-table-first), the partial-unique seat claim,
receipt supersede, and `seat_assignment_history` machinery. `auth.uid()` actor + owner/cashier gate.

---

## 4. Cross-cutting

- **Feature flag** `floorTableOps` (new, default **false**) gates all three UI actions. While off, the
  buttons stay disabled "Cần bật RPC" AND the click handlers guard `if (!FLAG) return;` (defence in
  depth — never call a missing RPC). Mirrors `offlineBuyIn` / `registrationExtensions`.
- **Source-only migrations**, owner-gated controlled apply later (preflight → CREATE OR REPLACE →
  verify grants/SECURITY DEFINER/search_path → idempotency rerun → rollback note). No `supabase db push`,
  no `deploy_db=true`, no `schema_migrations` edit.
- **Untouched:** payroll, dealer swing, game engine, tracker runtime, online registration behavior.
- **Revenue:** "Thêm người" is **finance-neutral** (pure seat placement, zero amounts) — money only
  enters via the cashier offline buy-in, which stays prize-pool pass-through (buy-in) + rake reconciled
  through `tournament_registrations` (unchanged). Redraws never touch money.
- **Types:** new RPCs aren't in generated Supabase types until applied → narrow local cast at the call
  site only (`(supabase.rpc as any)(...)` with a `// TODO: remove after DB apply + types regen`).

## 5. Decisions

### Resolved (owner-locked 2026-06-16)
**Close-table redraw**
- Redraw scope: broken-table players **only** (others don't move).
- Fill style: **random, shortest-table-first** (`redraw_balanced`).
- Insufficient seats: **block** + prompt "+ Mở bàn" — **never auto-open**.
- "Cân bàn" helper: auto-picks the shortest table, **operator confirms** (no silent auto-close).

**Scheduled / tournament redraw**
- A **separate RPC** (`redraw_tournament`), Phase **A2** — never mixed into close-table.
- `table_count_threshold`: **configurable** per tournament/series; UI presets 3 & 4; **default 3**.
- **Day 2 / multi-day: deferred** (needs flight/day schema) — design only, not Phase A.

**Mở bàn / Thêm người**
- Mở bàn always **manual**; supports **both** creating a new table **and** reopening a closed one. The
  existing `add_table` edge-fn path is bulk-save/no-audit → build a dedicated `open_tournament_table` RPC.
- `max_seats` = read tournament/series config if present, **fallback 9** (or mode of existing tables).
- "Thêm người" = **pure seat placement, NO money** — a **new floor RPC** (`floor_assign_player_to_seat`),
  separate from the cashier offline buy-in; **finance-neutral**.

### Still open (Phase-A implementation detail)
- Floor add-player anchoring: a non-counting registration status vs. entry-only — pick whichever keeps it
  **finance-neutral** (zero rake/revenue) while remaining move-eligible + receiptable.

## 6. Build order (when approved)

**Phase A1 — core table ops (source-only draft PR):**
1. Migrations (new RPCs only): `open_tournament_table` (create new + reopen closed),
   `close_tournament_table` (broken-table `redraw_balanced` + capacity precheck),
   `floor_assign_player_to_seat` (pure seat placement, no money).
2. UI: `OpenTableDialog`, `AddPlayerDialog` (name + hidden-occupied seat picker, **no money fields**),
   `CloseTableDialog` (danger confirm + progressive redraw reveal + reprint receipts); wire the three
   buttons in `FloorTableDetailSheet` + room-level "+ Mở bàn" / "Cân bàn".
3. `featureFlags`: `floorTableOps=false`; buttons "Cần bật RPC".
4. `npx tsc --noEmit` + `npm run build`; diff + forbidden-path proof; draft PR (FE + source-only
   migrations → flag to Coordinator; nothing applied by merge).

**Phase A2 — scheduled redraw (separate, larger):**
5. Migration: `redraw_tournament` (modes `final_table` / `table_count_threshold` / `itm` /
   `manual_custom`; `day2_itm` deferred) + dry-run preview + redraw lock + audit reasons.
6. UI: redraw launcher with **preview → confirm** flow.

**Controlled apply (owner-gated, separate):**
7. Apply A1 migrations → flip `floorTableOps=true` → floor UAT: open/reopen a table; seat a walk-in
   (no money) with a seat ticket; **break a table and verify players are randomly re-drawn into the
   shortest tables first, all get new receipts, room stays balanced**; `insufficient_capacity` blocks
   (no auto-open). Then apply A2 → UAT each redraw mode via dry-run **preview before commit**.

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
