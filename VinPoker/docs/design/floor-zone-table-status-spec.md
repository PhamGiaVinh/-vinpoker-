# Floor Map — Zone grouping + 4-state table status (backend spec)

Status: **SPEC / not implemented.** Design only — no migration is applied by merging this doc. Any DB change here is source-only → review → controlled owner-gated apply, then a `FEATURES` flag flip.

## Why
The Floor Map (`FloorTableMapPanel`) now renders poker-table-shape icons (shipped), but two things from the target mockup still need a small backend addition:
1. **Zone grouping** (Zone A–E rows) — there is **no `zone` field** in the data today, so the live map is a flat grid by table number.
2. **4-state runtime status** (Mở/Available · Đang chạy/Running · Tạm dừng/Paused · Đóng/Closed) — today the client only derives 3 states from occupancy + `tournament_tables.status` (đang chơi / trống/đầy / đóng). "Running" vs "Paused" needs a real source.

## Current state (live)
- `tournament_tables`: `id, tournament_id, table_id (→game_tables.id), table_number, max_seats, status CHECK('active','broken','closed')`. **No zone column.**
- `FloorTableMapPanel` derives status client-side: `closed` (status≠active) · `full` (occ==max) · `playing` (occ>0) · `empty` (occ==0); occupancy from `get_seats` (active seats). Filters/search/density + table-icon already shipped.
- Dealer assignment lives in the **Dealer Swing** module (`dealer_assignments`/`game_tables`) — read-only only from Floor; do not write.

## A. Zone field
- **Migration (source-only):** `ALTER TABLE public.tournament_tables ADD COLUMN IF NOT EXISTS zone TEXT;` (nullable). Optional backfill: leave NULL (UI groups NULL under "Khác / chưa phân khu").
- **RLS:** unchanged (existing `tournament_tables` policies cover the new column).
- **Write path:** zone is set when a table is added/edited (floor table setup). Reuse the existing table add/edit flow; add a `zone` select (A–E or free text). No new RPC required for a simple column update under RLS.
- **UI:** `FloorTableMapPanel` groups `enriched` by `zone` (stable order: defined zones first, then "Khác"), rendering one labelled row per zone (matches mockup). Behind `FEATURES.floorZones` until the column is live.

## B. 4-state runtime status
Target states + sources:
| State | Color | Derivation |
|---|---|---|
| **Đóng** (closed) | red/dim | `tournament_tables.status ∈ (broken, closed)` |
| **Tạm dừng** (paused) | amber | tournament on break (`tournaments.status='break'` or current level `is_break`) → room-wide paused; (later: per-table paused flag) |
| **Đang chạy** (running) | blue | active + has ≥1 active seat + (optionally) a dealer assigned to the table |
| **Mở** (open/available) | green | active + seats < max (incl. 0) |
| *(full)* | sub-state of running | occ == max |

Recommended read path: a **source-only read-only RPC** `get_floor_table_status(p_tournament_id)` returning per table `{ tt_id, table_number, zone, status, occupied, max_seats, dealer_name? }`, so the client gets the computed status in one call instead of N client joins. Combines `tournament_tables` + active-seat counts + `tournaments` break state (+ optional read-only dealer-assignment join). SECURITY INVOKER (RLS applies). Until live, the client keeps the current 3-state occupancy derivation; the icon already supports any status color.

## C. Rollout (owner-gated)
1. Source-only migration: `zone` column + `get_floor_table_status` RPC (defined, not applied).
2. Review → **controlled apply** in a dedicated Supabase session (preflight, snapshot, apply, verify, rollback note).
3. Flip `FEATURES.floorZones` / wire the status RPC in `FloorTableMapPanel`. Frontend ships dark behind the flag first.

## D. Fee (rake) ↔ Payroll/Owner-Finance link
The future **Create Blind Structure** flow should capture **Fee (rake)** per buy-in (replaces a "currency" field). Rake is the club's cut per entry → total rake feeds **tournament revenue** and is reconciled in **Payroll / Owner Finance** (Net = buy-in×entries − payout − rake). Persist rake on the tournament (e.g. `tournaments.rake_amount` / `rake_pct`) — separate spec; do not silently change saved payroll/revenue numbers (see payroll safety rules). Cross-ref: payroll audit + Owner Finance dashboard.

## Risks / boundaries
- Dealer-assignment read crosses the Dealer Swing module — **read-only**; never write `dealer_assignments` from Floor.
- "Paused" room-wide (break) is a coarse first cut; true per-table pause needs a table-level field — defer.
- Zone backfill is cosmetic; NULL zone must render gracefully ("Khác").
- No DB apply, no `supabase db push`, no `deploy_db=true` from this spec.

Related: `FloorTableMapPanel.tsx`, [[project-floor-uiux-redesign]], payroll/Owner-Finance specs, Dealer Swing (read-only dealer assignment).
