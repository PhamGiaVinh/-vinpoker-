# Plan: Align process-swing với Master Architecture

## Tổng quan

Dựa trên master plan, tôi propose **4 phase** với tổng cộng **11 changes**. Mỗi change có code kèm theo để review.

> **CORRECTED** — Áp dụng review fixes (xem migration files cho code cuối cùng).

---

## Phase 1: State Machine (chống state corruption)

### Vấn đề
Hiện tại `current_state` bị set direct bằng `.update({ current_state: 'pre_assigned' })` ở 6+ chỗ khác nhau trong codebase, không có validation. Đây là root cause của dl 13 stuck — state machine không enforce valid transitions.

### Change 1.1 — SQL function `transition_dealer_state()`

Tạo function trong DB để validate transitions và trigger để ghi audit trail.

> [FIX-DOUBLE-WRITE] Function KHÔNG insert vào `dealer_state_transitions`. Nó set session variable `app.state_reason`, UPDATE `dealer_attendance`, và trigger `trg_dealer_state_change` ghi audit.

**File:** `supabase/migrations/20260704000000_dealer_state_machine.sql`

```sql
-- Trigger function (single audit writer)
CREATE OR REPLACE FUNCTION public.log_dealer_state_change()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF OLD.current_state IS DISTINCT FROM NEW.current_state THEN
    INSERT INTO dealer_state_transitions (attendance_id, from_state, to_state, reason)
    VALUES (
      NEW.id,
      OLD.current_state,
      NEW.current_state,
      COALESCE(current_setting('app.state_reason', true), 'direct_update')
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_dealer_state_change
  AFTER UPDATE OF current_state ON dealer_attendance
  FOR EACH ROW
  WHEN (OLD.current_state IS DISTINCT FROM NEW.current_state)
  EXECUTE FUNCTION log_dealer_state_change();

-- State transition function (validates + executes, does NOT write audit)
CREATE OR REPLACE FUNCTION public.transition_dealer_state(
  p_attendance_id UUID,
  p_new_state     TEXT,
  p_reason        TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old_state TEXT;
  v_valid     BOOLEAN;
BEGIN
  SELECT current_state INTO v_old_state
  FROM dealer_attendance WHERE id = p_attendance_id
  FOR UPDATE;  -- Lock row for race prevention

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ATTENDANCE_NOT_FOUND');
  END IF;
  IF v_old_state = p_new_state THEN
    RETURN jsonb_build_object('ok', true, 'from', v_old_state, 'to', p_new_state, 'noop', true);
  END IF;

  -- Valid transitions:
  -- available     → pre_assigned, assigned, in_transition
  -- pre_assigned  → assigned, available (cancel)
  -- assigned      → on_break, in_transition, available
  -- in_transition → assigned, available, on_break
  -- on_break      → available, in_transition
  -- swing_ready   → in_transition, available
  v_valid := CASE ... END;

  IF NOT v_valid THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_TRANSITION', 'from', v_old_state, 'to', p_new_state);
  END IF;

  -- Set reason for trigger to capture
  PERFORM set_config('app.state_reason', COALESCE(p_reason, 'transition_dealer_state'), true);

  -- Execute transition (trigger fires and writes audit)
  UPDATE dealer_attendance SET current_state = p_new_state WHERE id = p_attendance_id;

  RETURN jsonb_build_object('ok', true, 'from', v_old_state, 'to', p_new_state);
END;
$$;
```

### Change 1.2 — Audit table `dealer_state_transitions`

```sql
CREATE TABLE IF NOT EXISTS dealer_state_transitions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  attendance_id   UUID NOT NULL REFERENCES dealer_attendance(id) ON DELETE CASCADE,
  from_state      TEXT NOT NULL,
  to_state        TEXT NOT NULL,
  reason          TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_state_transitions_attendance ON dealer_state_transitions(attendance_id, created_at DESC);
CREATE INDEX idx_state_transitions_created ON dealer_state_transitions(created_at DESC);

COMMENT ON TABLE dealer_state_transitions IS
  'Audit log — written ONLY by trg_dealer_state_change trigger. Do not INSERT directly.';
```

### Change 1.3 — Replace direct state updates trong `index.ts`

> [FIX-BATCH] Batch UPDATEs được giữ nguyên (không chuyển sang for-loop) để đảm bảo atomicity. Trigger vẫn ghi audit với reason='direct_update' cho batch operations. Individual operations dùng `transition_dealer_state()`.

```typescript
// Helper: individual state transitions (semantic operations)
async function transitionDealerState(admin, attendanceId, newState, reason?): Promise<boolean> {
  const { data, error } = await admin.rpc("transition_dealer_state", {
    p_attendance_id: attendanceId, p_new_state: newState, p_reason: reason ?? null,
  });
  if (error || data?.ok !== true) { console.error(`[state] FAILED ${attendanceId}:`, error ?? data); return false; }
  if (data?.noop) return true;
  return true;
}
```

