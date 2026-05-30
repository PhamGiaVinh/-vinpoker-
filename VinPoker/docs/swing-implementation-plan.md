# Swing Fix — Complete Implementation Plan

---

## Phase 1 — DB Migration ✅ DEPLOYED

**File**: `supabase/migrations/20260701000000_fix_execute_pre_assigned_on_conflict.sql`

### Changes applied:
- `dealer_attendance.total_worked_minutes_today` column (INT, DEFAULT 0)
  - Update policy: swing RPCs accumulate, breaks do NOT reset, new shift = new attendance record
- `idx_assignments_ot` index on `dealer_assignments(attendance_id, overtime_started_at)` WHERE OT not null
- `execute_pre_assigned_swing`: **thêm `AND status = 'checked_in'`** vào lock condition (P0: chống assign dealer đã checkout)
- `execute_pre_assigned_swing`: **`ON CONFLICT DO NOTHING`** + `v_new_assignment_id IS NULL` rollback (P0: chống silent duplicate)
  - Rollback: release new dealer lock, restore old assignment + state + OT, delete break record
- `perform_swing`: **thêm `total_worked_minutes_today`** tracking cho cả old + new dealer
- `dealer_shift_metrics` VIEW: **NO CHANGE** — column đọc trực tiếp từ `dealer_attendance` row (VIEW chạy ~900 lần/h)

---

## Phase 2 — Edge Function Fixes

### 2.1 `process-swing/index.ts`

#### 2.1a Pre-assigned lost fallback (P0)

**Vị trí**: Pass 3 pre-assigned path, case `"race_lost"`, dòng ~534-539

**Vấn đề**: Khi `execute_pre_assigned_swing` trả về `race_lost` (concurrent modify), code hiện tại chỉ `cycleExcludedIds.add()` + `break` → bàn không có dealer mới.

**Fixes applied** (từ review):
1. Re-fetch `status` + `swing_processed_at` — nếu assignment đã completed thì skip (không fallback vào assignment chết)
2. Force break cho OT assignment (`overtime_started_at` set) — không trust `evaluateBreakNeed` (worked_minutes stale)
3. **Bỏ `p_swing_due_at`** — biến `pass3SwingDueAt` không có trong scope. RPC tự compute từ `p_swing_duration_minutes`
4. `is_new_overtime` guard an toàn — `perform_swing` dùng `COALESCE(overtime_started_at, v_now)` không bao giờ reset

**Corrected code**:
```typescript
case "race_lost": {
  cycleExcludedIds.add(assignment.pre_assigned_attendance_id);
  console.warn(`[process-swing] Pre-assign race_lost for ${tableName}, fallback...`);

  // ⚠️ Re-fetch — version stale sau race_lost (concurrent modify)
  const { data: freshRow } = await admin
    .from("dealer_assignments")
    .select("id, version, overtime_started_at, status, swing_processed_at")
    .eq("id", assignment.id)
    .single();

  // (1) Assignment biến mất → skip
  if (!freshRow) { console.warn(`Assignment ${assignment.id} not found`); break; }

  // (2) Assignment đã được xử lý bởi concurrent process → count success, skip
  if (freshRow.status === "completed" || freshRow.swing_processed_at !== null) {
    console.log(`Assignment ${assignment.id} already completed by concurrent swing`);
    metrics.success++;
    break;
  }

  // (3) OT assignment: force break (worked_minutes_since_last_break stale)
  const isOtFallback = !!(freshRow.overtime_started_at);
  const breakDecision = isOtFallback
    ? { shouldBreak: true, reason: "mandatory" as const, workedMinutes: 999 }
    : await evaluateBreakNeed(admin, assignment.attendance_id, {
        maxWorkMinutes: Math.max(DEFAULT_MAX_WORK_MINUTES, swingDurResult.durationMinutes * 3),
        minWorkMinutes: Math.max(DEFAULT_MIN_WORK_MINUTES, swingDurResult.durationMinutes * 2),
        clubId: cid,
      });

  const fbDealer = await pickNextDealer(admin, cid, {
    currentTableId: assignment.table_id,
    excludeAttendanceIds: cycleExcludedIds,
    requiredGameTypes,
  });

  if (fbDealer) {
    const { data: fbResult } = await admin.rpc("perform_swing", {
      p_assignment_id: assignment.id,
      p_version: freshRow.version,       // ← FRESH
      p_next_attendance_id: fbDealer.id,
      p_send_to_break: breakDecision.shouldBreak,
      p_break_duration_minutes: clubCfg.break_duration_minutes,
      p_swing_duration_minutes: swingDurResult.durationMinutes,
      // (4) Không p_swing_due_at — RPC compute từ p_swing_duration_minutes
    });

    if (fbResult?.outcome === "swung") {
      metrics.success++;
      cycleExcludedIds.add(fbDealer.id);
      notifier?.enqueue({ type: "swing_in", tableName, zone: clubZone,
        dealerName: fbDealer.full_name, username: fbDealer.telegram_username ?? null });
    } else if (fbResult?.outcome === "no_dealer") {
      metrics.no_dealer++;
      if (fbResult.is_new_overtime) {
        const chatId = await getClubTelegramChatId(admin, cid);
        if (botToken && chatId) {
          await sendTelegramNotification(botToken, chatId,
            `⏱ *Bàn ${tableName}* — Dealer đang OT (fallback sau race_lost).`, {});
        }
      }
    } else {
      metrics.failed++;
      console.warn(`Fallback outcome: ${fbResult?.outcome}`);
    }
  } else {
    // No fallback → OT path
    const { data: otResult } = await admin.rpc("perform_swing", {
      p_assignment_id: assignment.id,
      p_version: freshRow.version,
      p_next_attendance_id: null,
      p_send_to_break: false,
      p_break_duration_minutes: clubCfg.break_duration_minutes,
      p_swing_duration_minutes: swingDurResult.durationMinutes,
    });
    metrics.no_dealer++;
    if (otResult?.outcome === "no_dealer" && otResult?.is_new_overtime) {
      const chatId = await getClubTelegramChatId(admin, cid);
      if (botToken && chatId) {
        await sendTelegramNotification(botToken, chatId,
          `⏱ *Bàn ${tableName}* — Dealer OT (không người thay sau race_lost).`, {});
      }
    }
  }
  break;
}
```

