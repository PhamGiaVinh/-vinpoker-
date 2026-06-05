# Backlog: Pass 3 Hidden Bugs (Phase 2-4)

**Date:** 2026-06-05
**Source:** Phase 1 diagnostic + comprehensive code review
**Status:** All 5 issues identified, 1 already fixed, 4 need work

---

## 🟡 P2: #3 overtime_started_at not cleared on successful pre-assign

**File:** `pass2-pre-assign.ts` + RPC `pre_assign_next_dealer_for_table`

**Issue:** Tables with a pre-assigned dealer still show "OT" in UI. Pre-assign succeeds but `overtime_started_at` and `last_ot_alert_at` are not cleared on the assignment row.

**Impact:** 
- UI shows incorrect OT status
- OT alerts spam every 5 minutes (per `last_ot_alert_at` throttle doesn't kick in)
- Floor managers confused

**Fix:**
```typescript
// In pass2-pre-assign.ts after pre_assign_next_dealer_for_table returns 'pre_assigned':
await admin
  .from("dealer_assignments")
  .update({
    overtime_started_at: null,
    last_ot_alert_at: null,
  })
  .eq("id", assignment_id);
```

**Estimated time:** 1 hour

---

## 🟡 P2: #7 auto_swing_enabled bypassed by manual triggers

**File:** `process-swing/index.ts:521`

**Issue:** `if (!manualTrigger && !clubCfg.auto_swing_enabled)` — manual override bypasses the per-club `auto_swing_enabled` flag. A user can manually trigger swings for a club that has auto-swing disabled, causing double-execution with cron.

**Impact:**
- Double processing
- Manual trigger succeeds even when cron is disabled
- No protection against user error

**Fix:**
```typescript
// Check auto_swing_enabled for both manual and cron
if (!clubCfg.auto_swing_enabled && !forceOverride) {
  return new Response(JSON.stringify({
    skipped: true,
    reason: "auto_swing_disabled_for_club"
  }), { status: 200 });
}
```

**Estimated time:** 30 min

---

## 🟡 P2: #8 Stagger logic wraparound at 10 tables

**File:** `process-swing/index.ts:123`

**Issue:** `stagger = (index % 10) * 30_000` — for clubs with 15-30 tables, multiple tables share the same stagger offset, causing pre-assign notifications to be sent at the same time.

**Impact:**
- Pre-assign notifications batch up
- Dealer gets pre-assigned but pre-announce message arrives with other tables
- Confusing UI updates

**Fix:**
```typescript
// Use hash-based stagger to avoid wraparound
const hash = simpleHash(tableId);
const stagger = (hash % 30) * 30_000; // 0-15 min distribution

function simpleHash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h) + s.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}
```

**Estimated time:** 1 hour

---

## 🟢 P3: #9 !inner silent data loss in Pass 0c

**File:** `process-swing/index.ts:638, 664, 725, 747`

**Issue:** `dealers!inner(full_name)` — if a stuck dealer has a `dealers` row that doesn't pass the join condition (e.g., deleted via CASCADE), the parent row is **silently invisible** to the recovery query.

**Impact:**
- Stuck dealers with missing `dealers` row are not auto-fixed
- Cascades into "stuck dealer" stuck forever
- Recovery silently fails

**Fix:**
```typescript
// Replace !inner with LEFT JOIN (default)
.select("id, dealer_id, current_state, ..., dealers(full_name)")
// Then add explicit filter for null cases:
const result = await query;
const stuckDealers = result.filter(d => d.current_state === 'stuck');
// For rows with null dealers, log alert and skip
```

**Estimated time:** 30 min

---

## 🟢 P3: #10 Non-atomic transitionDealerState + update in Pass 1c

**File:** `process-swing/index.ts:1481-1494`

**Issue:** `await transitionDealerState(...)` then `await admin.from(...).update(...)` — if step 1 fails after step 2 succeeds, state machine becomes inconsistent.

**Impact:**
- `dealer_attendance` could be in `available` while assignment still references old dealer
- State machine validation bypassed

**Fix:** Move to atomic RPC:
```sql
CREATE OR REPLACE FUNCTION clear_orphan_pre_assigned(p_attendance_id UUID)
RETURNS JSONB AS $$
DECLARE
  v_current_state TEXT;
BEGIN
  SELECT current_state INTO v_current_state
  FROM dealer_attendance WHERE id = p_attendance_id FOR UPDATE;
  
  IF v_current_state != 'pre_assigned' THEN
    RETURN jsonb_build_object('skipped', true, 'reason', 'not_pre_assigned');
  END IF;
  
  UPDATE dealer_attendance SET current_state = 'available' WHERE id = p_attendance_id;
  UPDATE dealer_attendance SET pre_assigned_table_id = NULL WHERE id = p_attendance_id;
  
  RETURN jsonb_build_object('success', true);
END;
$$ LANGUAGE plpgsql;
```

**Estimated time:** 1 hour

---

## 🟢 P3: #11 TOCTOU race in pickNextDealer suggestion

**File:** `assign-dealer/index.ts:228` + `pickNextDealer.ts:140-170`

**Issue:** Two concurrent `assign-dealer` calls can both see the same `topDealers[0]` and try to assign it. The RPC has `SKIP LOCKED` but the suggestion phase is not atomic.

**Impact:**
- One of the two concurrent calls fails with `DEALER_BUSY`
- Confusing UX: cashier sees dealer that just got assigned
- Possible duplicate attempts

**Fix:** Use advisory lock per dealer:
```typescript
const lockKey = hashtextextended(dealerId::text, 0);
const { data: lockResult } = await admin.rpc('pg_try_advisory_lock', { lock_key: lockKey });
if (!lockResult) {
  // Dealer is being assigned by another operation, pick another
  return pickNextDealer(admin, tableId, excludeIds);
}
try {
  // ... suggestion logic ...
} finally {
  await admin.rpc('pg_advisory_unlock', { lock_key: lockKey });
}
```

**Estimated time:** 1 hour

---

## 📊 Summary

| Issue | Priority | Estimated Time | Status |
|-------|----------|----------------|--------|
| #3 OT not cleared | P2 | 1h | TODO |
| #7 auto_swing bypass | P2 | 30min | TODO |
| #8 Stagger wraparound | P2 | 1h | TODO |
| #9 !inner data loss | P3 | 30min | TODO |
| #10 Non-atomic transition | P3 | 1h | TODO |
| #11 TOCTOU race | P3 | 1h | TODO |

**Total:** 5 hours

**Recommendation:** Bundle all P2 + P3 into a single `Phase 4: Polish & Edge Cases` branch.

---

## 📝 GitHub Issue Templates

Use these templates to create issues on GitHub:

### Issue #3 Template
```
Title: [P2] overtime_started_at not cleared on successful pre-assign

**File:** pass2-pre-assign.ts + RPC pre_assign_next_dealer_for_table
**Impact:** UI shows incorrect OT status, OT alerts spam every 5 min
**Fix:** Update assignment row after pre_assign returns 'pre_assigned'
**Estimated:** 1 hour

See docs/backlog/01_P2_overtime_started_at_not_cleared.md
```

### Issue #7 Template
```
Title: [P2] auto_swing_enabled bypassed by manual triggers

**File:** process-swing/index.ts:521
**Impact:** Manual trigger runs for clubs with auto_swing disabled
**Fix:** Add forceOverride flag, enforce check for both manual and cron
**Estimated:** 30 min

See docs/backlog/02_P2_auto_swing_bypass.md
```

### Issue #8 Template
```
Title: [P2] Stagger logic wraparound at 10 tables

**File:** process-swing/index.ts:123
**Impact:** Pre-assign notifications batch for clubs with 15+ tables
**Fix:** Use hash-based stagger with 30-min distribution
**Estimated:** 1 hour

See docs/backlog/03_P2_stagger_wraparound.md
```

### Issue #9 Template
```
Title: [P3] !inner silent data loss in Pass 0c

**File:** process-swing/index.ts:638, 664, 725, 747
**Impact:** Stuck dealers with missing dealers row never auto-fixed
**Fix:** Replace !inner with LEFT JOIN + explicit null check
**Estimated:** 30 min

See docs/backlog/04_P3_inner_silent_data_loss.md
```

### Issue #10 Template
```
Title: [P3] Non-atomic transitionDealerState + update in Pass 1c

**File:** process-swing/index.ts:1481-1494
**Impact:** State machine inconsistency if step 1 fails after step 2
**Fix:** Create atomic RPC clear_orphan_pre_assigned
**Estimated:** 1 hour

See docs/backlog/05_P3_non_atomic_transition.md
```

### Issue #11 Template
```
Title: [P3] TOCTOU race in pickNextDealer suggestion

**File:** assign-dealer/index.ts:228 + pickNextDealer.ts:140-170
**Impact:** Two concurrent assign calls see same dealer, one fails
**Fix:** Use pg_try_advisory_lock with hashtextextended
**Estimated:** 1 hour

See docs/backlog/06_P3_toctou_race.md
```
