# Circuit Breaker Fix Design

**File:** `supabase/functions/process-swing/index.ts:1713-1774`
**Bug:** Ghost assignments created when assignments overdue >60 min

**Status:** ✅ **DEPLOYED 2026-06-05 23:07 (commit `84011ae` on `main`)**
**Validation:** All 4 RPC/cron/manual/health queries passed

## Current Behavior (BUGGY)

```typescript
if (minsLeft < -SWING_THRESHOLDS.OVERDUE_THRESHOLD_MINUTES) {
  // CIRCUIT BREAKER
  if (!dryRun) {
    // 1. Release pre-assigned dealer (NEXT dealer, not current)
    if (assignment.pre_assigned_attendance_id) {
      await admin.from("dealer_assignments")
        .update({ pre_assigned_attendance_id: null, pre_assigned_at: null })
        .eq("id", assignment.id);
      await transitionDealerState(...);
    }

    // 2. ❌ MISSING: Release CURRENT dealer
    // 3. ❌ MISSING: Mark assignment as completed

    // 4. Set swing_processed_at (escape loop)
    await admin.from("dealer_assignments")
      .update({ swing_processed_at: new Date().toISOString() })
      .eq("id", assignment.id);

    // 5. Send alert
    ...
  }
  metrics.failed++;
  continue;
}
```

**Result:** Assignment has `swing_processed_at` set but `released_at` NULL → ghost state.

## Fix Design

### Option A: Proper cleanup in circuit breaker (PRIMARY FIX)

**Replace lines 1713-1774 with:**

```typescript
if (minsLeft < -SWING_THRESHOLDS.OVERDUE_THRESHOLD_MINUTES) {
  console.error(
    `[process-swing] CIRCUIT BREAKER: ${tableName} overdue by ${-minsLeft}min`
  );
  if (!dryRun) {
    // 1. Release CURRENT dealer
    if (assignment.attendance_id) {
      const currentResult = await transitionDealerState(
        admin,
        assignment.attendance_id,
        "available",
        `circuit_breaker_release_current_overdue_${-minsLeft}min`
      );
      if (!currentResult.success) {
        console.error(`[Pass 3] Failed to release current dealer:`, currentResult.error);
      }
    }

    // 2. Release PRE-ASSIGNED dealer (if exists)
    if (assignment.pre_assigned_attendance_id) {
      await admin
        .from("dealer_assignments")
        .update({ pre_assigned_attendance_id: null, pre_assigned_at: null })
        .eq("id", assignment.id)
        .is("released_at", null);

      await transitionDealerState(
        admin,
        assignment.pre_assigned_attendance_id,
        "available",
        `circuit_breaker_release_preassigned_overdue_${-minsLeft}min`
      );
    }

    // 3. Mark assignment as completed (fixes ghost state)
    await admin
      .from("dealer_assignments")
      .update({
        status: "completed",
        released_at: new Date().toISOString(),
        release_reason: `circuit_breaker_overdue_${-minsLeft}min`,
        swing_processed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", assignment.id);

    // 4. Alert (unchanged)
    const throttleThreshold = new Date(
      Date.now() - SWING_THRESHOLDS.ALERT_THROTTLE_HOURS * 60 * 60 * 1000
    ).toISOString();
    const { data: alertUpdated, error: alertUpdateErr } = await admin
      .from("clubs")
      .update({ last_critical_alert_at: new Date().toISOString() })
      .eq("id", cid)
      .or(`last_critical_alert_at.is.null,last_critical_alert_at.lt.${throttleThreshold}`)
      .select("id");

    const shouldAlert = !alertUpdateErr && alertUpdated && alertUpdated.length > 0;
    if (shouldAlert) {
      const chatId = await getClubTelegramChatId(admin, cid);
      if (botToken && chatId) {
        await sendTelegramNotification(
          botToken, chatId,
          `CIRCUIT BREAKER — Bàn ${tableName}\n` +
          `Dealer ${outgoingDealer?.full_name || "Unknown"} stuck ${-minsLeft}min.\n` +
          `Both dealers released. Cần can thiệp thủ công!`,
          {}
        );
      }
    }
  }
  metrics.failed++;
  continue;
}
```

**Changes:**
- Add step 1: release current dealer
- Modify step 3: mark as `completed` (not just processed)
- Add explicit `release_reason` with overdue minutes

### Option B: Reconciliation RPC (SAFETY NET)

**Add new RPC** for periodic ghost detection and fix:

```sql
CREATE OR REPLACE FUNCTION reconcile_ghost_assignments(
  p_club_id UUID DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
  v_ghost RECORD;
  v_fixed_count INT := 0;
  v_results JSONB := '[]'::jsonb;
BEGIN
  FOR v_ghost IN
    SELECT 
      da.id,
      da.attendance_id,
      da.pre_assigned_attendance_id,
      da.table_id
    FROM dealer_assignments da
    WHERE da.status = 'assigned'
      AND da.released_at IS NULL
      AND da.swing_processed_at IS NOT NULL
      AND da.swing_due_at < NOW() - INTERVAL '5 minutes'
      AND (p_club_id IS NULL OR da.club_id = p_club_id)
  LOOP
    -- Release current dealer
    IF v_ghost.attendance_id IS NOT NULL THEN
      PERFORM transition_dealer_state(
        v_ghost.attendance_id,
        'available',
        'reconcile_ghost_release_current'
      );
    END IF;

    -- Release pre-assigned dealer
    IF v_ghost.pre_assigned_attendance_id IS NOT NULL THEN
      PERFORM transition_dealer_state(
        v_ghost.pre_assigned_attendance_id,
        'available',
        'reconcile_ghost_release_preassigned'
      );
    END IF;

    -- Mark assignment completed
    UPDATE dealer_assignments
    SET 
      status = 'completed',
      released_at = NOW(),
      release_reason = 'reconcile_ghost_cleanup',
      pre_assigned_attendance_id = NULL,
      pre_assigned_at = NULL,
      updated_at = NOW()
    WHERE id = v_ghost.id;

    v_fixed_count := v_fixed_count + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'fixed_count', v_fixed_count,
    'club_id', p_club_id,
    'timestamp', NOW()
  );
END;
$$ LANGUAGE plpgsql;

GRANT EXECUTE ON FUNCTION reconcile_ghost_assignments TO service_role;
```

**Schedule via pg_cron:**
```sql
SELECT cron.schedule(
  'reconcile-ghost-assignments',
  '*/15 * * * *',  -- Every 15 minutes
  $$SELECT reconcile_ghost_assignments(NULL)$$
);
```

### Combined Strategy

1. **Option A (primary fix):** Update circuit breaker in process-swing to properly release current dealer
2. **Option B (safety net):** Reconciliation RPC runs every 15 min as backup
3. **Monitoring:** `ghost_assignments_health` view alerts if ghost_count > 0
4. **Validation:** Wait 24-48h, verify no new ghosts created

## Implementation Effort

| Component | Time | Risk |
|-----------|------|------|
| Option A edit | 30 min | Low (only affects error path) |
| Option B RPC + cron | 45 min | Low (safety net, idempotent) |
| Test in staging | 30 min | — |
| Deploy + monitor | 15 min | — |
| **Total** | **~2h** | **Low** |

## Rollback Plan

If Option A breaks things:
```bash
git revert HEAD
supabase functions deploy process-swing --no-verify-jwt
```

The reconciliation RPC is independent and can be dropped without affecting the edge function.
