# Dealer Swing System — Complete Architecture Plan

> **VinPoker** — Mục tiêu: tự động hoá việc xoay vòng (swing) dealer giữa các bàn,
> tối ưu hóa phân bổ dựa trên điểm số, tích hợp check-in/out, break, overtime, pre-assign,
> Telegram notification, và tính lương (payroll).

---

## 1. Tổng quan kiến trúc

### 1.1 Stack
| Layer | Công nghệ | Ghi chú |
|-------|-----------|---------|
| Database | PostgreSQL (Supabase) | Tables + Views + RPCs + Triggers |
| Edge Functions | Deno (Supabase Functions) | TypeScript, chạy serverless |
| Frontend | React + TypeScript (Vite) | Hooks + shadcn/ui components |
| Scheduled | Supabase Cron | `process-swing` chạy định kỳ |
| Notification | Telegram Bot API | Swing-in, pre-assign, break, OT alerts |
| Timezone | `club_settings.timezone` | Default: `Asia/Ho_Chi_Minh` (UTC+7) |

### 1.2 Database Tables chính

```
dealers           — Thông tin dealer (tier A/B/C, skills, club_id, employment_type, hourly_rate_vnd)
dealer_attendance — Ca làm việc (check_in_time, check_out_time, status, current_state, shift_date)
dealer_assignments — Gán dealer vào bàn (table_id, attendance_id, status, swing_due_at)
dealer_breaks     — Lịch sử break (break_start, break_end, assignment_id)
swing_config      — Cấu hình swing theo club + table_type
swing_audit_logs  — Audit trail mỗi lần swing
swing_metrics     — Thống kê swing hàng ngày theo club
audit_logs        — Activity log tổng quát
```

### 1.3 Views & Indexes quan trọng

```sql
-- Mỗi dealer chỉ có tối đa 1 active check-in
CREATE UNIQUE INDEX idx_one_active_checkin_per_dealer
  ON dealer_attendance (dealer_id) WHERE status = 'checked_in';

-- Mỗi attendance chỉ có 1 active assignment
CREATE UNIQUE INDEX idx_unique_active_attendance
  ON dealer_assignments (attendance_id) WHERE status = 'assigned';

-- View: real-time shift metrics
dealer_shift_metrics — minutes_since_rest, total_assignments, total_break_minutes

-- View: latest attendance per dealer
dealer_latest_attendance — DISTINCT ON (dealer_id) với status filter
```

---

## 2. Dealer Lifecycle

```
[Check-in] → available → [Assign] → assigned → [Swing due] → completed/on_break → available → ...
                ↓                          ↓
          [Check-out]               [Pre-assign] → pre_assigned → assigned
```

### 2.1 Check-in
- **Where**: `DealerSwingTab.tsx` — `doCheckin()`
- **Edge function**: Không (gọi Supabase INSERT trực tiếp từ frontend)
- **Logic**:
  - INSERT vào `dealer_attendance` với `status='checked_in'`, `current_state='available'`
  - `shift_date` = `new Date().toISOString().split('T')[0]` (UTC date)
  - Idempotency: check `dealer_id + shift_date + status='checked_in'` trước INSERT
- **Partial unique index**: `idx_one_active_checkin_per_dealer` — đảm bảo 1 dealer chỉ có 1 active check-in

### 2.2 Check-out
- **Edge function**: `checkout-dealer/index.ts`
- **Input**: `attendance_ids[]`
- **Logic**:
  1. Verify dealer controller permission cho club
  2. Nếu dealer đang `pre_assigned` → release pre-assign (clear `pre_assigned_attendance_id` + set `current_state='available'`)
  3. Tính overtime: `(now - check_in_time) - break_time - 480` (standard shift = 8h)
  4. UPDATE `status='checked_out'`, `current_state='checked_out'`, `check_out_time=NOW()`, `overtime_minutes`
  5. Gửi Telegram notification
  6. Nếu dealer đang pre_assigned → send alert tới floor_manager_chat_id

### 2.3 Re-check-in
- **Where**: `DealerSwingTab.tsx` — `doReCheckin()`
- **Logic**:
  - INSERT record MỚI (không UPDATE record cũ)
  - Giữ nguyên record `checked_out` cũ cho payroll history
  - Partial unique index đảm bảo không có 2 active check-in

---

## 3. Dealer Scoring & Selection

### 3.1 `buildDealerCandidates()` — Core selection engine
**File**: `supabase/functions/_shared/dealer-utils.ts:101-288`