#### 2.1b Stale cleanup inverted condition

**Vị trí**: Pass 1 cleanup query, dòng ~288-294

**Vấn đề**: Dùng `.or(pre_assigned_at.lt.${staleThreshold}, updated_at.lt.${staleThreshold})` — clear pre-assign sau 20 phút bất kể swing_due_at. OT dealer bị clear pre-assign sớm.

**Fix**: Chỉ clear nếu pre-assign cũ **VÀ** swing đã quá hạn:
```typescript
// OLD
.or(`pre_assigned_at.lt.${staleThreshold},updated_at.lt.${staleThreshold}`)

// NEW
.lt("pre_assigned_at", staleThreshold)
.lt("swing_due_at", new Date().toISOString())
```

### 2.2 `checkout-dealer/index.ts` — atomicity + status guard

**Cần verify**: UPDATE `status` + `current_state` trong 1 câu SQL, **và** có `.eq("status", "checked_in")` guard.

Expected pattern:
```typescript
// (A) Release pre-assign trước — nếu dealer đang pre_assigned
if (isPreAssigned) {
  await admin.from("dealer_assignments")
    .update({ pre_assigned_attendance_id: null, pre_assigned_at: null })
    .eq("pre_assigned_attendance_id", attendanceId);

  await admin.from("dealer_attendance")
    .update({ current_state: "available" })
    .eq("id", attendanceId)
    .eq("current_state", "pre_assigned");
}

// (B) Checkout atomic — status + current_state trong 1 UPDATE
const { error } = await admin.from("dealer_attendance")
  .update({
    status: "checked_out",
    current_state: "checked_out",
    check_out_time: new Date().toISOString(),
    overtime_minutes: computedOvertime,
    total_worked_minutes_today: computedTotalWorked,
  })
  .eq("id", attendanceId)
  .eq("status", "checked_in");   // ← GUARD: chống double-checkout

if (error) { /* handle */ }
```

**`.eq("status", "checked_in")` guard** là critical addition — nếu không có, request retry sẽ checkout 1 dealer đã checkout rồi.

---

## Phase 3 — Frontend Fixes

### 3.1 TimerCell OT display

**File**: `src/components/cashier/DealerSwingTab.tsx`

**Hàm `TimerCell`** (~dòng 2390-2429):

Thêm param `overtimeStartedAt?: string | null`:

