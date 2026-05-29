# Dealer Swing — Kiến Trúc & Tư Duy

## Mục lục
1. [Tổng quan & Luồng dữ liệu](#1-tổng-quan--luồng-dữ-liệu)
2. [Database Schema](#2-database-schema)
3. [Các RPC (Stored Procedures)](#3-các-rpc-stored-procedures)
4. [Triggers](#4-triggers)
5. [Edge Functions](#5-edge-functions)
6. [Shared Utilities](#6-shared-utilities)
7. [Frontend](#7-frontend)
8. [Cron Jobs](#8-cron-jobs)
9. [Tư duy thiết kế cốt lõi](#9-tư-duy-thiết-kế-cốt-lõi)
10. [Lịch sử quyết định quan trọng](#10-lịch-sử-quyết-định-quan-trọng)

---

## 1. Tổng quan & Luồng dữ liệu

### Vòng đời 1 dealer tại 1 bàn

```
check-in → available → assigned → pre_assigned (T-6) → swing (T-0) → available/on_break
```

### Luồng chính (Auto-Swing)

```
pg_cron (mỗi phút)
  │
  └─► process-swing (Edge Function)
        │
        ├─ Pass 1: Auto-fill bàn trống
        │   └─ fillEmptyTables() → pickNextDealer() → dealer_assignments.insert
        │
        ├─ Pass 2: Pre-assign dealer T-6
        │   └─ pickNextDealer() → lock pre_assigned_attendance_id → dealer state = pre_assigned
        │
        └─ Pass 3: Execute swing T-0
              ├─ execute_pre_assigned_swing() RPC (nếu có pre-assign)
              │   └─ CAS lock → verify pre_assigned còn hợp lệ → swing
              │   └─ pre_assigned_lost → fallback: perform_swing() + pickNextDealer()
              └─ perform_swing() RPC (legacy fallback)
                    └─ CAS lock → release old → create break? → assign new → audit log
```

### Luồng phụ

```
enforceBreakBalance (cron 15 phút)
  └─ forced break (available quá threshold)
  └─ priority_break_flag (assigned quá threshold)

manage-break (manual)
  ├─ start → create break record, set on_break
  ├─ end → close break, reassign to table
  └─ return_from_break → complete_dealer_break RPC

close-table
  └─ release dealer, create break, deactivate table
```

### 3-Pass Architecture (`process-swing`)

**Pass 1 — Auto-fill bàn trống**
- Query tất cả `game_tables` active không có `dealer_assignments` active
- Sort theo `tour_tier` (HIGH → MEDIUM → LOW)
- Gọi `pickNextDealer()` với `excludeAttendanceIds` để tránh dealer trùng
- Insert `dealer_assignments`, update `current_state = 'assigned'`

**Pass 2 — Pre-assign dealer T-6**
- Query assignments có `swing_due_at` trong window 4-8 phút tới, chưa có `pre_assigned_attendance_id`
- Gọi `pickNextDealer()` → CAS lock `pre_assigned_attendance_id`
- Update dealer attendance state → `pre_assigned`
- Telegram: group + DM cho incoming dealer

**Pass 3 — Execute swing T-0**
- Query assignments due (swing_due_at <= now + 5 phút OR force_all)
- Nếu có `pre_assigned_attendance_id`: gọi `execute_pre_assigned_swing()` RPC
  - Nếu `pre_assigned_lost`: fallback `perform_swing()` với `pickNextDealer()` mới
- Nếu không pre-assigned: `perform_swing()` legacy path
- Telegram notification, Realtime broadcast

---

## 2. Database Schema

### 2.1 Bảng chính

#### `dealers`
| Column | Type | Ghi chú |
|--------|------|---------|
| id | UUID PK | |
| club_id | UUID FK → clubs | |
| user_id | UUID nullable | |
| full_name | TEXT | |
| phone | TEXT | |
| tier | TEXT | 'A', 'B', 'C' |
| status | TEXT | 'active', 'inactive' |
| telegram_user_id | BIGINT UNIQUE | Thêm ở Sprint 3 |
| telegram_username | TEXT | Thêm ở Sprint 3 |

#### `dealer_shifts` (Tour)
| Column | Type | Ghi chú |
|--------|------|---------|
| id | UUID PK | |
| club_id | UUID FK → clubs | |
| tour_name | TEXT | VD: "Tour Sáng" |
| start_time | TIME | |
| end_time | TIME | |
| tour_tier | TEXT | HIGH / MEDIUM / LOW |

#### `dealer_attendance`
| Column | Type | Ghi chú |
|--------|------|---------|
| id | UUID PK | |
| dealer_id | UUID FK → dealers | |
| shift_id | UUID FK → dealer_shifts | |
| shift_date | DATE | |
| status | TEXT | 'checked_in', 'checked_out', 'absent' |
| check_in_time | TIMESTAMPTZ | |
| check_out_time | TIMESTAMPTZ | |
| current_state | TEXT | CHECK: **available**, **assigned**, **on_break**, **checked_out**, **pre_assigned** |
| worked_minutes_since_last_break | INT | Reset khi break kết thúc |
| priority_break_flag | BOOLEAN | |
| pre_assigned_table_id | UUID FK → game_tables | Thêm ở Sprint 3.5 |

#### `game_tables`
| Column | Type | Ghi chú |
|--------|------|---------|
| id | UUID PK | |
| club_id | UUID FK → clubs | |
| table_name | TEXT | VD: "Bàn 1" |
| table_type | TEXT | 'tournament' (cash/vip đã xóa) |
| status | TEXT | 'active', 'inactive' |
| game_type | TEXT | NLH / PLO / OFC / Mixed |
| blind_level | TEXT | |
| down_count | INT | |
| shift_id | UUID FK → dealer_shifts | Tour đang gán |
| tour_tier | TEXT | HIGH/MEDIUM/LOW, copy từ shift khi gán |

**Unique**: `(club_id, table_name, shift_id)`

#### `dealer_assignments` (Journal trung tâm)
| Column | Type | Ghi chú |
|--------|------|---------|
| id | UUID PK | |
| attendance_id | UUID FK → dealer_attendance | |
| table_id | UUID FK → game_tables | |
| assigned_at | TIMESTAMPTZ | |
| released_at | TIMESTAMPTZ | |
| status | TEXT | 'assigned', 'on_break', 'completed' |
| version | INT | Optimistic locking, auto-increment trigger |
| swing_processed_at | TIMESTAMPTZ | |
| idempotency_key | TEXT UNIQUE | |
| swing_due_at | TIMESTAMPTZ | assigned_at + swing_duration (trigger tính) |
| pre_announce_due_at | TIMESTAMPTZ | swing_due_at - pre_announce_minutes |
| pre_announced | BOOLEAN | |
| pre_assigned_attendance_id | UUID FK → dealer_attendance | Thêm ở Sprint 3.5 |
| pre_assigned_at | TIMESTAMPTZ | Thêm ở Sprint 3.5 |

#### `dealer_breaks`
| Column | Type | Ghi chú |
|--------|------|---------|
| id | UUID PK | |
| assignment_id | UUID FK → dealer_assignments | |
| break_start | TIMESTAMPTZ | |
| break_end | TIMESTAMPTZ nullable | |
| expected_duration_minutes | INT | |
| reason | TEXT | |

#### `swing_config`
| Column | Type | Ghi chú |
|--------|------|---------|
| id | UUID PK | |
| club_id | UUID FK → clubs | |
| table_type | TEXT | 'tournament' (cash/vip đã xóa) |
| swing_duration_minutes | INT | Mặc định 30-45 |
| break_duration_minutes | INT | Mặc định 15-20 |
| warn_at_minutes | INT | |
| crit_at_minutes | INT | |
| tournament_mode | BOOLEAN | |
| break_return_policy | TEXT | 'same_table', 'new_table' |
| pre_announce_minutes | INT | Thêm Sprint 3, min 5 max 15 |

### 2.2 Bảng phụ trợ

| Table | Mục đích |
|-------|----------|
| `swing_audit_logs` | Log chi tiết mỗi lần swing (ai vào, ai ra, lý do) |
| `swing_metrics` | Thống kê hàng ngày (total, success, fail, no_dealer, avg_time_ms) |
| `audit_logs` | Log chung mọi hành động |
| `dealer_attendance_log` | Lịch sử thay đổi trạng thái attendance |
| `dealer_skills` | Kỹ năng dealer theo game (NLH/PLO/OFC/Mixed) |
| `dealer_pay_rates` | Lương theo tier (A=150k/h, B=120k/h, C=100k/h) |
| `shift_break_policies` | Chính sách break theo ca (min_work, max_work, duration) |
| `club_settings` | Lưu `telegram_chat_id`, `auto_swing_enabled` |
| `special_dates` | Ngày đặc biệt (multiplier lương) |
| `dealer_incidents` | Sự cố dealer |

### 2.3 Views

#### `dealer_shift_metrics`
Kết hợp: attendance + worked times + breaks + assignments
```sql
SELECT
  da.id AS attendance_id, da.dealer_id, da.shift_id,
  d.club_id,
  -- Thời gian làm việc thực tế (trừ break)
  COALESCE(EXTRACT(EPOCH FROM (da.check_out_time - da.check_in_time)) / 60, 0)
    - COALESCE(SUM(db.break_duration), 0) AS total_worked_minutes,
  COALESCE(SUM(db.break_duration), 0) AS total_break_minutes,
  -- Lần break gần nhất
  MAX(db.break_end) AS last_break_end,
  -- Số lần gán bàn
  COUNT(das.id) FILTER (WHERE das.status = 'completed') AS total_assignments,
  -- Số lần gán bàn HIGH
  COUNT(das.id) FILTER (WHERE das.status = 'completed' AND das.table_id IN (...HIGH)) AS high_value_assignments,
  -- Thời gian từ lần break gần nhất đến giờ
  COALESCE(EXTRACT(EPOCH FROM (NOW() - MAX(db.break_end))) / 60, 9999) AS minutes_since_rest,
  da.current_state, da.priority_break_flag,
  da.worked_minutes_since_last_break
FROM dealer_attendance da
JOIN dealers d ON d.id = da.dealer_id
LEFT JOIN dealer_assignments das ON das.attendance_id = da.id
LEFT JOIN dealer_breaks db ON db.assignment_id = das.id
GROUP BY da.id, da.dealer_id, da.shift_id, d.club_id, da.current_state, ...
```

---

## 3. Các RPC (Stored Procedures)

### `perform_swing()`
**Mục đích**: Atomic swing — thay thế toàn bộ logic DB-side khi swing

**CAS Lock**: Kiểm tra `version = p_old_version AND status = 'assigned' AND swing_processed_at IS NULL`
- Nếu fail → `{status: 'race_lost'}` — không rollback, log conflict

**Logic**:
1. Lock old assignment (version CAS)
2. Release old: `status = 'completed'`, `released_at = now()`, `swing_processed_at = now()`
3. Reset old dealer: `current_state = 'available'`
4. Nếu cần break: tạo `dealer_breaks`, set old dealer `current_state = 'on_break'`
5. Tạo assignment mới cho dealer mới (hoặc không dealer → `swung_no_dealer`)
6. Log swing_audit_logs

### `execute_pre_assigned_swing()`
**Mục đích**: Atomic swing cho dealer đã pre-assign (T-6 → T-0)

**Khác với perform_swing**:
- CAS lock old assignment
- Verify pre-assigned dealer còn `current_state = 'pre_assigned'`
- Nếu mất: `{status: 'pre_assigned_lost'}` → caller fallback
- Nếu OK: release old, assign pre-assigned dealer, update states
- Không tạo break cho pre-assigned dealer (chưa từng ngồi bàn này)

### `complete_dealer_break()`
**Mục đích**: Atomic kết thúc break

- `SELECT ... FOR UPDATE SKIP LOCKED` — row-level lock
- Set `break_end = now()`
- Reset `current_state = 'available'`
- Reset `worked_minutes_since_last_break = 0`
- Clear `priority_break_flag`

### `select_dealer_for_update()`
**Mục đích**: Row-level lock với NOWAIT — tránh race condition khi assign dealer

### `is_club_dealer_control()`
**Mục đích**: Kiểm tra user có quyền dealer_control tại club không

### `predict_dealer_dealer_demand()`
**Mục đích**: Dự đoán số dealer cần dựa trên lịch sử + special_dates

---

## 4. Triggers

| Trigger | Bảng | Event | Hành động |
|---------|------|-------|-----------|
| `bump_dealer_assignment_version` | dealer_assignments | BEFORE UPDATE | `version = OLD.version + 1` |
| `trg_calc_swing_due_at` | dealer_assignments | BEFORE INSERT | Tính `swing_due_at` = assigned_at + swing_duration, `pre_announce_due_at` = swing_due_at - pre_announce_minutes |
| `update_dealers_updated_at` | dealers | BEFORE UPDATE | `updated_at = now()` |
| `log_attendance_change` | dealer_attendance | AFTER UPDATE | Insert vào `dealer_attendance_log` |
| `initialize_club_tables` | clubs | AFTER INSERT | Tạo 100 bàn pool mặc định |

---

## 5. Edge Functions

| Function | Trigger | Mục đích |
|----------|---------|----------|
| **process-swing** | cron */1 * * * * + manual | 3-pass orchestrator: auto-fill, pre-assign, execute |
| **mass-assign** | manual | Fill tất cả bàn trống với dealer tốt nhất |
| **assign-dealer** | manual | Force assign dealer cụ thể + fair rotation scoring |
| **manage-break** | manual | Start/end/return break |
| **enforceBreakBalance** | cron */15 * * * * | Force break khi dealer làm quá threshold |
| **close-table** | manual | Đóng bàn + cleanup dealer |
| **telegram-webhook** | Telegram API | `/link`, `/status`, `/help`, `/start` |
| **telegram-swing-notifier** | manual | Gửi Telegram notification (deprecated — dùng shared) |

### Chi tiết từng function

#### `process-swing` (447 dòng)
**Auth**: `--no-verify-jwt` (cron + manual đều gọi được)

**Input**:
```typescript
{
  club_id?: string;         // null = tất cả clubs
  shift_id?: string;        // null = tất cả shifts
  force_all?: boolean;      // Bỏ qua swing_due_at check
  dry_run?: boolean;        // Preview không thực thi
  manual_trigger?: boolean;  // Phân biệt manual vs cron
}
```

**Output**:
```typescript
{
  success: boolean;
  pass1_filled: number;        // Số bàn đã fill auto
  processed_count: number;     // Số swing đã thực thi
  failed_count: number;
  no_dealer_count: number;
  execution_time_ms: number;
  swings: Array<{ id, status, pass, table_name?, ... }>;
  errors?: Array<{ assignment_id, error }>;
}
```

**3-Pass chi tiết**:
```
Pass 1:
  Query: game_tables active WHERE club_id
  WHERE NOT EXISTS active assignment
  SORT BY tour_tier (HIGH→MEDIUM→LOW)
  FOR EACH: pickNextDealer() với exlusion set
  → INSERT dealer_assignments

Pass 2:
  Query: dealer_assignments WHERE
    swing_due_at BETWEEN now+4m AND now+8m
    AND pre_assigned_attendance_id IS NULL
    AND status = 'assigned'
  FOR EACH: pickNextDealer() → CAS update pre_assigned_attendance_id
  → Set dealer state = 'pre_assigned'
  → Telegram pre-announce

Pass 3:
  Query: dealer_assignments WHERE
    status = 'assigned'
    AND swing_processed_at IS NULL
    AND (swing_due_at <= now+5m OR force_all)
  FOR EACH:
    IF pre_assigned_attendance_id:
      → execute_pre_assigned_swing()
      → pre_assigned_lost? → pickNextDealer() + perform_swing()
    ELSE:
      → evaluateBreakNeed()
      → pickNextDealer()
      → perform_swing()
    → Realtime broadcast
    → Telegram swing notification
    → swing_metrics update
```

#### `mass-assign` (82 dòng)
**Input**: `{ club_id, shift_id? }`
**Logic**: Gọi `fillEmptyTables()` → audit_logs → Telegram group
**Output**: `{ assigned: number, assignments: [...] }`

#### `assign-dealer` (275 dòng)
**Input**: `{ table_id, force_dealer_id?, return_suggestions_only? }`
**Scoring algorithm** (`fairRotation`):
```
Mỗi dealer được điểm dựa trên:
  - Tier match với tour_tier (+30/20/10)
  - Fairness: ít đã làm việc → điểm cao (max 30)
  - Không bàn liên tiếp: +10
  - Skill bonus: +5 mỗi skill match
  - Phạt nếu đã làm bàn đó trước đó: -30
```
**Top 3** dealer có điểm cao nhất được trả về.

#### `manage-break` (341 dòng)
3 action:
- `start`: Tạo break record, set attendance → `on_break`
- `end`: Kết thúc break, nếu `break_return_policy = 'new_table'` → tìm bàn trống
- `return_from_break`: Dealer tự kết thúc break (self-service)

#### `enforceBreakBalance` (247 dòng)
- Loop clubs → loop dealers available
- Nếu `worked_minutes_since_last_break` > `max_work_before_mandatory_break` (120):
  - Available: force break (tạo assignment với table_id = null, status = on_break)
  - Assigned: set `priority_break_flag = true` → Telegram alert
- Nếu > `min_work_before_break` (90) + deficit >= 10 + coverage OK → balance break

#### `close-table` (175 dòng)
- Release dealer (completed)
- Tạo break record (reason = 'table_closed')
- Set attendance → available
- Deactivate table (status = inactive, shift_id = null)
- Xóa duplicate rows
- Telegram notification

#### `telegram-webhook` (218 dòng)
Commands:
- `/start` → welcome
- `/link <dealer_id|phone>` → link Telegram account với dealer
- `/status` → show current table + worked time
- `/help` → instructions

---

## 6. Shared Utilities

### `_shared/dealer-utils.ts` (409 dòng)

#### `pickNextDealer()` — Thuật toán chọn dealer tốt nhất

**Input**:
```typescript
(admin, clubId, shiftId?, _tableType, tourTier, _swingDurationMinutes,
 requiredGameTypes[], currentTableId, excludeAttendanceIds?)
```

**Logic**:
```
1. Query dealer_attendance WHERE
   shift_date = today
   status = 'checked_in'
   current_state = 'available'
   dealers.club_id = clubId
   [shiftId? → shift_id = shiftId]

2. Filter excludeAttendanceIds (pool depletion)

3. Hard exclude Dealer C from HIGH tour_tier

4. Fetch dealer_skills nếu cần game_type filter

5. Fetch minutesSinceRest từ dealer_breaks (real-time, không dùng view)

6. Fetch dealer_shift_metrics

7. Score mỗi dealer:
   +1000 nếu chưa có assignment nào (ưu tiên dealer mới)
   +min(200, minutesSinceRest * 1.5)  // thưởng nghỉ lâu
   -(30 - minutesUntilMandatory) * 2   // phạt sắp tới giới hạn
   +(avgWorked - dealerWorked) * 0.3   // fairness
   +(dealerBreak - avgBreak) * 0.4     // cân bằng break
   Tour tier bonuses:
     HIGH: +50 if A or B, +0 if C (đã exclude)
     MEDIUM: +30 all
     LOW: +20 all
   +(avgHV - dealerHV) * 3  // HIGH tour_tier bonus
   -50 nếu back-to-back (cùng bàn)
   +matchCount * 20  // skill bonus

8. Return dealer điểm cao nhất (hoặc null nếu không ai)
```

#### `evaluateBreakNeed()` — Có nên cho dealer đi break không?

```
1. Lấy max_work_before_mandatory_break từ shift_break_policies
2. Nếu worked_minutes >= max:
   → { should_break: true, reason: 'mandatory', urgency: 'critical' }
3. Nếu worked_minutes >= min_work_before_break:
   - Tính deficit = worked - min_work
   - Đếm available dealers
   - Nếu deficit >= 10 AND available >= activeTables * 20%:
     → { should_break: true, reason: 'balance', urgency: 'normal' }
4. Nếu không: { should_break: false }
```

#### `fillEmptyTables()` — Fill bàn trống hàng loạt

```
1. Count active tables → 0? return []
2. Fetch all active tables
3. Fetch active assignments → build busyTableIds
4. emptyTables = tables not in busyTableIds
5. Sort: HIGH → MEDIUM → LOW
6. FOR EACH emptyTable:
   - pickNextDealer(with exclusion set)
   - null? break (không thể assign thêm dealer)
   - INSERT dealer_assignments
   - UPDATE attendance → 'assigned'
7. Return [{table_name, dealer_name, tour_tier}]
```

### `_shared/telegram.ts` (232 dòng)

| Function | Format | Mục đích |
|----------|--------|----------|
| `mention(dealer)` | `@username` or `full_name` | Mention dealer |
| `formatSwingMessage` | `Bàn X: @old ra, @new vào` | Swing notification |
| `formatPreAnnounceMessage` | `Bàn X: @out còn ~Y phút` | Pre-announce T-10 |
| `formatBreakMessage` | `@dealer đang nghỉ (X phút)` | Break bắt đầu |
| `formatBreakEndMessage` | `@dealer quay lại bàn X` | Break kết thúc |
| `formatCloseTableMessage` | `Đóng bàn X. @dealer cuối` | Đóng bàn |
| `formatMassAssignMessage` | `Mass Assign X bàn: ...` | Mass assign |
| `formatPreAssignMessage` | `@dealer chuẩn bị ra bàn sau ~X phút` | Pre-assign DM |
| `formatAutoFillMessage` | `Tự động gán dealer X bàn` | Auto-fill |
| `formatPreAssignFallbackMessage` | `...đang chọn lại` | Fallback |
| `formatBreakAlertMessage` | `Cảnh báo: @dealer đã làm X phút` | Break alert |

**Luồng gửi**:
1. `notifyIncomingDealer()`: DM trực tiếp (nếu có `telegram_user_id`) → group mention fallback
2. `sendTelegramNotification()`: Retry 3 lần + exponential backoff

---

## 7. Frontend

### Hooks (`useDealerSwing.ts`)

| Hook | Query | Polling |
|------|-------|---------|
| `useCheckedInDealers()` | dealer_attendance WHERE status='checked_in' + join dealers | 30s |
| `useActiveTables()` | game_tables WHERE status='active' | — |
| `useAvailableTables()` | game_tables WHERE status='inactive' AND shift_id IS NULL | — |
| `useActiveAssignments()` | dealer_assignments WHERE status IN ('assigned','on_break') + joins | 30s |
| `useSwingConfigs()` | swing_config WHERE club_id IN (...) | — |
| `useSwingMetrics()` | swing_metrics WHERE date = today | — |
| `useBreakPolicies()` | shift_break_policies | — |
| `useSpecialDates()` | special_dates | — |
| `useAuditLogs()` | audit_logs (limit 20) | — |

### Component (`DealerSwingTab.tsx`, 1761 dòng)

**Layout 3 cột**:
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

**Key features**:
- TimerCell: đếm ngược 1 giây/lần, màu sắc theo `warn_at`/`crit_at`
- FatigueDot: đỏ nếu `priority_break_flag`, cam/ xanh theo `worked_minutes`
- Auto-Swing toggle: ON → massAssign() + autoSwingAll()
- Force Swing All: `force_all: true` — bỏ qua swing_due_at
- SwingConfigDialog: config duration, break, pre_announce_minutes

---

## 8. Cron Jobs

| Job | Schedule | Edge Function | Mục đích |
|-----|----------|---------------|----------|
| `process-swing-auto` | `* * * * *` (mỗi phút) | process-swing | Tự động swing |
| `enforce-break-balance` | `*/15 * * * *` | enforceBreakBalance | Ép break định kỳ |

**Cơ chế**: pg_cron gọi `net.http_post` đến edge function URL với anon key trong header.

---

## 9. Tư duy thiết kế cốt lõi

### 9.1 "3-Pass" — Tại sao không làm 1 pass?

**Vấn đề**: Nếu fill bàn trống (Pass 1) và execute swing (Pass 2/3) trong 1 query, dealer vừa được assign ở Pass 1 sẽ bị swing ngay lập tức (vì swing_due_at được trigger tính = now + duration, nhưng vừa assign xong đã thấy due).

**Giải pháp**: Tách làm 3 pass riêng, mỗi pass có query conditions khác nhau:
- Pass 1: `WHERE NOT EXISTS assignment` — bàn không có dealer
- Pass 2: `WHERE swing_due_at BETWEEN now+4 AND now+8` — pre-assign trước 6 phút
- Pass 3: `WHERE swing_due_at <= now+5 AND pre_assigned_attendance_id IS NOT NULL` — chỉ swing assignment đã due

### 9.2 Optimistic Locking (CAS) — Tại sao?

**Vấn đề**: Nhiều process (cron + manual) có thể swing cùng lúc → race condition.

**Giải pháp**: `version` column + trigger `bump_dealer_assignment_version`. Mỗi lần UPDATE, version tăng lên 1. `perform_swing` kiểm tra `version = p_old_version` trước khi thực hiện. Nếu version đã thay đổi (process khác đã swing trước) → `race_lost`.

### 9.3 `pre_assigned` state — Tại sao không để `available`?

**Vấn đề**: Dealer được chọn ở T-6, nhưng đến T-0 có thể bị process khác (mass assign, enforce break) lấy mất.

**Giải pháp**: Thêm state `pre_assigned` vào CHECK constraint. Khi dealer được pre-assign, state = `pre_assigned`. Các process khác query `WHERE current_state = 'available'` sẽ không thấy dealer này. Đến T-0, `execute_pre_assigned_swing` kiểm tra state còn `pre_assigned` không → nếu mất thì fallback.

### 9.4 `fillEmptyTables()` — Shared function

**Vấn đề**: Cả `mass-assign` và `process-swing` (Pass 1) đều cần fill bàn trống. Nếu code riêng, dễ không đồng bộ.

**Giải pháp**: Extract thành shared function trong `_shared/dealer-utils.ts`. Cả 2 function đều gọi cùng `fillEmptyTables()`.

### 9.5 Telegram — Group trước, DM sau

**Vấn đề**: Dealer cần nhận thông báo cá nhân, nhưng không phải dealer nào cũng link Telegram.

**Giải pháp**:
- **Bắt buộc**: Gửi lên group Telegram trước (luôn gửi được nếu có `telegram_chat_id`)
- **Nice-to-have**: DM riêng nếu dealer có `telegram_user_id` (đã `/link`)

### 9.6 `minutesSinceRest` — View hay direct query?

**Vấn đề**: View `dealer_shift_metrics` có column `minutes_since_rest`, nhưng stale do view cache/refresh.

**Giải pháp**: Tính `minutesSinceRest` trực tiếp từ `dealer_breaks` trong `pickNextDealer()`, không dùng view. Dùng subquery để lấy `break_end` mới nhất mỗi dealer, tính `Date.now() - break_end` để ra số phút.

### 9.7 Tour tier scoring — Tại sao Dealer C bị exclude khỏi HIGH?

**Vấn đề**: Bàn HIGH (giải đấu lớn) cần dealer kỹ năng cao. Dealer C (mới) không đủ kinh nghiệm.

**Giải pháp**: Hard exclude (filter `.dealers.tier !== "C"`) TRƯỚC khi scoring, không phải trong map scoring. Nếu sau filter không còn dealer nào → return null → break loop → báo lỗi qua Telegram.

### 9.8 Why `dealer_attendance!attendance_id!inner`?

**Vấn đề**: `dealer_assignments` có 2 FK đến `dealer_attendance` (`attendance_id` và `pre_assigned_attendance_id`). PostgREST không biết dùng FK nào khi join `!inner()` → ambiguous relationship error.

**Giải pháp**: Dùng syntax `dealer_attendance!attendance_id!inner(...)` để chỉ rõ FK.

### 9.9 Why `totalActive` guard + full scan?

**Vấn đề**: Nếu không có bàn active nào, đừng query tiếp.

**Giải pháp**: Guard count (head: true, lightweight) trước. Nếu count > 0 → full scan. Tránh query không cần thiết.

### 9.10 Why không dùng PostgreSQL ENUM cho `current_state`?

**Vấn đề**: Cần thêm state 'pre_assigned' ở Sprint 3.5. ALTER TYPE ... ADD VALUE không replay-safe trong migration.

**Giải pháp**: Dùng CHECK constraint (`TEXT` IN (...)). Khi cần thêm state: DROP constraint → recreate với giá trị mới. ALTER TABLE an toàn, có thể rollback.

---

## 10. Lịch sử quyết định quan trọng

| Quyết định | Ngày | Lý do |
|------------|------|-------|
| 3-pass architecture | Sprint 3 | Tránh swing dealer vừa được assign |
| `pre_assigned` state | Sprint 3.5 | Lock dealer T-6→T-0, tránh race condition |
| Telegram group bắt buộc, DM optional | Sprint 3 | Dealer có thể không link Telegram |
| Hard exclude Dealer C từ HIGH | Sprint 3 | Logic đơn giản hơn, không cần scoring phức tạp |
| `execute_pre_assigned_swing` RPC riêng | Sprint 3.5 | Atomic, xử lý `pre_assigned_lost` fallback riêng |
| Shared `fillEmptyTables()` | Sprint 3 | DRY: mass-assign + process-swing dùng chung |
| ` minutesSinceRest` direct query | Sprint 3 | View stale, cần realtime accuracy |
| `dealer_attendance!attendance_id!inner` | Sprint 3.5 | Fix PostgREST ambiguous relationship error |
| CHECK constraint thay vì ENUM | Sprint 3.5 | Dễ migration, không cần ALTER TYPE |
| Guard count + full scan | Sprint 3 | Tối ưu: lightweight count trước, scan sau |
| Auto-swing default OFF | Sprint 3 | An toàn khi tour chưa có bàn |
| `pre_announce_minutes` config riêng | Sprint 3 | Cho phép club tùy chỉnh thời gian pre-announce |