**Step 1**: Lấy active dealer IDs từ `dealers` table (status='active')
**Step 2**: Query `dealer_attendance` với filter:
- `current_state = 'available'`
- `status = 'checked_in'`
- `dealer_id IN (active IDs)`

**Step 3**: Join `dealer_shift_metrics` VIEW để lấy `minutes_since_rest`, `total_assignments`
**Step 4**: Query `dealer_assignments` cho back-to-back detection (last table per attendance)
**Step 5**: Exclude busy dealers (đang `assigned` hoặc `pre_assigned`)
**Step 6**: Loop từng candidate, áp dụng hard filters + scoring

#### Hard Filters (loại bỏ ngay)
| Condition | Action |
|-----------|--------|
| `tourTier=HIGH && tier=C` | Skip |
| `priorityBreak && restMin >= 100` | Skip |
| `restMin >= 105` | Skip |
| `requiredGameTypes` mismatch | Skip |

#### Scoring Formula

```
score = rest_bonus + fatigue_penalty + tier_bonus
      + back_to_back_penalty + consecutive_penalty
      + mixed_bonus + skill_bonus + priority_break_penalty
      + high_fatigue_penalty
```

| Factor | Value | Điều kiện |
|--------|-------|-----------|
| `rest_bonus` | +200 / +100 / +50 | restMin >= 20 / >= 10 / >= 5 |
| `fatigue_penalty` | -floor(restMin/10)*5 | Luôn tính (max -60 vì restMin < 105) |
| `tier_bonus (HIGH)` | A=+30, B=+5 | tourTier=HIGH |
| `tier_bonus (MEDIUM)` | B=+20 | tourTier=MEDIUM |
| `tier_bonus (normal)` | C=+20 | default |
| `back_to_back_penalty` | -50 | lastTableId === currentTableId |
| `consecutive_penalty` | -consecutive*10 | consecutive >= 3 |
| `mixed_bonus` | +2 | skills.includes("Mixed") |
| `skill_bonus` | +20/skill | requiredGameTypes match |
| `priority_break_penalty` | -500 | priorityBreak == true |
| `high_fatigue_penalty` | -100 / -50 | restMin >= 90 / >= 75 |

**Sort**: Descending theo score

### 3.2 `pickNextDealer()` — Lấy dealer tốt nhất
Trả về candidate `[0]` từ `buildDealerCandidates()`.

### 3.3 `pickTopDealers()` — Top N dealers
Trả về `candidates.slice(0, topN)` — dùng cho UI suggestions.

### 3.4 `buildScoreLabel()` — Human-readable label
**File**: `dealer-utils.ts:309-320`

Ví dụ output:
- "Dealer hạng A ưu tiên · Thời gian nghỉ dài"
- "Hạng B – phù hợp · Tránh bàn cũ · Đến giờ nghỉ"

---

## 4. Assign Dealer (Manual)

### 4.1 UI Flow
**File**: `src/components/cashier/DealerSwingTab.tsx:1005-1089`

1. Click bàn → `openAssignModal(tableId)`
2. Gọi edge function `assign-dealer` với `return_suggestions_only=true`
3. Hiển thị **Gợi ý hàng đầu** (top 3 dealers từ `pickTopDealers`)
   - Mỗi suggestion hiển thị: tên, tier badge, score, score_breakdown tooltip
4. **Gán thủ công**: dropdown chọn từ `useCheckedInDealers` (chỉ checked-in dealers)
5. Click Gán → `confirmAssign(dealer_id)`

### 4.2 Edge Function: `assign-dealer/index.ts`
**Endpoint**: `supabase/functions/assign-dealer/index.ts`

**Mode 1: Suggestions only** (`return_suggestions_only=true`)
- Gọi `pickTopDealers(admin, clubId, 3, ...)`
- Trả về `{ suggestions: [{ attendance_id, dealer_id, dealer_name, tier, score, score_breakdown, reason }] }`

**Mode 2: Force assign** (`force_dealer_id` provided)
1. Query `dealer_attendance` tìm checked-in record:
   - `.eq("dealer_id", force_dealer_id).eq("status", "checked_in")`
   - **Không filter shift_date** (fix timezone mismatch bug)
2. Nếu không tìm thấy → `DEALER_NOT_CHECKED_IN`
3. Lock dealer: `select_dealer_for_update` RPC
4. Tính swing duration: `computeSwingDuration()`
5. INSERT `dealer_assignments` với `status='assigned'`, `swing_due_at`
6. Audit log + Telegram notification