| Operation | Approach | Reason |
|-----------|----------|--------|
| Pass 1b (batch release stale) | Batch UPDATE `.in("id", ids)` | `'direct_update'` (trigger captures) |
| Pass 1c (batch release orphan) | Batch UPDATE `.in("id", ids)` | `'direct_update'` (trigger captures) |
| Pass 2 (pre_assign) | `transitionDealerState(admin, id, "pre_assigned", "pass2_pre_assign")` | Semantic |
| SAFEGUARD (club mismatch) | `transitionDealerState(admin, id, "available", "safeguard_club_mismatch")` | Semantic |
| perform_swing RPC | `transition_dealer_state()` inside RPC | Semantic |
| execute_pre_assigned_swing RPC | `transition_dealer_state()` inside RPC | Semantic |

---

## Phase 2: Orphaned Pre-assigned (dl 13 fix — ALREADY DONE)

Pass 1c trong `index.ts` — query trực tiếp `dealer_attendance` cho `current_state = 'pre_assigned' AND pre_assigned_table_id IS NULL`. Code đã deploy.

```
[process-swing] Pass 1c: released 6 orphaned pre_assigned dealers for club 22222222
```

---

## Phase 3: Pool Management & Shortage Handling

### Vấn đề
Khi `no_dealer`, system chỉ log + send Telegram. Không có escalation. Dealer pool query luôn full-scan mỗi lần.

### Change 3.1 — Table Priority + Club Settings

> [FIX-THRESHOLD] `shortage_close_threshold` chuyển từ `swing_config` sang `club_settings`, default = 4 (không phải 30).

```sql
ALTER TABLE game_tables ADD COLUMN IF NOT EXISTS table_priority INT NOT NULL DEFAULT 3 CHECK (table_priority BETWEEN 1 AND 5);

ALTER TABLE club_settings
  ADD COLUMN IF NOT EXISTS shortage_auto_close_enabled  BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS shortage_close_threshold     INT     NOT NULL DEFAULT 4,
  ADD COLUMN IF NOT EXISTS shortage_notify_telegram     BOOLEAN NOT NULL DEFAULT true;
```

### Change 3.2 — Shortage Escalation (dùng `auto_close_low_priority_tables` RPC)

> [FIX-ORPHAN] Dùng `auto_close_low_priority_tables` RPC — atomic 3-step CTE (close table → end assignment → release dealer). Không dùng for-loop với `close_table` RPC riêng lẻ.

```typescript
// ── SHORTAGE ESCALATION ──────────────────────────────────
if (!dryRun && metrics.total > 0 && metrics.failed === 0) {
  const noDealerRatio = metrics.no_dealer / metrics.total;
  if (noDealerRatio > 0.5 && metrics.no_dealer >= 3) {
    const { data: settings } = await admin
      .from("club_settings")
      .select("shortage_auto_close_enabled, shortage_close_threshold, shortage_notify_telegram")
      .eq("club_id", cid).maybeSingle();

    const threshold = (settings as any)?.shortage_close_threshold ?? 4;
    if ((settings as any)?.shortage_auto_close_enabled && metrics.no_dealer >= threshold) {
      const { data: closed } = await admin
        .rpc("auto_close_low_priority_tables", { p_club_id: cid });
      // RPC handles: close table → end assignments → release dealers atomically
    }
  }
}
```

### Change 3.3 — Dealer Pool Cache (Materialized View — MONITORING ONLY)

> [FIX-DOC] `dealer_pool_summary` stale up to 60s. Chỉ dùng cho monitoring dashboard. Không dùng cho assignment decisions.

```sql
CREATE MATERIALIZED VIEW IF NOT EXISTS dealer_pool_summary AS
SELECT
  d.club_id,
  COUNT(*) FILTER (WHERE da.current_state = 'available')      AS available_count,
  COUNT(*) FILTER (WHERE da.current_state = 'pre_assigned')   AS pre_assigned_count,
  COUNT(*) FILTER (WHERE da.current_state = 'on_break')       AS on_break_count,
  COUNT(*) FILTER (WHERE da.current_state = 'assigned')       AS assigned_count,
  COUNT(*) FILTER (WHERE da.current_state = 'in_transition')  AS in_transition_count,
  COUNT(*) FILTER (WHERE da.current_state = 'assigned'
    AND EXISTS (SELECT 1 FROM dealer_assignments das
      WHERE das.attendance_id = da.id
        AND das.overtime_started_at IS NOT NULL AND das.status = 'assigned')) AS ot_count,
  COUNT(*)                                                     AS total_checked_in
FROM dealer_attendance da
JOIN dealers d ON d.id = da.dealer_id
WHERE da.status = 'checked_in'
GROUP BY d.club_id;

COMMENT ON MATERIALIZED VIEW dealer_pool_summary IS
  'MONITORING ONLY — stale up to 60s. NOT for assignment logic.';
```

