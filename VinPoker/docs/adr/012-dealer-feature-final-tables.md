# ADR 012 — Dealer Swing: Feature / Final Table dealer pools

- **Status:** Accepted — decision record. This is the **gate before any DB/RPC/enforcement patch** (Patch 2+). Patch 1 (UI mock, flag OFF) may proceed independently.
- **Date:** 2026-06-24
- **Mode:** CRITICAL (DB / RLS / Dealer-Swing correctness).

## Context
Dealer Swing currently auto-rotates *any* eligible dealer onto *any* open table. The owner wants a special-table operations layer:
- **Feature / spotlight tables** (livestream, VIP, hot tables) — only a **selected pool** of dealers may rotate in.
- **Final tables** — only selected (usually best) dealers; a final table is often *also* the livestream/feature table.

Hard product rule: if no pooled dealer is available, the system must surface a **shortage** and **never silently substitute a normal dealer** onto a feature/final table — only an authorized floor **override** may, with an audit record.

A read-only audit of `origin/main` established the ground truth (and corrected two assumed blockers):
- `perform_swing` has **one** canonical signature (`20260925000000_perform_swing_orphan_break_cleanup.sql`) and locks `FOR UPDATE OF da` — the feared "overload bomb" is already resolved.
- The dealer entity is `public.dealers` (`20260522000001`); the `da.dealers` "bug" is a false alarm (a JSONB alias).
- Manual assignment is `assign_dealer_to_table` (`20260801000005`), `SECURITY DEFINER`, locking attendance `FOR UPDATE SKIP LOCKED`.
- **Auto dealer *selection* runs in TypeScript** (`supabase/functions/_shared/pickNextDealer.ts`, driven by `functions/process-swing/index.ts`); `perform_swing` is a pure executor receiving a pre-chosen `p_next_attendance_id`. ⇒ the eligibility guard must live in **both** the TS picker (so it picks correctly) **and** the SQL RPCs (authoritative).
- Availability: `dealer_attendance.current_state` (available|assigned|on_break|checked_out) + `priority_break_flag` + `pool_entered_at`; `dealer_breaks`; `dealer_assignments.status`.
- `dealer_assignments.table_id → game_tables(id)`; `tournament_tables(tournament_id, table_id→game_tables, UNIQUE(table_id))` is only a bridge.

## Decisions

### DR-1 — Flag ↔ enforcement are DECOUPLED (resolves P0-1)
Enforcement (TS picker + SQL) keys on **profile data** (whether a table has a feature/final profile), gated by a **server-side kill-switch stored in `app_settings`** (key `dealer_feature_tables_enabled`; absent/false ⇒ disabled). The SQL helper **and** the TS picker read the **same** `app_settings` source.
`FEATURES.dealerFeatureTables` (TypeScript) gates **only the UI surface** (badges, config dialog, initial UI read) — it is **never** the security boundary, and the picker must **not** filter on it (otherwise picker-OFF + SQL-ON ⇒ a spurious reject on the most important table).
- *Reason:* SQL cannot read a TS constant; "flag OFF = safe" was false.
- *Evidence:* `src/lib/featureFlags.ts` (TS const); `app_settings` exists (`20260425130330…`); `current_setting('app.*')` GUC already used (`20260525000001`).
- *Affects:* Patch 3 (helper reads `app_settings` + profile), Patch 5 (picker reads the same), Patch 6, rollback wording.