---

## 5. Auto Swing System — `process-swing`

**File**: `supabase/functions/process-swing/index.ts` (705 dòng)
**Trigger**: Supabase Cron (mỗi ~55 giây) hoặc manual trigger

### 5.1 Per-Club Distributed Lock
- Lock bằng RPC `try_acquire_club_lock` / `release_club_lock`
- Tránh 2 instance cron chạy overlap
- Manual trigger bỏ qua lock

### 5.2 Cấu hình mỗi club
```typescript
interface ClubSwingConfig {
  swing_duration_minutes: number;   // Thời gian 1 swing (default 45)
  break_duration_minutes: number;   // Thời gian break (default 15)
  pre_announce_minutes: number;     // Pre-announce trước swing (default 6)
  auto_swing_enabled: boolean;      // Tắt/mở auto swing
  base_duration_minutes: number;    // Base cho dynamic duration
  target_ratio: number;             // Ratio mục tiêu (default 1.43)
  max_duration_minutes: number;     // Max swing duration (default 60)
  min_duration: number;             // Min swing duration (default 30)
}
```

### 5.3 Pool Snapshot & Batch Swing Duration
**File**: `calculateBatchSwingDuration.ts`

**Vấn đề**: Khi fill nhiều bàn cùng lúc, pool dealer shrink dần → mỗi lần INSERT thấy pool khác → duration khác nhau.

**Fix (Hướng B)**: Chụp pool snapshot 1 lần TRƯỚC batch → compute 1 duration → dùng cho cả batch.

```
ratio = weighted_pool / active_tables
factor = CLAMP(ratio / target_ratio, base/max, base/min)
duration = CLAMP(base / factor, min, max)
```

### 5.4 Ba Passes của Swing Cycle

#### Pass 1: Auto-fill bàn trống
- Query tất cả `game_tables` active không có assignment
- Sort theo `current_blind_level` DESC (ưu tiên bàn cao)
- Gọi `fillEmptyTables()`:
  - Loop từng bàn trống, tối đa 3 attempts/bàn
  - Mỗi attempt: `pickNextDealer()` → `assign_dealer_to_table` RPC
  - Nếu conflict → exclude dealer đó, retry
  - Dùng `batchSwingDueAt` chung cho cả batch
- **Cleanup stale pre_assign**: clear pre_assign > 20 phút

#### Pass 2: Pre-assign dealer kế tiếp (T-N minutes)
- Không chạy nếu `forceAll=true`
- Tìm assignments sắp đến hạn swing trong window `[now + (N-2)min, now + (N+2)min]`
- Với mỗi assignment:
  1. `pickNextDealer()` — exclude dealer đang assigned
  2. CAS update: set `pre_assigned_attendance_id`, `pre_assigned_at`
  3. Set dealer state = `pre_assigned`
  4. Gửi Telegram: pre-announce + notify incoming dealer (nếu có telegram_user_id)
- Nếu không tìm thấy dealer → gửi pre-announce message (thông báo bàn sắp đến giờ)

#### Pass 3: Execute swings (T-0)
- Query assignments với `swing_due_at <= now + 2min`, chưa xử lý
- **Pre-assigned path** (có `pre_assigned_attendance_id`):
  - Gọi `execute_pre_assigned_swing` RPC:
    1. Validate inputs
    2. Look up old assignment + game_tables (club_id, table_id)
    3. Atomic lock: UPDATE dealer_attendance SET current_state='assigned' WHERE current_state='available'
    4. Nếu race_lost → clear pre_assign, log, skip
    5. Tính worked_minutes thực tế cho dealer cũ
    6. Close assignment cũ (completed hoặc on_break)
    7. Update dealer cũ state
    8. Nếu send_to_break → INSERT dealer_breaks record
    9. INSERT assignment mới với `ON CONFLICT (attendance_id) WHERE status='assigned'`
    10. Tính worked_minutes cho dealer mới
  - Telegram: swing_in notification + break_start notification