---

## Phase 4: Monitoring & Alerts

### Vấn đề
dl 13 stuck `pre_assigned` 0 phút worked không ai biết. Cần auto-detect và cảnh báo.

### Change 4.1 — Stuck State Detector (Pass 0c)

```typescript
// ── Pass 0c: Detect stuck dealers ─────────────────────────
if (!dryRun) {
  // Stuck pre_assigned (no table, no assignment) → auto-release
  const { data: stuckPre } = await admin
    .from("dealer_attendance")
    .select("id, dealer_id")
    .eq("current_state", "pre_assigned")
    .is("pre_assigned_table_id", null);

  for (const s of stuckPre ?? []) {
    await transitionDealerState(admin, s.id, "available", "pass0c_stuck_pre_assigned");
  }

  // Stuck on_break (detect_stuck_breaks returns overdue dealers)
  const { data: stuckBreaks } = await admin
    .rpc("detect_stuck_breaks", { p_club_id: cid });
  // Returns: attendance_id, dealer_name, expected_min, overdue_min
}
```

### Change 4.2 — SQL RPC `detect_stuck_breaks`

```sql
CREATE OR REPLACE FUNCTION public.detect_stuck_breaks(p_club_id UUID)
RETURNS TABLE(attendance_id UUID, dealer_name TEXT, expected_min INT, overdue_min INT)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT
    da.id, d.full_name, db.expected_duration_minutes,
    GREATEST(0, EXTRACT(EPOCH FROM (NOW() - db.break_start))::INT / 60 - db.expected_duration_minutes)::INT
  FROM dealer_attendance da
  JOIN dealers d ON d.id = da.dealer_id
  JOIN dealer_assignments das ON das.attendance_id = da.id AND das.status = 'on_break'
  JOIN LATERAL (
    SELECT break_start, expected_duration_minutes
    FROM dealer_breaks
    WHERE assignment_id = das.id AND break_end IS NULL
    ORDER BY break_start DESC LIMIT 1
  ) db ON true
  WHERE da.current_state = 'on_break'
    AND d.club_id = p_club_id
    AND db.break_start < NOW() - (db.expected_duration_minutes || ' minutes')::INTERVAL;
$$;
```

---

## Implementation Order

| Phase | Changes | Priority | Effort | Status |
|-------|---------|----------|--------|--------|
| 1 (State Machine) | 1.1 SQL function, 1.2 audit table, 1.3 replace index.ts calls | **HIGH** | 2-3h | Migration files ready ✅ |
| 2 (Orphaned release) | Already done | **DONE** | ✅ | ✅ |
| 3 (Pool + Shortage) | 3.1 table priority + settings, 3.2 escalation RPC, 3.3 materialized view | MEDIUM | 3-4h | Migration files ready ✅ |
| 4 (Monitoring) | 4.1 stuck detector code, 4.2 SQL RPC | MEDIUM | 1-2h | Migration files ready ✅ |

## Key Design Decisions (sau review)

| Decision | Before | After (corrected) |
|----------|--------|-------------------|
| State type | ENUM (`dealer_state`) | TEXT (no ENUM, simpler) |
| Audit write | Function INSERTs directly | Function sets `app.state_reason`, trigger writes |
| Batch cleanup | for-loop calling RPC (loses atomicity) | Batch UPDATE (trigger still captures audit) |
| Shortage threshold | `swing_config.shortage_close_threshold DEFAULT 30` | `club_settings.shortage_close_threshold DEFAULT 4` |
| Auto-close tables | for-loop with `close_table` RPC | Single `auto_close_low_priority_tables` RPC (3-step CTE) |
| Pool view | Used for assignment decisions | **Monitoring only** (documented in COMMENT) |

## Files

| File | Change |
|------|--------|
| `supabase/migrations/20260704000000_dealer_state_machine.sql` | **NEW** — CORRECTED: state machine + trigger + audit + stuck break RPC |
| `supabase/migrations/20260704000001_pool_and_monitoring.sql` | **NEW** — CORRECTED: pool view + auto-close RPC + club_settings |
| `supabase/functions/process-swing/index.ts` | **EDIT** — 6 state transition patches + Pass 0c + escalation + pool refresh |
| `PLAN_CODE_CHANGES.md` | **UPDATED** — diff cho index.ts patches A-H |

---

## Review

Anh xem plan này trước, nếu OK tôi sẽ implement từng phase theo thứ tự. Mỗi phase deploy riêng để dễ rollback nếu có vấn đề.