```typescript
function TimerCell({
  swingDueAt,
  overtimeStartedAt,
  warnAt,
  critAt,
  attendanceId,
  assignmentId,
  onExpired,
}: {
  swingDueAt: string;
  overtimeStartedAt?: string | null;   // ← new
  warnAt: number;
  critAt: number;
  attendanceId?: string;
  assignmentId?: string;
  onExpired?: (attendanceId: string, assignmentId: string) => void;
}) {
  const [now, setNow] = useState(Date.now());
  const hasFiredRef = useRef(false);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // ── OT BRANCH: show elapsed OT time ──
  if (overtimeStartedAt) {
    const otMs = now - new Date(overtimeStartedAt).getTime();
    const otMin = Math.floor(otMs / 60000);
    const otSec = Math.floor((otMs % 60000) / 1000);
    return (
      <div className="font-mono text-lg font-bold text-red-500">
        <span className="text-[10px] bg-red-500/20 px-1 rounded mr-1">OT</span>
        +{otMin}:{String(otSec).padStart(2, "0")}
      </div>
    );
  }

  // ── NORMAL COUNTDOWN ── (giữ nguyên)
  const timeLeftMs = new Date(swingDueAt).getTime() - now;
  const timeLeft = Math.max(0, timeLeftMs / (1000 * 60));
  const m = Math.floor(timeLeft);
  const s = Math.floor((timeLeft - m) * 60);

  useEffect(() => {
    if (timeLeft <= 0 && !hasFiredRef.current && attendanceId && assignmentId && onExpired) {
      hasFiredRef.current = true;
      onExpired(attendanceId, assignmentId);
    }
  }, [timeLeft, attendanceId, assignmentId, onExpired]);

  let color = "text-primary";
  if (timeLeft <= critAt) color = "text-red-500";
  else if (timeLeft <= warnAt) color = "text-amber-500";

  return (
    <div className={`font-mono text-lg font-bold ${color}`}>
      {String(m).padStart(2, "0")}:{String(s).padStart(2, "0")}
    </div>
  );
}
```

**Nơi gọi TimerCell** (~dòng 2107):
```typescript
// OLD
<TimerCell swingDueAt={a.swing_due_at ?? a.assigned_at} warnAt={warnAt} critAt={critAt} ... />

// NEW
<TimerCell
  swingDueAt={a.swing_due_at ?? a.assigned_at}
  overtimeStartedAt={a.overtime_started_at}
  warnAt={warnAt}
  critAt={critAt}
  attendanceId={a.attendance_id}
  assignmentId={a.id}
  onExpired={onTimerExpired}
/>
```

### 3.2 `useActiveAssignments` — select `overtime_started_at`

**File**: `src/hooks/useDealerSwing.ts`

Tìm select string và thêm field:

```typescript
const select = `
  id, attendance_id, table_id, assigned_at, released_at, status,
  version, swing_processed_at, swing_due_at,
  pre_assigned_attendance_id, pre_assigned_at,
  overtime_started_at,                ← THÊM
  game_tables!inner(club_id, table_name, table_type),
  dealer_attendance!attendance_id(
    id, current_state, priority_break_flag, overtime_minutes,
    total_worked_minutes_today,           ← THÊM (cho Phase 4)
    dealers(full_name, telegram_username, telegram_user_id, tier, skills)
  )
`;
```

---

## Phase 4 — Scoring Fixes

### File: `supabase/functions/_shared/dealer-utils.ts`

#### 4.1 Heavy worker penalty

Thêm vào `ScoreBreakdown` interface:
```typescript
export interface ScoreBreakdown {
  // ... existing fields
  heavy_worker_penalty: number;  // ← new
}
```

Thêm vào scoring loop (sau ~dòng 261, trước candidate push):
```typescript
const totalWorkedMinutesToday = row.total_worked_minutes_today ?? 0;
let heavyWorkerPenalty = 0;
if (totalWorkedMinutesToday > 150) {
  // Curve: 150→0, 180→-20, 210→-40, 270→-80, 330+→-120 (cap)
  heavyWorkerPenalty = -Math.min(
    120,
    Math.floor((totalWorkedMinutesToday - 150) / 30) * 20
  );
}
breakdown.heavy_worker_penalty = heavyWorkerPenalty;
score += heavyWorkerPenalty;
```

Initial value trong candidate push:
```typescript
score_breakdown: {
  // ... existing defaults
  heavy_worker_penalty: 0,
}
```

#### 4.2 Consecutive HIGH table penalty