- **Non-pre-assigned path** (không có pre_assign):
  - Gọi `evaluateBreakNeed()` — quyết định có nên cho dealer cũ break không
  - OT dealer LUÔN được send_to_break (INVARIANT)
  - `pickNextDealer()` — tìm dealer thay thế
  - Gọi `perform_swing` RPC:
    1. Load + lock assignment row (FOR UPDATE)
    2. Version CAS check
    3. Nếu không có dealer → SET overtime_started_at + priority_break_flag + retry sau 55s
    4. Nếu có dealer:
       - Release old assignment + set swing_processed_at
       - Tính compensatory break nếu OT: `min(breakDuration + OT/2, 60)`
       - INSERT new assignment với `ON CONFLICT (attendance_id) WHERE status='assigned'`
       - Nếu conflict → rollback + race_lost
    5. Audit log
  - Telegram: swing_in, break_start, OT alert, swing_skipped alert, all-tables-OT alert

### 5.5 perform_swing RPC — Atomic Swing Execution
**File**: `migrations/20260619000000_fix_perform_swing_on_conflict.sql`

Signature:
```sql
perform_swing(
  p_assignment_id UUID,
  p_version INT,
  p_next_attendance_id UUID DEFAULT NULL,
  p_send_to_break BOOLEAN DEFAULT false,
  p_break_duration_minutes INT DEFAULT NULL,
  p_swing_duration_minutes INT DEFAULT 90,
  p_swing_due_at TIMESTAMPTZ DEFAULT NULL
) RETURNS JSONB
```

Key outcomes:
| outcome | Ý nghĩa |
|---------|---------|
| `swung` | Swing thành công, new assignment created |
| `no_dealer` | Không có dealer → OT tracking |
| `race_lost` | Concurrent update conflict → skip |
| `swing_skipped` | Quá nhiều retry → can thiệp thủ công |

### 5.6 execute_pre_assigned_swing RPC
**File**: `migrations/20260618000000_fix_execute_pre_assigned_swing.sql`

Atomic pre-assigned swing execution với:
- TOCTOU-fix: UPDATE + WHERE current_state='available' trong 1 statement
- Worked minutes computation cho cả dealer cũ và mới
- ON CONFLICT guard bằng partial unique index
- Send-to-break support với break record creation

---

## 6. Overtime (OT) Tracking

### 6.1 Khi nào bắt đầu OT?
- Pass 3 không tìm được dealer thay → `perform_swing` với `p_next_attendance_id=NULL`
- RPC set `overtime_started_at` + `priority_break_flag = true`
- Swing_due_at được reset về `now + 55s` (retry nhanh)

### 6.2 Trong OT
- Mỗi cron tick retry với dealer mới
- `is_new_overtime` flag: chỉ true ở lần đầu → gửi 1 Telegram alert duy nhất
- Dealer OT luôn được `send_to_break=true` khi có người thay (INVARIANT)

### 6.3 Kết thúc OT (có dealer thay)
- `overtime_minutes` được accumulate vào dealer cũ
- Compensatory break: `min(breakDuration + OT_minutes/2, 60)`

### 6.4 Checkout với OT
Tại checkout, OT tính: `max(0, workedMinutes - 480)` (standard shift 8h)
→ ghi vào `dealer_attendance.overtime_minutes`

### 6.5 All-tables-OT alert
Nếu tất cả due assignments đều đang OT → Telegram alert:
"🚨 TOÀN BỘ N BÀN ĐANG OT — Pool dealer rỗng hoàn toàn."

---

## 7. Break System

### 7.1 `evaluateBreakNeed()` — Quyết định break
**File**: `dealer-utils.ts:437-496`

- **Priority break**: `priorityBreakFlag && worked >= minWork` → break
- **Mandatory break**: `worked >= maxWork` (default 120 phút) → break
- **Balance break**: So sánh break ratio của dealer vs club average
  - Nếu dealer's ratio < average * 0.8 → break

### 7.2 Break flow
1. Old dealer's assignment set status = `on_break` hoặc `completed`
2. INSERT `dealer_breaks` record
3. `dealer_attendance.current_state = 'on_break'`
4. Hết break: `sendToBreak()` / `endBreak()` trong frontend

### 7.3 Priority break flag
- Set = true khi OT bắt đầu
- Set = false khi swing được xử lý (có dealer mới)

---

## 8. Pre-assign Mechanism

### 8.1 Luồng hoạt động
1. **Pass 2** (T - pre_announce_minutes):
   - Tìm assignments sắp due swing
   - `pickNextDealer()` → chọn dealer kế
   - Set `pre_assigned_attendance_id` + `pre_assigned_at`
   - Dealer state → `pre_assigned`
2. **Pass 3** (T-0):
   - `execute_pre_assigned_swing` → atomic swap
