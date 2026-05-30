# DEALER SWING — TỔNG HỢP TOÀN BỘ CODE & TÀI LIỆU

> Ngày tổng hợp: 25/05/2026
> Dự án: VinPoker (Supabase: orlesggcjamwuknxwcpk)
> Telegram Bot Token: 8966181611:AAH0A_3WpRaZW6JD2Ss-EcpKrOy6b4cPIAY

---

## MỤC LỤC

1. [Kiến trúc tổng quan](#1-kiến-trúc-tổng-quan)
2. [Frontend Components](#2-frontend-components)
3. [Hooks (useDealerSwing)](#3-hooks-usedealerswing)
4. [Process-Swing (Edge Function)](#4-process-swing-edge-function)
5. [Assign-Dealer (Edge Function)](#5-assign-dealer-edge-function)
6. [Checkout-Dealer (Edge Function)](#6-checkout-dealer-edge-function)
7. [Manage-Break (Edge Function)](#7-manage-break-edge-function)
8. [Mass-Assign (Edge Function)](#8-mass-assign-edge-function)
9. [Close-Table (Edge Function)](#9-close-table-edge-function)
10. [EnforceBreakBalance (Edge Function)](#10-enforcebreakbalance-edge-function)
11. [Telegram-Webhook (Edge Function)](#11-telegram-webhook-edge-function)
12. [Telegram-Swing-Notifier (Edge Function)](#12-telegram-swing-notifier-edge-function)
13. [Shared: Dealer-Utils](#13-shared-dealer-utils)
14. [Shared: Telegram](#14-shared-telegram)
15. [Important: Bug hiện tại & Cần sửa](#15-important-bug-hiện-tại--cần-sửa)
16. [File paths](#16-file-paths)

---

## 1. KIẾN TRÚC TỔNG QUAN

### Vòng đời 1 dealer tại 1 bàn

```
check-in → available → assigned → pre_assigned (T-6) → swing (T-0) → available/on_break
```

### Luồng chính (Auto-Swing) — 3-Pass Architecture

```
pg_cron (mỗi phút)
  │
  └─► process-swing (Edge Function)
        │
        ├─ Pass 1: Auto-fill bàn trống + cleanup stale pre_assigned
        │   └─ fillEmptyTables() → pickNextDealer() → dealer_assignments.insert
        │
        ├─ Pass 2: Pre-assign dealer T-6
        │   └─ pickNextDealer() → CAS lock pre_assigned_attendance_id → dealer state = pre_assigned
        │   └─ Telegram: formatPreAssignMessage (outgoing+incoming+24h time)
        │
        └─ Pass 3: Execute swing T-0
              ├─ execute_pre_assigned_swing() RPC (nếu có pre-assign)
              │   └─ CAS lock → verify pre_assigned còn hợp lệ → swing
              │   └─ pre_assigned_lost → fallback: perform_swing() + pickNextDealer()
              └─ perform_swing() RPC (legacy fallback)
                    └─ CAS lock → release old → create break? → assign new → audit log
```

### Cron Jobs

| Job | Schedule | Edge Function | Mục đích |
|-----|----------|---------------|----------|
| `process-swing-auto` | `* * * * *` (mỗi phút) | process-swing | Tự động swing |
| `enforce-break-balance` | `*/15 * * * *` | enforceBreakBalance | Ép break định kỳ |

---

## 2. FRONTEND COMPONENTS

**File:** `VinPoker/src/components/cashier/DealerSwingTab.tsx` (2092 dòng)

### Layout 3 cột

```
┌──────────┬──────────────────────┬──────────┐
│  25%     │       50%            │   25%    │
│ Roster   │     Table Grid       │ Command  │
│ Panel    │   (Tour filter)      │  Center  │
│          │                      │          │
│ Available│ ┌────┐ ┌────┐ ┌────┐ │ Auto-   │
│ Assigned │ │Bàn1│ │Bàn2│ │Bàn3│ │ swing   │
│ On Break │ │5:12│ │2:30│ │8:45│ │ toggle  │
│          │ └────┘ └────┘ └────┘ │          │
│ Check-in │                      │ Mass     │
│ Check-out│ TimerCell (1s tick)  │ Assign   │
│          │ Color: green/amber/  │          │
│ Fatigue  │ red dựa trên warn/   │ Force    │
│ Dots     │ crit threshold       │ Swing    │
│          │                      │          │
│          │                      │ Config   │
│          │                      │ Dialogs  │
└──────────┴──────────────────────┴──────────┘
```

### Các sub-components (tất cả trong 1 file)

1. **SwingPanel** (export default) — Main 3-column layout, state management
2. **RosterPanel** — Left column: dealer list grouped by status (Sẵn sàng/Đang bàn/Đang nghỉ/Đang chờ)
3. **TableGrid** — Center column: table cards with timer + assign/break buttons
4. **CommandCenter** — Right column: actions + break balance widget + audit log
5. **TimerCell** — Self-updating countdown (1s interval), color by warn/crit
6. **TierBadge** — A (yellow) / B (slate) / C (amber)
7. **TableTypeBadge** — tournament (blue)
8. **StatusPill** — Sẵn sàng/Đang bàn/Đang nghỉ/Đang chờ colors
9. **FatigueDot** — Red/amber/green based on worked_minutes_since_last_break
10. **DealerTimer** — Elapsed time display
11. **SwingConfigDialog** — Config dialog with AutoAdjustSection
12. **AutoAdjustSection** — Gợi ý thông số + effective duration display

### SwingConfigDialog (inline, ~300 dòng)

**Key behavior:**
- `defaultForm` uses `min=30` for swing_duration, base_duration, min_duration
- Form populate clamps all durations with `Math.max(30, ...)`
- **Only Tournament** section (no Cash/HighHand)
- `applySuggest` writes: swing_duration = base, pre_announce = Math.min(15, Math.max(5, round(base/3))), min_duration = Math.max(30, round(base*0.5))
- Save writes to `swing_config` via upsert

### Bug đã fix trong RosterPanel
- Dùng `d.current_state` (`pre_assigned` → "Đang chờ" purple, `assigned` → "Đang bàn" fallback)
- Thêm section `"Đang chờ"` với `text-purple-400` pill

### TableGrid
- Shows upcoming dealer name inline next to timer (pre-assigned)
- Shows upcoming dealer on empty tables if pre-assigned

---

## 3. HOOKS (useDealerSwing)

**File:** `VinPoker/src/hooks/useDealerSwing.ts` (400 dòng)

### Exported hooks

| Hook | Query | Return |
|------|-------|--------|
| `useCheckedInDealers(clubIds)` | dealer_attendance WHERE status='checked_in' + join dealers | `{data, loading, refetch}` — polling 30s |
| `useActiveTables(clubIds)` | game_tables WHERE status='active' | `{data, loading, refetch}` |
| `useAvailableTables(clubIds)` | game_tables WHERE status='inactive' AND shift_id IS NULL | `{data, loading, refetch}` |
| `useActiveAssignments(clubIds, shiftId?)` | dealer_assignments WHERE status IN ('assigned','on_break') + joins | `{data, loading, refetch}` — polling 30s |
| `useSwingConfigs(clubIds)` | swing_config WHERE club_id IN (...) | `{data, loading, refetch}` |
| `useSwingMetrics(clubIds)` | swing_metrics WHERE date = today | `{data, loading, refetch}` |
| `useBreakPolicies(clubIds)` | shift_break_policies | data (no loading) |
| `useSpecialDates(clubIds)` | special_dates | `{data, refetch}` |
| `useAuditLogs(clubIds, limit=20)` | audit_logs | data (no loading) |
| `usePreAssignedDealers(assignments)` | Build map table_id → PreAssignedInfo | `Record<table_id, PreAssignedInfo>` |

### Types

- **DealerAttendance**: id, dealer_id, shift_date, status, check_in_time, check_out_time, overtime_minutes, dealers (FK), current_state, worked_minutes_since_last_break, priority_break_flag
- **GameTable**: id, table_name, table_type, status, current_blind_level, down_count, club_id, shift_id
- **DealerAssignment**: id, attendance_id, table_id, assigned_at, released_at, status, version, swing_processed_at, swing_due_at, pre_assigned_attendance_id, pre_assigned_at, game_tables (FK), dealer_attendance (FK)
- **SwingConfig**: id, club_id, table_type, swing_duration_minutes, break_duration_minutes, warn_at_minutes, crit_at_minutes, break_return_policy, pre_announce_minutes
- **PreAssignedInfo**: attendance_id, full_name, telegram_username, table_id
- **ShiftBreakPolicy**: id, club_id, shift_type, min_work_before_break_minutes, max_work_before_mandatory_break_minutes, target_break_duration_minutes, max_break_time_variance_minutes
- **SwingMetrics**: id, club_id, date, total_swings, successful_swings, failed_swings, no_dealer_swings, avg_processing_time_ms, telegram_failures

### usePreAssignedDealers logic
1. Collect pre_assigned_attendance_ids from current assignments
2. Also fetch completed assignments with pre_assigned_attendance_id (empty tables case)
3. Join dealer_attendance → dealers to get full_name, telegram_username
4. Return map: `Record<table_id, PreAssignedInfo | null>`

---

## 4. PROCESS-SWING (EDGE FUNCTION)

**File:** `deploy-package/functions/process-swing/index.ts` (545 dòng)

### Auth
- `--no-verify-jwt` (cron + manual đều gọi được)
- Kiểm tra Bearer token → decode JWT → sub

### Input
```typescript
{
  club_id?: string;          // null = tất cả clubs
  shift_id?: string;         // null = tất cả shifts
  force_all?: boolean;       // Bỏ qua swing_due_at check (Pass 3)
  dry_run?: boolean;         // Preview không thực thi
  manual_trigger?: boolean;  // Phân biệt manual vs cron
  required_game_types?: string[];
}
```

### Pass 1 — Auto-fill bàn trống (dòng 85-131)

1. **Cleanup stale pre_assigned** (> 8 phút) → release lock, set `current_state = available`
2. Piggyback clock từ `updated_at` của cleanup query
3. Gọi `fillEmptyTables(admin, clubId, shiftId, botToken)` → trả về `FillResult { assignments, assignedAttendanceIds }`
4. Telegram: `formatAutoFillMessage` + `sendGroupNotify`
5. Track `pass1AssignedIds` cho intra-cycle exclusion

### Pass 2 — Pre-assign dealer T-6 (dòng 133-252)

**BUG HIỆN TẠI:** Dòng 145 query `.eq('table_type', 'CASH')` — cần sửa thành `'tournament'`

Logic:
1. Đọc `pre_announce_minutes` từ `swing_config` (clubId != null)
2. Nếu không có config: `PRE_ASSIGN_WINDOW_MIN=4`, `PRE_ASSIGN_LEAD_MIN=6`
3. Query assignments: `swing_due_at` trong window (now + PRE_ASSIGN_WINDOW_MIN → now + PRE_ASSIGN_WINDOW_MIN + 4), chưa có `pre_assigned_attendance_id`
4. Với mỗi assignment:
   - `pickNextDealer()` với `excludeAttendanceIds` = pass1AssignedIds + pass2PreAssignedIds
   - Nếu không có dealer → `formatPreAnnounceMessage` cảnh báo floor
   - CAS lock `pre_assigned_attendance_id` (atomic update)
   - Track `pass2PreAssignedIds` cho intra-loop exclusion
   - Lock dealer state → `pre_assigned`
   - Telegram: `formatPreAssignMessage` với outgoing+incoming+24h time
   - DM: `notifyIncomingDealer`

### Pass 3 — Execute swing T-0 (dòng 254-543)

1. Query assignments due: `status = 'assigned'`, `swing_processed_at IS NULL`
   - Nếu `!forceAll`: `swing_due_at <= now + 5 phút`
   - Nếu `forceAll`: `pre_assigned_attendance_id IS NOT NULL`
2. Với mỗi assignment:
   - **Nếu có pre-assign**: gọi `execute_pre_assigned_swing()` RPC
     - `race_lost` → skip
     - `pre_assigned_lost` → fallback: `evaluateBreakNeed()` + `pickNextDealer()` + `perform_swing()` RPC
     - `swung` / `swung_no_dealer` → success
   - **Nếu không pre-assign**: legacy path
     - Đọc `swing_config` để lấy duration
     - `evaluateBreakNeed()` → break decision
     - `pickNextDealer()` → `perform_swing()` RPC
3. Batch Telegram: `formatBatchSwingMessage` (1 msg/club)
4. FM DM nếu `swung_no_dealer`
5. Update `swing_metrics`

### Key design decisions

- **3-pass architecture**: Tránh swing dealer vừa được assign ở Pass 1
- **Intra-loop exclusion**: pass1AssignedIds + pass2PreAssignedIds
- **Approach A for config window**: hardcoded defaults khi `clubId = null` (cron), config-driven khi `clubId != null` (manual trigger)
- **Stale timeout**: 8 phút (giảm từ 15 phút)
- **Swing floor 10 min**: Không swing nếu còn < 10 phút (evaluateBreakNeed)

---

## 5. ASSIGN-DEALER (EDGE FUNCTION)

**File:** `deploy-package/functions/assign-dealer/index.ts` (277 dòng)

### Input
```typescript
{
  table_id: string;
  force_dealer_id?: string;      // Gán thủ công
  return_suggestions_only?: boolean;  // Chỉ lấy gợi ý
  requested_by?: string;
  idempotency_key?: string;
  shift_id?: string;
}
```

### Fair Rotation Scoring

```typescript
// Tier scoring (all tournament)
if (tier === "A") { score += 6; }
else if (tier === "B") { score += 4; }
else { score += 1; }
if (!skills.includes("Tournament")) { score -= 3; }

// Fairness: less worked = higher priority
const fairnessPenalty = Math.floor(workedMin / 30);
score -= fairnessPenalty;

// Avoid same-table back-to-back
if (lastTable === tableId) { score -= 5; }

// Skill bonuses
if (skills.includes("Mixed")) { score += 2; }
```

Return top 3 dealers sorted by score.

### Flow
1. Idempotency check (idempotency_key)
2. Get table + swing config
3. Check dealer_control permission
4. If force_dealer_id: verify attendance → row-level lock (select_dealer_for_update) → insert assignment
5. If suggestions only: fairRotation() → return top 3

---

## 6. CHECKOUT-DEALER (EDGE FUNCTION)

**File:** `deploy-package/functions/checkout-dealer/index.ts` (162 dòng)

### Input
```typescript
{ attendance_id: string }
```

### Flow
1. Get attendance info + club_id
2. Verify dealer_control permission
3. **If dealer was pre_assigned**: release pre_assigned (cleanup dealer_attendance + dealer_assignments)
4. Check-out: status → checked_out, check_out_time → now, current_state → checked_out
5. Telegram: FM DM + group notification if pre-assigned was released
6. Audit log

---

## 7. MANAGE-BREAK (EDGE FUNCTION)

**File:** `deploy-package/functions/manage-break/index.ts` (445 dòng)

### Actions

#### `start` — Bắt đầu break
- CAS lock: status → on_break (check version)
- Create dealer_breaks record
- Update attendance current_state → on_break
- Telegram: formatBreakMessage

#### `end` — Kết thúc break
- CAS lock: status → assigned (check version)
- Close dealer_breaks record
- If break_return_policy != "same_table": find empty table → reroute
- Telegram: formatBreakEndMessage

#### `return_from_break` — Dealer tự kết thúc (self-service)
- Verify attendance current_state = on_break
- Auth: isControl OR isSelf (dealer.user_id === uid)
- Call `complete_dealer_break()` RPC (atomic: FOR UPDATE SKIP LOCKED)

#### `tournament_break` — FM triggers global break
- Fetch all active assigned assignments for club
- CAS each: status → on_break
- Create break records (reason = "tournament_break")
- DM each dealer
- Telegram group: formatTournamentBreakMessage

---

## 8. MASS-ASSIGN (EDGE FUNCTION)

**File:** `deploy-package/functions/mass-assign/index.ts` (82 dòng)

### Input
```typescript
{ club_id: string; shift_id?: string }
```

### Flow
1. Check dealer_control permission
2. Call `fillEmptyTables(admin, club_id, shift_id, botToken)`
3. Audit logs per assignment
4. Telegram: formatMassAssignMessage

---

## 9. CLOSE-TABLE (EDGE FUNCTION)

**File:** `deploy-package/functions/close-table/index.ts` (190 dòng)

### Input
```typescript
{ table_id: string; requested_by?: string }
```

### Flow
1. Verify table + permission
2. Release any pre_assigned dealer for this table
3. Find active assignment → release (completed) + create break record (table_closed, 20 min)
4. Remove duplicate rows (same name + shift_id IS NULL)
5. Deactivate table: status = inactive, shift_id = null
6. Telegram: formatCloseTableMessage

---

## 10. ENFORCEBREAKBALANCE (EDGE FUNCTION)

**File:** `deploy-package/functions/enforceBreakBalance/index.ts` (266 dòng)

### Input
```typescript
{ club_id?: string; dry_run?: boolean }
```

### Flow
1. Get all clubs (or specific if club_id given)
2. For each club:
   - Get break policy (max_work_before_mandatory_break_minutes, default 120)
   - Get all checked-in dealers
   - For each dealer:
     - If `worked_minutes_since_last_break >= maxWorkThreshold`:
       - **available**: force break (create assignment with table_id=null, status=on_break, break record)
       - **assigned**: set `priority_break_flag = true`, Telegram alert
     - DM dealer cảnh báo

### Telegram
- `formatBreakAlertMessage` — group notification
- DM dealer với thông báo force break

---

## 11. TELEGRAM-WEBHOOK (EDGE FUNCTION)

**File:** `deploy-package/functions/telegram-webhook/index.ts` (389 dòng)

### Commands

| Command | Description |
|---------|-------------|
| `/start` | Welcome message |
| `/help` | Instructions |
| `/link <dealer_id\|phone>` | Link Telegram account với dealer |
| `/linkfloor <club_id>` | (Club Admin) Link Floor Manager chat |
| `/status` | Current table + worked time |
| `/tournamentbreak <min>` / `/tb <min>` | (Club Admin) Global tournament break |

### Auth
- `/linkfloor`: chỉ club_admin/super_admin được dùng
- `/tournamentbreak`: resolve club từ chat_id + check club_admin

---

## 12. TELEGRAM-SWING-NOTIFIER (EDGE FUNCTION)

**File:** `deploy-package/functions/telegram-swing-notifier/index.ts` (75 dòng)

Simple proxy để gửi Telegram notification:
- Resolve `__club__` → `telegram_chat_id` từ `club_settings`
- Gọi Telegram API sendMessage
- Log audit nếu fail

---

## 13. SHARED: DEALER-UTILS

**Hai bản copy giống nhau:**
- `deploy-package/functions/_shared/dealer-utils.ts` (686 dòng) — có `computeSwingDuration` + `pickNextDealer` 2-query version (dealer_attendance + dealers!inner + dealer_shift_metrics flat)
- `deploy-package/shared/dealer-utils.ts` (575 dòng) — phiên bản cũ hơn, `pickNextDealer` dùng `dealer_shift_metrics` view với `dealer_attendance!inner` join

### Exported functions

#### `pickNextDealer()` — Thuật toán chọn dealer tốt nhất
**Input:** `(admin, clubId, { tourTier, swingDurationMinutes, requiredGameTypes, currentTableId, excludeAttendanceIds })`

**Hard filters (7):**
1. `current_state = 'available'`
2. `status = 'checked_in'`
3. Cùng club (scope via dealers)
4. Pool depletion (excludeAttendanceIds)
5. HIGH tour → exclude Tier C
6. Fatigue hard-exclude: < 15 min to mandatory break (120 min)
7. Skill match (nếu requiredGameTypes specified)

**Scoring (11 factors):**
1. New dealer bonus (+1000)
2. Rest bonus — step function (>=20 min = +200, >=10 min = +100)
3. Near mandatory break penalty
4. Workload fairness — prefer less worked
5. Break balance — prefer less break
6. Tier match bonus (HIGH→A:+30/B:+5, MEDIUM→B:+20, LOW→C:+20)
7. High-value table balance (HIGH tier only)
8. Relative HIGH table penalty (> avg+2 → penalty)
9. Back-to-back penalty (-50)
10. Consecutive assignment penalty (>=3 → penalty)
11. Skill match bonus (+20 per match)

#### `fillEmptyTables()` — Fill bàn trống hàng loạt
**Return:** `FillResult { assignments: AssignmentInfo[], assignedAttendanceIds: Set<string> }`

**Logic:**
1. Query active tables không có active assignment
2. Sort HIGH → MEDIUM → LOW
3. For each: `pickNextDealer()` với exclusion set → RPC `assign_dealer_to_table`
4. Retry up to 3 lần nếu conflict
5. Track `assignedAttendanceIds` cho pool depletion trong loop
6. FM alert nếu không assign được bàn nào

#### `computeSwingDuration()` — Tính duration động
**Return:** `SwingDurationResult { durationMinutes, isDynamic, poolRatio }`
- Nếu `auto_adjust_duration = false`: dùng `swing_duration_minutes`
- Nếu `auto_adjust_duration = true`: gọi RPC `calculate_dynamic_swing_duration`
- Tính `poolRatio` (available + pre_assigned*0.5) / active_tables

#### `evaluateBreakNeed()` — Có nên cho dealer đi break không?
- **Mandatory break**: worked >= maxWork (120 min)
- **Balance break**: worked >= minWork (60 min) + break deficit < avg*0.8

#### `getTableIdsForClub()` — Get active table IDs

---

## 14. SHARED: TELEGRAM

**Hai bản copy giống nhau:**
- `deploy-package/functions/_shared/telegram.ts` (322 dòng)
- `deploy-package/shared/telegram.ts` (319 dòng)

### Format helpers

| Function | Format |
|----------|--------|
| `mention(dealer)` | `@username` hoặc `full_name` |
| `formatSwingMessage` | `📋 Bàn X: @old ra, @new vào (còn Y phút).` |
| `formatPreAnnounceMessage` | `⏰ Bàn X: @out còn ~Y phút. Floor chuẩn bị!` |
| `formatBreakMessage` | `☕ @dealer đang nghỉ (X phút). Bắt đầu lúc: Y.` |
| `formatBreakEndMessage` | `✅ @dealer đã nghỉ xong, quay lại bàn X.` |
| `formatCloseTableMessage` | `🛑 Bàn X: ĐÃ ĐÓNG. Dealer Y được release.` |
| `formatMassAssignMessage` | `📦 Mass Assign (X bàn): ...` |
| `formatPreAssignMessage` | `📋 Tiếp theo T49: @out ra, @inc vào (21:26, còn 3 phút)` |
| `formatAutoFillMessage` | `🔄 Tự động fill (X bàn): ...` |
| `formatPreAssignFallbackMessage` | `⚠️ Bàn X: Pre-assign fallback — @out, lý do: Y.` |
| `formatBatchSwingMessage` | `📋 Batch Swing (X bàn): ...` |
| `formatBreakAlertMessage` | `🔴 [KHẨN] @dealer — reason. Cần nghỉ sớm!` |
| `formatTournamentBreakMessage` | `⏸ TOURNAMENT BREAK: X phút, Y dealer, Z bàn` |
| `formatCheckoutAlertMessage` | `🚨 @dealer check-out khỏi bàn X — BÀN TRỐNG!` |
| `formatTierWarningMessage` | `⚠️ Tier không phù hợp: dealer (tier) → bàn (tier)` |
| `formatForceBreakMessage` | `🔴 FORCE BREAK: @dealer — reason` |

### DM helpers

| Function | Target | Format |
|----------|--------|--------|
| `notifyFloorManagerDM` | `floor_manager_chat_id` | Custom text |
| `notifyDealerDM` | `telegram_user_id` | Custom text (HTML) |
| `notifyIncomingDealer` | `telegram_user_id` | `🔔 Chuẩn bị: Bàn <b>X</b> sau ~Y phút. Đến vị trí!` |

### Core send

| Function | Description |
|----------|-------------|
| `getClubTelegramChatId(admin, clubId)` | Lấy `telegram_chat_id` từ `club_settings` |
| `sendTelegramNotification(botToken, chatId, text, options?)` | Send + retry 3 lần + exponential backoff |

---

## 15. IMPORTANT: BUG HIỆN TẠI & CẦN SỬA

### Bug 1: process-swing Pass 2 không đọc pre_announce_minutes
**File:** `process-swing/index.ts:145`
**Vấn đề:** `.eq('table_type', 'CASH')` — UI chỉ lưu `table_type = 'tournament'`
**Fix:** Đổi `'CASH'` → `'tournament'`

### Bug 2: TELEGRAM_BOT_TOKEN có thể không set
**File:** process-swing/env
**Vấn đề:** Nếu `TELEGRAM_BOT_TOKEN` không set trên edge function, `sendGroupNotify` silently fails
**Fix:** Kiểm tra `supabase secrets list` và re-set nếu cần

### Cấu hình hiện tại
- **Approach A**: hardcoded defaults khi `clubId = null` (cron), config-driven khi `clubId != null` (manual trigger)
- **Min 30 enforcement**: cả DB RPC (`GREATEST(30, ...)`) + UI (`min={30}` + `Math.max(30, ...)`)
- **Pre-assign Telegram format**: `📋 Tiếp theo T49: {outgoing} ra, {incoming} vào (21:26, còn 3 phút)`
- **Battle map**: upcoming dealer name inline next to timer; also shown on empty tables if pre-assigned
- **Only Tournament** table type in dialog

---

## 16. FILE PATHS

### Frontend
```
D:\Quy trình\VinPoker\src\components\cashier\DealerSwingTab.tsx       (2092 dòng - ALL components)
D:\Quy trình\VinPoker\src\hooks\useDealerSwing.ts                     (400 dòng - hooks + types)
```

### Edge Functions (deploy-ready, đã deploy lên Supabase)
```
D:\Quy trình\deploy-package\functions\process-swing\index.ts          (545 dòng - core 3-pass)
D:\Quy trình\deploy-package\functions\assign-dealer\index.ts          (277 dòng - fair rotation)
D:\Quy trình\deploy-package\functions\checkout-dealer\index.ts        (162 dòng)
D:\Quy trình\deploy-package\functions\manage-break\index.ts           (445 dòng)
D:\Quy trình\deploy-package\functions\mass-assign\index.ts            (82 dòng)
D:\Quy trình\deploy-package\functions\close-table\index.ts            (190 dòng)
D:\Quy trình\deploy-package\functions\enforceBreakBalance\index.ts    (266 dòng)
D:\Quy trình\deploy-package\functions\telegram-webhook\index.ts       (389 dòng)
D:\Quy trình\deploy-package\functions\telegram-swing-notifier\index.ts (75 dòng)
```

### Shared Utilities (đã deploy)
```
D:\Quy trình\deploy-package\functions\_shared\dealer-utils.ts         (686 dòng - pickNextDealer, fillEmptyTables, computeSwingDuration)
D:\Quy trình\deploy-package\functions\_shared\telegram.ts             (322 dòng - format helpers, DM, send)
D:\Quy trình\deploy-package\shared\dealer-utils.ts                    (575 dòng - copy cũ hơn)
D:\Quy trình\deploy-package\shared\telegram.ts                        (319 dòng - copy cũ hơn)
```

### Migrations (dealer swing liên quan)
```
D:\Quy trình\deploy-package\migrations\20260522000001_dealer_swing_manager.sql
D:\Quy trình\deploy-package\migrations\20260524000001_swing_break_policy_and_state.sql
D:\Quy trình\deploy-package\migrations\20260528000002_perform_swing_rpc.sql
D:\Quy trình\deploy-package\migrations\20260529000001_swing_enhancements.sql
D:\Quy trình\deploy-package\migrations\20260530000003_sprint3_schema.sql
D:\Quy trình\deploy-package\migrations\20260530000005_pre_assign_swing.sql
D:\Quy trình\deploy-package\migrations\20260530000006_cleanup_pre_assigned.sql
D:\Quy trình\deploy-package\migrations\20260604000000_dynamic_swing_duration.sql
D:\Quy trình\deploy-package\migrations\20260605000000_unique_active_assignment.sql
D:\Quy trình\deploy-package\migrations\20260606000000_cleanup_stale_assignments.sql
D:\Quy trình\deploy-package\migrations\20260607000000_suggest_swing_config.sql
```

### Docs
```
D:\Quy trình\VinPoker\DEALER_SWING_ARCHITECTURE.md                   (660 dòng)
D:\Quy trình\VinPoker\DEALER_SWING_FULL.md                           (928 dòng)
D:\Quy trình\VinPoker\DEALER_SWING_OPERATIONS.md                     (799 dòng)
```
