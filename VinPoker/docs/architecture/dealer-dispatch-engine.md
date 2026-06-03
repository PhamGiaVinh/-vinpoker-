# Dealer Dispatch Engine

## Architecture

The Dealer Swing system has two distinct layers that must never be mixed:

### Layer 1 — Manual Actions (UI scope)

One action = one table only. No side effects on other tables.

- **Swing Button**: calls `supabase.rpc("perform_swing", { p_assignment_id })` for a single assignment
- **Assign Button**: calls `supabase.functions.invoke("assign-dealer")` for a single table
- **Send to Break**: calls `supabase.functions.invoke("manage-break")` for a single dealer

User feedback is per-table: loading spinner on the clicked button, toast for success/failure.

### Layer 2 — Automatic Engine (Background scope)

Triggered by `process-swing` edge function (runs every 1 minute via cron).

Scans ALL overdue tables and applies recovery policy:

| Level | Condition | Action |
|-------|-----------|--------|
| 0 | T-6 min before swing_due_at | Pre-assign next dealer |
| 1 | OT < 5 min | Auto retry current dealer |
| 2 | OT 5-15 min | Relaxed constraints — allow less-qualified dealers |
| 3 | OT > 15 min | Emergency assignment + Telegram alert |
| 4 | OT > 30 min | Escalate to Attention Queue (critical) |

## Key Principle

**Never mix manual and automatic scope.**

- User clicks button → single table
- Engine runs background → all tables
- No bulk UI actions unless explicitly requested ("Swing All" button)

## Handler Reference

| Action | Handler | Scope |
|--------|---------|-------|
| Single table swing | `performSwingForTable(assignmentId)` | Per-assignment |
| Bulk swing all | `autoSwingAll()` | All clubs/shift |
| Single table assign | `openAssignModal(tableId)` → `confirmAssign()` | Per-table |
| Send to break | `sendToBreak(attendanceId)` | Per-dealer |

## Files

- `src/components/cashier/DealerSwingTab.tsx` — UI, button handlers
- `src/hooks/useDealerSwing.ts` — data hooks, RPC helpers
- `supabase/functions/process-swing/index.ts` — automatic engine
- `supabase/migrations/` — `perform_swing` RPC, `transition_dealer_state`