3. **Stale cleanup** (Pass 1):
   - Pre-assign > 20 phút chưa xử lý → clear (giải phóng dealer)

### 8.2 Check-out ảnh hưởng pre-assign
Nếu dealer đang pre_assigned check-out:
- Release pre-assign (clear + set available)
- Alert tới floor manager

### 8.3 Force-assign ảnh hưởng pre-assign
Nếu force_assign vào dealer đang pre_assigned cho bàn khác:
- `perform_swing` race_lost → pre-assign đó mất hiệu lực

---

## 9. Payroll Integration

### 9.1 `get_dealer_payroll()` RPC
**File**: `migrations/20260611000000_payroll_system.sql`

**Input**: `p_club_id, p_from_date, p_to_date`
**Output** per dealer:
```
dealer_id, full_name, tier, employment_type,
hourly_rate_vnd, base_rate_vnd,
total_hours, overtime_minutes, total_swings,
base_pay, overtime_pay, total_pay
```

**Công thức lương**:
| Loại | part_time | full_time |
|------|-----------|-----------|
| base_pay | `total_hours * hourly_rate` | `base_rate_vnd` (fixed) |
| overtime_pay | `OT_hours * hourly_rate * 1.5` | `OT_hours * hourly_rate * 1.5` |
| total_pay | base_pay + overtime_pay | base_rate + overtime_pay |

Với:
- `total_hours = SUM(check_out - check_in - break_time)` trong date range
- `overtime_minutes = SUM(da.overtime_minutes)` (tích luỹ qua các lần swing)
- `total_swings = COUNT(DISTINCT dealer_assignments)`

### 9.2 `dealer_scores` VIEW
Tổng hợp 30 ngày gần nhất:
```
score = total_hours * 1 + total_swings * 0.5 + tier_bonus
tier_bonus: A=20, B=10, C=0
```

---

## 10. Telegram Notifications

### 10.1 `TelegramNotifier` class
**File**: `supabase/functions/_shared/telegramNotifier.ts`

Queue-based batching: enqueue events → flush batch để tránh rate limit.

### 10.2 Event types
| Event | Timing | Message |
|-------|--------|---------|
| `swing_in` | Dealer mới vào bàn | 🔵 `{dealer} → {table}` |
| `break_start` | Dealer đi break | 🟢 `{dealer} break {duration}ph` |
| `pre_assign` | T-N phút | Pre-announce: `{out} ← {in} ({minsLeft}ph)` |
| `ot_alert` | OT bắt đầu | ⏱ `{table} — {dealer} OT` |
| `all_ot` | Toàn bộ OT | 🚨 `TOÀN BỘ N BÀN ĐANG OT` |
| `swing_skipped` | Retry hết | 🚨 `{table} — can thiệp thủ công` |
| `checkout` | Dealer check-out | `{dealer} checkout: {h} tiếng` |
| `checkout_pre_release` | Pre-assigned checkout | ⚠️/🚨 `{dealer} checkout (đang pre_assigned)` |

### 10.3 Chat targets
- Group chat: `club_settings.telegram_chat_id`
- Floor manager: `club_settings.floor_manager_chat_id`
- Dealer DM: `dealers.telegram_user_id`

---

## 11. UI Components & Hooks

### 11.1 Main Page: `DealerSwingTab.tsx`
Hooks sử dụng:
```
useCheckedInDealers(clubIds)      → dealers (checked-in only)
useActiveAssignments(clubIds)     → assignments
useSwingConfigs(clubIds)          → swingConfigs
useTodayCheckedOutDealers(clubIds) → checkedOutDealers
useRealtimeQuery                  → Base hook cho realtime subscription
```

Components render:
```
├── RosterPanel (25%)          — Danh sách dealers, check-in/out buttons
├── TableGrid / DealerManagementTab (50%)  — Bàn + trạng thái
└── CommandCenter (25%)        — Nút điều khiển (auto-swing, mass-assign, etc.)
```

### 11.2 Dialogs
- **Assign Modal** (`modalTable`): Gán dealer cho bàn
- **Check-in Dialog** (`checkinOpen`): Multi-select check-in với 2 section
- **Check-out Dialog** (`checkoutOpen`): Batch check-out
- **Swing Config Dialog** (`swingConfigOpen`): Cấu hình swing
- **Payroll Dialog**: Xem bảng lương