Sửa Step 4 query (~dòng 153-164):
```typescript
// OLD: fetch last table_id
const { data: lastAssignments } = await admin
  .from("dealer_assignments")
  .select("attendance_id, table_id")
  .in("attendance_id", attendanceIds)
  .order("assigned_at", { ascending: false });
const lastTableMap = new Map<string, string>();
for (const a of lastAssignments ?? []) {
  if (!lastTableMap.has(a.attendance_id)) {
    lastTableMap.set(a.attendance_id, a.table_id);
  }
}

// NEW: fetch 2 completed, include table_type
const { data: lastAssignments } = await admin
  .from("dealer_assignments")
  .select("attendance_id, table_id, game_tables!inner(table_type)")
  .in("attendance_id", attendanceIds)
  .eq("status", "completed")
  .order("assigned_at", { ascending: false });
const lastTableMap = new Map<string, string>();
const lastTypesMap = new Map<string, string[]>();   // ← new
for (const a of lastAssignments ?? []) {
  if (!lastTableMap.has(a.attendance_id)) {
    lastTableMap.set(a.attendance_id, a.table_id);
  }
  const types = lastTypesMap.get(a.attendance_id) ?? [];
  if (types.length < 2) {
    types.push((a as any).game_tables?.table_type ?? "MEDIUM");
    lastTypesMap.set(a.attendance_id, types);
  }
}
```

Thêm vào interface:
```typescript
export interface ScoreBreakdown {
  // ... existing
  consecutive_high_penalty: number;  // ← new
}
```

Thêm vào scoring loop (sau back_to_back):
```typescript
// Consecutive HIGH table: -40 nếu 2 completed gần nhất đều HIGH
const lastTwoTypes = lastTypesMap.get(row.id) ?? [];
if (lastTwoTypes.length === 2 && lastTwoTypes.every(t => t === "HIGH")) {
  breakdown.consecutive_high_penalty = -40;
  score -= 40;
}
```

Initial value:
```typescript
score_breakdown: {
  // ... existing defaults
  consecutive_high_penalty: 0,
}
```

#### 4.3 Premature swing soft floor — SKIP

```
TODO: Requires assignment context in buildDealerCandidates.
Need minutes_since_current_assignment computed from dealer_assignments.assigned_at.
Blocked by: buildDealerCandidates has no current assignment info per candidate.
```

#### 4.4 HIGH continuity bonus — SIMPLIFY

Sửa back_to_back_penalty (~dòng 238-241):
```typescript
// OLD: luôn -50
if (lastTableId && lastTableId === currentTableId) {
  breakdown.back_to_back_penalty = -50;
  score -= 50;
}

// NEW: HIGH penalty thấp hơn (khuyến khích continuity)
if (lastTableId && lastTableId === currentTableId) {
  breakdown.back_to_back_penalty = tourTier === "HIGH" ? -30 : -50;
  score += breakdown.back_to_back_penalty;
}
```

---

## Files changed (4 files remaining)

| File | Phase | Thay đổi |
|------|-------|----------|
| `supabase/functions/process-swing/index.ts` | 2 | 2.1a fallback block, 2.1b stale condition |
| `supabase/functions/checkout-dealer/index.ts` | 2 | 2.2 verify atomicity (có thể 0 change) |
| `src/components/cashier/DealerSwingTab.tsx` | 3 | 3.1 TimerCell OT branch + caller |
| `src/hooks/useDealerSwing.ts` | 3 | 3.2 select overtime_started_at |
| `supabase/functions/_shared/dealer-utils.ts` | 4 | 4.1 heavy worker, 4.2 HIGH penalty, 4.4 back_to_back tier |

---

## Rollout + Verification

```
Phase 1 ✅
  ↓
Phase 2: deploy edge functions
  → supabase functions deploy process-swing
  → supabase functions deploy checkout-dealer (nếu có fix)
  ↓
[VERIFY]
  1. Manual swing → swing_audit_logs: không duplicate dealer
  2. race_lost path: concurrent assign + swing → fallback thành công
  3. OT path: remove dealers → table OT → add dealer → OT clears
  4. Stale cleanup: OT pre-assigns không bị clear sớm
  ↓
Phase 3: frontend
  → npm run build
  → deploy Vercel
  ↓
Phase 4: scoring
  → supabase functions deploy assign-dealer
  → supabase functions deploy process-swing (dealer-utils change)
```
