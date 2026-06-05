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

---

## 🩺 Monitoring Dashboard Queries

**File:** `docs/monitoring/phase1_24h_check.sql` — full version with 4 queries
**View:** `dealer_state_health` — quick health check (single row)

### 1. Quick health check (run anytime)

```sql
SELECT * FROM dealer_state_health;
```

**Returns:** `available_but_assigned`, `assigned_but_no_assignment`, `stuck_pre_assigned`, `total_checked_in`, `on_break_count`, `available_count`, `refreshed_at`

**Healthy state:** all inconsistency counts = 0

### 2. Stuck pre-assigns (run every 2-4 hours)

```sql
SELECT
  COUNT(*) as stuck_count,
  MIN(swing_due_at) as oldest_stuck,
  array_agg(DISTINCT table_id) as affected_tables
FROM dealer_assignments
WHERE status = 'assigned'
  AND pre_assigned_attendance_id IS NOT NULL
  AND swing_due_at < NOW() - INTERVAL '5 minutes'
  AND released_at IS NULL;
```

**Expected:** `stuck_count = 0`

### 3. Confirmed bugs in diagnostic (run after 24h)

```sql
SELECT
  timestamp,
  club_id,
  result->>'confirmed_bug' as confirmed_bug,
  result->>'lost_rows' as lost_rows
FROM diagnostic_logs
WHERE diagnostic_type = 'pass3_query_issue'
  AND timestamp > NOW() - INTERVAL '24 hours'
  AND (
    (result->>'confirmed_bug')::boolean = true
    OR (result->>'lost_rows')::int > 0
  )
ORDER BY timestamp DESC;
```

**Expected:** 0 rows

### 4. Pass 3 execution consistency (run after 24h)

```sql
SELECT
  date_trunc('hour', timestamp) as hour,
  COUNT(*) as diagnostic_runs,
  AVG((result->'simple_query'->>'count')::int) as avg_assignments_found
FROM diagnostic_logs
WHERE diagnostic_type = 'pass3_query_issue'
  AND timestamp > NOW() - INTERVAL '24 hours'
GROUP BY hour
ORDER BY hour DESC;
```

**Expected:** ~120 runs/hour (60 cycles × 2 clubs)

---

## 🚨 Alert Thresholds

| Metric | Threshold | Severity |
|--------|-----------|----------|
| `available_but_assigned` > 0 | Immediate | CRITICAL — B6 regression |
| `assigned_but_no_assignment` > 0 | Immediate | CRITICAL — orphaned state |
| `stuck_pre_assigned` > 0 | After 5 min | HIGH — Pass 3 not processing |
| `confirmed_bug = true` | Any | CRITICAL — PostgREST regression |
| `stuck_count > 3` | After 30 min | MEDIUM — investigate |
| Diagnostic runs missing 1+ hours | After 1h | HIGH — cron may be stuck |

---

## 📅 Monitoring Schedule (24-48h)

| Time | Action |
|------|--------|
| +2h  | Run Query 1, 2 (health + stuck) |
| +6h  | Run Query 1, 2 |
| +12h | Run all 4 queries |
| +24h | Run all 4 queries + Q4 (log size) |
| +48h | Decision: continue monitoring OR execute Phase 2-4 |

---

## 🔀 Branch Strategy Notes

**IMPORTANT:** As of 2026-06-05, repo has 3 local branches with DIFFERENT content:

| Branch | Purpose | Last commit | Status |
|--------|---------|-------------|--------|
| `master` | Application code (B6, Phase 1) | 7611e28 (Phase 1) | ACTIVE — what I'm working on |
| `main` | CI/CD workflow fixes | d95cada | DIFFERENT — has CI configs |
| `opencode/backup` | Feature experiments | 96538ea | DIFFERENT — has features not in master |

**GitHub default:** `origin/HEAD -> origin/main`

**Decision needed:**
- Is `main` the actual production branch?
- Should `master` merge into `main` for CI to pick up?
- Or vice versa?
- `opencode/backup` — keep, archive, or delete?