### DR-2 — Canonical lock order (resolves P0-2)
Acquisition order is **`dealer_table_profiles` (the table's single row) → `dealer_attendance` / `dealer_assignments`**.
- The eligibility helper `_assert_dealer_allowed_for_table` performs a **plain consistent SELECT** of the profile + pool (it does **not** lock `dealer_table_pool_members`; a concurrent config change is eventual-consistent and applies to the *next* assignment).
- `set_table_dealer_mode` / `set_table_dealer_pool` lock the **profile row first** (single serialization point).
- `perform_swing` keeps `FOR UPDATE OF da`; `assign_dealer_to_table` keeps attendance `FOR UPDATE SKIP LOCKED`; the eligibility read runs **before** those locks (or as a non-locking read), so no path mixes pool-then-da vs da-then-pool.
- A lock-order comment is mandatory in each touched function.
- *Evidence:* `perform_swing` (`20260925000000`), `assign_dealer_to_table` (`20260801000005`).

### DR-3 — Apply-order rule + absence guard (resolves P0-3)
**Hard rule:** do not apply the enforcement patches (Patch 4/5) before the table patch (Patch 2) is applied.
Every RPC that reads the new tables includes a graceful guard:
```
IF to_regclass('public.dealer_table_profiles') IS NULL THEN
  -- treat table as normal / skip feature enforcement
END IF;
```
This degrades safely if applied out of order or the tables are absent (and makes the flag-OFF-but-applied state safe). `to_regclass` is standard PostgreSQL.

### DR-4 — Migration numbering (resolves P1-1)
Migration timestamps are a **monotonic, future-dated sequence**, not real dates (max on `main` ≈ `20261103000000`). New migrations must use a slot **greater than the current max** (e.g. `20261104000000`); re-check the max at build time. **Never** use a real-date `20260624…` slot — it would sort *before* existing migrations and break apply order.

### DR-5 — tournament → game_tables for `is_final` (resolves P1-2)
Profiles key on the **stable `game_tables.id`** (dealer assignments use `game_tables`; `tournament_tables` is only a bridge). `is_final` is **mutable**, set by floor/TD **when the final table actually forms** (via `set_table_dealer_mode`), not hard-set early. `get_table_dealer_rules(p_tournament_id)` resolves tournament → tables via `tournament_tables` → `game_tables` → profiles. Config does **not** auto-carry to a newly-formed FT `game_table`; the floor re-designates it (a documented operational step).

### DR-6 — Shortage operations + break precedence (resolves P1-3 / P1-4)
On `FEATURE_DEALER_SHORTAGE` / `FINAL_TABLE_DEALER_SHORTAGE`: **keep the current dealer seated** (no force-push), **defer their due break with an audit row**, and **raise an alert**. The table is never left dealer-less mid-hand. A floor **manual override** (assign path) is the only escape. Precedence: covering a feature/final table **outranks** a scheduled break when no pooled relief exists (defer the break, audited).

### DR-7 — Role model (resolves P1-5)
Managing feature/final config is allowed for `super_admin` / `club_admin` / `clubs.owner_id` / membership in **`club_dealer_controls`** (the real "dealer-control" concept — `20260522000001`). Reuse the existing role-for-club pattern; **no new role is invented**.

### DR-8 — Bundled P2 decisions
- (a) A table that is both feature and final ⇒ **final precedence** (`FINAL_…` over `FEATURE_…`) for shortage + badge.
- (b) **Override exists only on the manual assign path**; the auto swing path has **no override** — it surfaces a shortage. Override authz = floor/owner/admin (narrower than config read); `reason` is `NOT NULL` / non-empty; the audit payload records `{table, normal dealer filled, actor, reason, shortage context, override=true}`.
- (c) **Cross-club integrity** via composite FK / CHECK (`club_id` matches the `game_table`'s club; the dealer belongs to the same club) — not RPC validation alone.
- (d) `table_mode='normal'` + `is_final=true` **must still restrict** to the pool ⇒ enforcement uses **OR-semantics**: a table is "special" when `table_mode='feature' OR is_final=true`. Covered by a test.
- (e) Flipping `normal → feature` applies to the **next** swing only; it never yanks a seated normal dealer mid-down.
- (f) **Empty pool + special = permanent shortage** ⇒ validation blocks publishing a feature/final table with an empty pool.
- (g) `get_table_dealer_rules` authz: dealers must **not** read pools (do not leak "who is feature-worthy").
- (h) **Per-table isolation** in `process-swing`: one table's shortage must not abort the whole swing cycle.
- (i) Realtime (Patch 6): if the new tables are added to a publication, re-audit RLS for cross-club pool leakage.

## Schema (Patch 2 — source-only, slot `> 20261103000000`)
- `dealer_table_profiles(id, club_id→clubs, table_id→game_tables UNIQUE, table_mode text CHECK(normal|feature) DEFAULT normal, is_final boolean DEFAULT false, allow_override boolean DEFAULT false, display_label, created_at, updated_at)` + `updated_at` trigger + CHECK keeping `club_id` consistent with the `game_table`'s club.
- `dealer_table_pool_members(id, club_id→clubs, table_id→game_tables, dealer_id→public.dealers, priority int DEFAULT 100, is_primary boolean DEFAULT false, created_at, UNIQUE(table_id, dealer_id))` + composite FK enforcing same-club (DR-8c).
- RLS: deny-by-default writes; manage per DR-7; club-scoped reads; dealers cannot read pools (DR-8g).

## Patch order (one PR each; STOP for approval between)
1. **Patch 1 — UI mock** (badges Thường/Tâm điểm/Final, filters, config-dialog shell, right-rail "Đội dealer tâm điểm" box; mock state; `FEATURES.dealerFeatureTables` OFF). Draft PR.
2. **ADR 012 (this)** — doc-only PR. *Gate.*
3. **Patch 2 — tables + RLS + trigger** (source-only; DR-3 absence-ready; DR-7 roles; DR-8c FK).
4. **Gate — controlled apply + types regen** (owner-gated).
5. **Patch 3 — helper + `set_/get_` RPCs** (DR-2 lock order; reads the `app_settings` kill-switch; authz; audit).
6. **Patch 4 — enforce manual assign** (override + audit + absence guard).
7. **Patch 5 — enforce swing** (picker filters on profile + `app_settings`, **not** on `FEATURES`; `perform_swing` authoritative re-check; shortage keep-seat per DR-6; per-table isolation DR-8h).
8. **Patch 6 — wire UI ↔ RPC + shortage cards + realtime** (DR-8i re-audit RLS if published).

**Stop conditions:** stop if forced to edit an old migration, add a lock outside the DR-2 order, gate picker/SQL on different flag sources, give the auto-swing path an override, or if a safe lock order cannot be determined (report, do not guess).

## Consequences / safety / rollback
- Source-only migrations; flag OFF; owner-gated apply; read-only `db-safety` + `rls-security` auditors before every DB/enforce PR; fresh branch off `origin/main` per patch.
- **Rollback (corrected vs the original plan):** reverting the FE PR / flag OFF hides the UI but **does not disable SQL enforcement once profiles exist** (DR-1). The true global off is `app_settings.dealer_feature_tables_enabled = false`. After a DB apply: snapshot `pg_get_functiondef(assign_dealer_to_table)` / `pg_get_functiondef(perform_swing)` and `pickNextDealer.ts` before Patches 4–5; rollback = restore those bodies + `DROP` the two new tables/RPCs (independent, cascade-safe).

## Amendments (2026-06-24, owner review during Patch 2)
- **A1 (P1-E) — pool→profile FK.** `dealer_table_pool_members.table_id` references **`dealer_table_profiles(table_id)`** (a `NOT NULL UNIQUE` column), NOT `game_tables` directly. A pool row therefore cannot exist without a profile → the DR-2 lock-anchor (the profile row) always exists, there are no orphan pools on normal tables, and the cascade is 2-hop `game_table → profile → pool`. Supersedes the original schema's `pool.table_id → game_tables`.
- **A2 (P1-A) — multiple primaries.** Several `is_primary = true` rows per table are allowed; `is_primary` is **display-only**. The Patch-5 picker orders candidates deterministically by `priority ASC, is_primary DESC, created_at ASC, dealer_id ASC`. No partial unique index on `is_primary`.
- **A3 — distinct error codes.** Same-club violations `RAISE EXCEPTION` with distinct SQLSTATEs — `DT001` (table not in club), `DT002` (dealer not in club), `DT003`/`DT004` (table/dealer missing) — so callers (Patch-3 RPC + dialog) switch on SQLSTATE, not message text. Cross-club surfaces at config time only (pools are same-club by the time Patch 4/5 run).
- **A4 — audit sinks (P1-F, reuse).** Config changes (`set_table_dealer_mode`/`set_table_dealer_pool`) and override-assigns log to existing **`public.audit_logs`** (`actor_id, club_id, action, entity_type, entity_id, payload`); swing-time shortage events log to existing **`public.swing_audit_logs`** (`club_id, table_id, action, details, error_message`). No new audit table.
- **A5 — `table_type` ⟂ `table_mode`.** `game_tables.table_type` (cash|tournament|vip = game/stakes) is **orthogonal** to `table_mode` (dealer-pool policy). The UI/Patch-6 must not conflate a "vip" game table with a "feature" dealer-pool table.
- **A6 — invariants.** `game_tables.club_id` is treated as immutable (the denormalized `club_id` is validated only on writes to the new tables, matching the `dealer_assignments` precedent). The same-club triggers do NOT validate `dealers.status` — status/availability is an assign-time check (Patch 5), not config-time. `dealers` is soft-deleted (`deleted_at`), so the `dealer_id` cascade rarely fires; Patch 5 must exclude inactive/deleted dealers at assign-time.
