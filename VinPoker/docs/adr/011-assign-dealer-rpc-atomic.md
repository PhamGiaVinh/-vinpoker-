# ADR-011: Atomic `assign_dealer_to_table` RPC v2 (JSONB)

## Status

Deployed — 2026-06-05

## Context

Bug B6: Dealer could hold 2+ active assignments simultaneously (1 `on_break` + 1 `assigned` at different tables). Root cause: the `assign_dealer_to_table` RPC and `assign-dealer` edge function had separate, non-atomic release + insert steps. Race conditions and missing guards allowed duplicate active assignments.

The original RPC returned `TEXT` (`'ok' | 'conflict' | 'table_occupied'`), had no idempotency check, used `NOW()` inconsistently, and had inverted `FOR UPDATE SKIP LOCKED` logic in the table-occupied check.

## Decision

Rewrite `assign_dealer_to_table` as an atomic, idempotent, JSONB-returning RPC with 7 params, serving as the **single source of truth** for all dealer-table assignment operations.

### Architecture: 3-layer B6 defense

| Layer | Mechanism | Purpose |
|---|---|---|
| **Layer 1** | Atomic RPC (`assign_dealer_to_table` v2) | Prevents orphans in the first place — releases old assignments and inserts new one in 1 transaction |
| **Layer 2** | DB unique index (`idx_one_active_per_dealer`) | Hard stop — raises `UniqueViolation` if 2+ active assignments slip through |
| **Layer 3** | Reactive reconcile (Pass 0d Step 1.5 + `pickNextDealer` guard) | Cleanup any orphans that do get created |

### RPC signature

```sql
CREATE OR REPLACE FUNCTION assign_dealer_to_table(
  p_attendance_id    UUID,
  p_table_id         UUID,
  p_assigned_at      TIMESTAMPTZ  DEFAULT NOW(),
  p_swing_due_at     TIMESTAMPTZ  DEFAULT NULL,
  p_club_id          UUID          DEFAULT NULL,
  p_idempotency_key  TEXT          DEFAULT NULL,
  p_force_replace    BOOLEAN       DEFAULT false
) RETURNS JSONB
```

### Steps (in order)

| Step | Action | Purpose |
|---|---|---|
| 0 | Idempotency check (`SELECT ... WHERE idempotency_key = ...`) | Return existing assignment on retry, before any side effects |
| 1 | Lock attendance (`FOR UPDATE SKIP LOCKED`) | Prevents concurrent assignment of same dealer |
| 2 | Check table occupied (`IF NOT p_force_replace AND EXISTS(...)`) | Skip if force_replace; read-only check (no locking) |
| 3 | Release existing assignment at target table (CTE `WITH released AS (UPDATE...RETURNING)`) | Displace current dealer when force-replacing |
| 4 | Release orphan assignments at OTHER tables | B6 fix — prevents 2+ active assignments for same dealer |
| 5 | Clear stale `needs_replacement` flag | Housekeeping |
| 6 | Resolve `club_id` (from param or `game_tables`) | Satisfy NOT NULL constraint |
| 7 | INSERT new assignment | Atomic — protected by unique index |
| 8 | UPDATE dealer state to `'assigned'` | State machine transition |

### Return format (JSONB)

```json
{ "outcome": "ok", "assignment_id": "uuid", "orphan_count": 0 }
{ "outcome": "ok", "assignment_id": "uuid", "orphan_count": 0, "idempotent": true }
{ "outcome": "conflict", "detail": "Dealer not available or locked" }
{ "outcome": "table_occupied", "detail": "Table already has an active dealer" }
```

### Key design decisions

1. **Idempotency before side effects** (Step 0) — prevents releasing old dealers on retry
2. **`IF EXISTS` instead of `FOR UPDATE SKIP LOCKED`** for Step 2 — the SKIP LOCKED logic was inverted; read-only check is correct
3. **Set-based CTE** for Step 3 — no FOR loop, no risk of processing same attendance twice
4. **`displaced_by_new_assignment`** as Step 3 release reason — not `p_release_reason` (which is for the new assignment, not the old one)
5. **`p_force_replace` flag** — `assign-dealer` edge fn passes `true`; `fillEmptyTables`/`checkout-dealer` use default `false`
6. **`v_now` variable** — consistent timestamp throughout transaction
7. **`p_release_reason` removed from signature** — caller audit logs are sufficient; release reasons hardcoded per step

## Breaking changes

- Return type: `TEXT` → `JSONB`
- All callers must handle both formats during migration window
- `DROP FUNCTION` covers 3 possible previous signatures (4-param production, 7-param staging, safety net)

## Migration strategy

1. **Phase 1**: Update callers to handle both `TEXT` and `JSONB` responses (`typeof rpcResult === "string" ? rpcResult : rpcResult?.outcome`)
2. **Phase 2**: Apply RPC migration (TEXT → JSONB)
3. **Phase 3**: Refactor `assign-dealer` edge fn to call RPC instead of direct INSERT

This order ensures no broken window — callers work with both old and new RPC response formats.

## Callers

| Caller | Changes | `p_force_replace` |
|---|---|---|
| `assign-dealer` edge fn | Replaced direct INSERT + manual orphan release with single RPC call | `true` |
| `fillEmptyTables.ts` | JSONB return type handling + `table_occupied` explicit break | `false` (default) |
| `checkout-dealer` | Added `p_swing_due_at` + JSONB handling + `table_type`-aware config lookup | `false` (default) |
| `seed-swing-test.mjs` | Fixed param order + handles JSONB response | N/A |

## Integration test

B16 in `seed-swing-test.mjs`: Attempts duplicate `INSERT` for same `attendance_id` at different table. Expects `UniqueViolation` (error code `23505`).

## Monitoring

- `ORPHAN_ALERT_THRESHOLD = 3` in `process-swing/index.ts` (down from hardcoded `5`)
- `TOTAL_FIXES_ALERT_THRESHOLD = 5` for aggregate reconciliation fixes