### 11.3 Key Functions
| Function | File | Mô tả |
|----------|------|-------|
| `openAssignModal` | DealerSwingTab.tsx:296 | Mở modal assign, gọi suggestions |
| `confirmAssign` | DealerSwingTab.tsx:315 | Gán dealer (force) qua edge function |
| `doCheckin` | DealerSwingTab.tsx:539 | INSERT check-in mới |
| `doReCheckin` | DealerSwingTab.tsx:595 | INSERT re-check-in (giữ record cũ) |
| `sendToBreak` | DealerSwingTab.tsx:368 | Gửi dealer đi break |
| `endBreak` | DealerSwingTab.tsx:394 | Kết thúc break |
| `autoSwingAll` | DealerSwingTab.tsx:→ | Trigger process-swing manual |
| `massAssign` | DealerSwingTab.tsx:→ | Gán hàng loạt |

---

## 12. Data Flow Diagrams

### 12.1 Swing Cycle (mỗi ~55s cron tick)
```
Cron tick
  │
  ├─ acquireClubLock (per club)
  │
  ├─ PASS 1: fillEmptyTables (auto-fill bàn trống)
  │   ├─ Clean stale pre_assign
  │   └─ pickNextDealer + assign_dealer_to_table (batch swingDueAt)
  │
  ├─ PASS 2: Pre-assign (T-N minutes)
  │   ├─ pickNextDealer (exclude busy)
  │   └─ set pre_assigned_attendance_id + Telegram pre-announce
  │
  ├─ PASS 3: Execute swings (T-0)
  │   ├─ Pre-assigned path → execute_pre_assigned_swing
  │   └─ Non-pre-assigned path → perform_swing (OT/break)
  │
  └─ releaseClubLock
```

### 12.2 Manual Assign Flow
```
User click table
  ├─ openAssignModal(tableId)
  ├─ Edge function: assign-dealer (suggestions only)
  │   ├─ pickTopDealers(admin, clubId, 3)
  │   └─ return { suggestions: [...] }
  ├─ User chọn dealer (suggested hoặc manual dropdown)
  ├─ confirmAssign(dealerId)
  │   ├─ Edge function: assign-dealer (force)
  │   │   ├─ check checked_in status
  │   │   ├─ select_dealer_for_update (lock)
  │   │   ├─ computeSwingDuration
  │   │   └─ INSERT dealer_assignments
  │   └─ Telegram notification
  └─ Refresh UI
```

---

## 13. File Map

| File | Vai trò |
|------|---------|
| `supabase/functions/assign-dealer/index.ts` | Manual assign + suggestions |
| `supabase/functions/process-swing/index.ts` | Auto-swing orchestration (3 passes) |
| `supabase/functions/process-swing/calculateBatchSwingDuration.ts` | Batch swing duration formula |
| `supabase/functions/checkout-dealer/index.ts` | Check-out + OT + pre-assign release |
| `supabase/functions/_shared/dealer-utils.ts` | Core: pickNextDealer, fillEmptyTables, evaluateBreakNeed, computeSwingDuration, scoring |
| `supabase/functions/_shared/telegram.ts` | Telegram notification helpers |
| `supabase/functions/_shared/telegramNotifier.ts` | Queue-based Telegram notifier |
| `src/components/cashier/DealerSwingTab.tsx` | Main swing page (~2900 lines) |
| `src/hooks/useDealerSwing.ts` | React hooks (useCheckedInDealers, useActiveAssignments, useRealtimeQuery, etc.) |
| `supabase/migrations/*.sql` | ~20 migration files for swing system |

**Key RPCs** (SQL functions):
| RPC | Migration file |
|-----|----------------|
| `perform_swing` | `20260619000000_fix_perform_swing_on_conflict.sql` |
| `execute_pre_assigned_swing` | `20260618000000_fix_execute_pre_assigned_swing.sql` |
| `assign_dealer_to_table` | `20260530000005_pre_assign_swing.sql` |
| `select_dealer_for_update` | `20260530000005_pre_assign_swing.sql` |
| `club_local_date` | `20260610000001_fix_swing_safety.sql` |
| `get_dealer_payroll` | `20260611000000_payroll_system.sql` |
| `get_dealer_pool_snapshot` | `20260617000000_batch_swing_duration.sql` |
| `calculate_dynamic_swing_duration` | `20260604000000_dynamic_swing_duration.sql` |
| `try_acquire_club_lock` | `20260530000005_pre_assign_swing.sql` |
| `release_club_lock` | `20260530000005_pre_assign_swing.sql` |
