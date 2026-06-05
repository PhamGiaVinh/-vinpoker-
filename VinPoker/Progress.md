# VinPoker Progress

**Last updated:** 2026-06-05

---

## Phase 1: COMPLETE ✅

**Date:** 2026-06-05
**Branch merged:** `fix/phase1-nested-select-diagnostic` → `master`

### What was done
- Added `diagnostic_logs` table for monitoring Pass 3 query behavior
- Created `idx_assignments_due_swing` partial index (query: 0.082ms)
- Added non-blocking diagnostic that compares simple vs nested query
- Auto-cleanup function for diagnostic logs (7 days retention, daily at 3am UTC)

### Results
- **6 diagnostic runs** in 2 minutes (3 cron cycles × 2 clubs)
- **0 confirmed bugs** (PostgREST nested select works correctly)
- **0 partial row loss**
- **2 stuck assignments auto-processed** after deploy (cold restart likely fixed original issue)

### Files changed
- `supabase/migrations/20260605_diagnostic_logs.sql` (NEW, applied)
- `supabase/migrations/20260605_idx_assignments_due_swing.sql` (NEW, applied)
- `supabase/migrations/20260605_diagnostic_logs_cleanup.sql` (NEW, applied)
- `supabase/functions/process-swing/diagnostics.ts` (NEW, deployed)
- `supabase/functions/process-swing/index.ts` (EDIT, deployed)
- `docs/diagnostics/PHASE1_NESTED_SELECT_DIAGNOSTIC.md` (NEW)
- `docs/monitoring/phase1_24h_check.sql` (NEW)
- `docs/backlog/README.md` (NEW)

### Monitoring mode: ACTIVE
- Check `docs/monitoring/phase1_24h_check.sql` every 2-4 hours
- Decision point: 24-48h
- Expected: all queries return 0/empty

---

## Phase 2: PAUSED ⏸️

**Date:** TBD
**Reason:** Awaiting 24-48h monitoring results before implementing lock timeout fix

### Decision criteria
- If `stuck_count = 0` for 48h → **CANCEL** Phase 2 (bug was cold restart)
- If `stuck_count > 3` or consistent pattern → **EXECUTE** Phase 2
- If `diagnostic confirmed_bug = true` → Analyze which locations hit

### What was planned
- Lock timeout crisis fix (per-club execution time budgeting)
- Graceful degradation (skip non-critical passes at 40s)
- Emergency exit at 48s
- Multi-club loop with budget tracking

---

## Backlog (Phase 4 candidates)

5 hidden bugs documented in `docs/backlog/README.md`:

| # | Issue | Priority | Est. Time |
|---|-------|----------|-----------|
| #3 | OT not cleared on pre-assign | P2 | 1h |
| #7 | auto_swing_enabled bypass | P2 | 30min |
| #8 | Stagger wraparound at 10 tables | P2 | 1h |
| #9 | !inner silent data loss in Pass 0c | P3 | 30min |
| #10 | Non-atomic transition in Pass 1c | P3 | 1h |
| #11 | TOCTOU race in pickNextDealer | P3 | 1h |

**Total:** ~5 hours. No GitHub issues created — on-demand when evidence appears.

---

## Completed Phases (before monitoring)

- ✅ B6+ 3-layer defense architecture
- ✅ P1a atomic `assign_dealer_to_table` RPC
- ✅ P1b break release fix
- ✅ Break Duration Dialog
- ✅ B1-B5 bug fixes
- ✅ Soft-delete pattern
- ✅ Rotation Planner Phase 1
