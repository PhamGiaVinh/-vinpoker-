# Dealer Swing — Hệ Thống Vận Hành & Luồng Xử Lý

## Mục lục
1. [Tổng quan Kiến trúc](#1-tổng-quan-kiến-trúc)
2. [Pass Pipeline](#2-pass-pipeline)
3. [Pass 3 — Thực Thi Swing (Chi Tiết)](#3-pass-3--thực-thi-swing-chi-tiết)
4. [Dealer Scoring (pickNextDealer.ts)](#4-dealer-scoring-picknextdealerts)
5. [Timer & Timeline System](#5-timer--timeline-system)
6. [Shortage Handling — Xử Lý Thiếu Dealer](#6-shortage-handling--xử-lý-thiếu-dealer)
7. [Frontend (DealerSwingTab.tsx + Hooks)](#7-frontend-dealerswingtabtsx--hooks)
8. [Data Flow — Luồng Dữ Liệu](#8-data-flow--luồng-dữ-liệu)
9. [Key RPCs — Stored Procedures](#9-key-rpcs--stored-procedures)
10. [Config Tables — Bảng Cấu Hình](#10-config-tables--bảng-cấu-hình)

---

## 1. Tổng quan Kiến trúc

### Vòng đời 1 dealer tại 1 bàn
```
check-in → available → assigned → pre_assigned (T-6) → swing (T-0) → available / on_break
```

### Nguyên tắc vận hành
- **process-swing** edge function được pg_cron gọi mỗi ~60 giây
- Mỗi club được xử lý **độc lập** trong một vòng lặp tuần tự
- **CAS per-row** (cột `version` trên `dealer_assignments`) bảo vệ chống concurrent modification
- **Không dùng advisory lock** — mọi đồng bộ qua optimistic locking + `SKIP LOCKED`
- Batch swing duration được snapshot một lần duy nhất trước khi xử lý batch → TOCTOU-safe

### Cấu trúc trigger
- Pass 0: snapshot pool + phát hiện stuck + pre-cleanup
- Pass 1: auto-fill bàn trống (trước pre-assign)
- Pass 2: pre-assign dealer sắp đến lượt
- Pass 2.5: gán dealer ban đầu cho assignment chưa có dealer
- Pass 3: thực thi swing T-0
- Pass 4: end break + refresh pool summary

---

## 2. Pass Pipeline

### PASS 0 — Batch Swing Duration & Pool Snapshot

**Mục đích**: Lấy snapshot pool dealer một lần duy nhất trước batch, tính swing duration cho toàn batch.

**Luồng**:
1. Gọi `get_dealer_pool_snapshot` RPC → lấy số liệu pool (available, assigned, on_break, pre_assigned)
2. Gọi `calculateBatchSwingDuration(poolSnapshot)` → tính duration cho từng loại bàn dựa trên pool health:
   - Pool dư dealer → duration ngắn hơn (swing nhanh)
   - Pool thiếu dealer → duration dài hơn (giữ dealer lâu hơn)
   - Có thể điều chỉnh theo club_settings
3. Lưu batch duration vào context để Pass 3 dùng

**Ghi chú**: TOCTOU-safe vì snapshot trước khi bất kỳ mutation nào xảy ra trong batch.

### PASS 0b — Break Deadlock Guard

**Mục đích**: Đếm số dealer `available` để làm guard cho logic break. Nếu không còn dealer available nào, hệ thống sẽ không tạo thêm break (tránh deadlock: tất cả đều on_break, không ai available để swing).

**Luồng**:
1. `SELECT COUNT(*) FROM dealer_attendance WHERE current_state = 'available' AND club_id = $1`
2. Lưu biến `availableCount` → Pass 3 dùng để quyết định có tạo break không

### PASS 0c — Detect & Auto-fix Stuck Dealers (6 sub-checks)

**Mục đích**: Phát hiện và tự động sửa dealer bị kẹt ở trạng thái không hợp lệ (stuck state, overdue break, orphan pre_assigned).

**6 sub-checks**:
1. **Stuck `pre_assigned`**: `current_state = 'pre_assigned'` nhưng `pre_assigned_table_id` không còn assignment active hoặc quá hạn > 15 phút → reset về `available`
2. **Stuck `on_break`**: break đã `break_end` nhưng `current_state` vẫn là `on_break` → reset về `available`
3. **Stuck `assigned`**: `current_state = 'assigned'` nhưng không có `dealer_assignments` active → reset về `available`
4. **Overdue break detection**: gọi `detect_stuck_breaks` → tìm break quá `expected_duration_minutes * 1.5`
5. **Orphaned pre_assigned_attendance_id**: assignment có `pre_assigned_attendance_id` nhưng dealer đã bị gán đi bàn khác → clear
6. **Duplicate active assignments**: 1 dealer có >1 assignment `status = 'assigned'` → giữ mới nhất, close cũ

### PASS 1 — Auto-fill Empty Tables

**Mục đích**: Gán dealer cho bàn đang hoạt động nhưng chưa có assignment.

**Luồng**:
1. Query `game_tables WHERE status = 'active'` không có `dealer_assignments` active
2. Sort theo `tour_tier`: HIGH → MEDIUM → LOW
3. Gọi `fillEmptyTables()` (shared từ `_shared/dealer-utils.ts`)
4. Với mỗi bàn trống:
   - `pickNextDealer()` với exclusion set (tránh gán trùng dealer)
   - INSERT `dealer_assignments` → trigger tự tính `swing_due_at`
   - UPDATE `dealer_attendance.current_state = 'assigned'`
5. Telegram notification nếu có dealer mới được gán

**Quan trọng**: Pass 1 chạy **TRƯỚC** Pass 2 (pre-assign) để bàn mới fill có ngay dealer, không phải chờ pre-assign.

### PASS 1b — Clean Up Stale Pre-Assign Records

**Mục đích**: Xóa các bản ghi `pre_assign` đã quá hạn >20 phút so với `swing_due_at` dự kiến. Đây là các pre-assign "mồ côi" — dealer đã được pre-assign nhưng swing không bao giờ xảy ra (bàn bị đóng, dealer bị gán đi nơi khác).

**Luồng**:
1. Query assignments có `pre_assigned_attendance_id IS NOT NULL` và `(NOW() - pre_assigned_at) > 20 minutes`
2. Clear `pre_assigned_attendance_id`, `pre_assigned_at` về NULL
3. Reset dealer state về `available` nếu còn `pre_assigned`

### PASS 1c — Release Orphaned Pre-Assigned (No Table)

**Mục đích**: Dealer đang `pre_assigned` nhưng bàn đã bị đóng/xóa → release dealer.

**Luồng**:
1. Query dealer_attendance WHERE `current_state = 'pre_assigned'`
2. JOIN với game_tables để kiểm tra bàn còn tồn tại không
3. Nếu bàn không tồn tại hoặc `status = 'inactive'` → reset dealer về `available`, clear `pre_assigned_table_id`

### PASS 2 — Pre-Assign Incoming Dealers

**Mục đích**: Chọn dealer cho bàn sắp đến giờ swing (T+4 đến T+8 phút), khóa dealer ở state `pre_assigned`.

**Window**:
- **Bình thường**: `swing_due_at BETWEEN NOW() + 4min AND NOW() + 8min` (T-6 ±2 phút)
- **OT (Overtime)**: `swing_due_at BETWEEN NOW() + 1min AND NOW() + 5min` (T-3 ±2 phút, gấp hơn)

**Luồng**:
1. Query assignments thỏa window, chưa có `pre_assigned_attendance_id`, `status = 'assigned'`
2. Với mỗi assignment, gọi `pickNextDealer()` với exclusion set
3. CAS update `pre_assigned_attendance_id` trên `dealer_assignments`
4. Update dealer state → `pre_assigned`, set `pre_assigned_table_id`
5. Telegram DM cho dealer được pre-assign + group mention
6. Gọi `pre_assign_next_dealer_for_table` RPC (atomic, có CAS)

**Telegram format**:
```
⏰ @dealer_name chuẩn bị ra Bàn X sau ~6 phút
📍 Tour: Tour Sáng | Game: NLH
```

### PASS 2.5 — Assign Initial Dealers to Empty Assignments

**Mục đích**: Sửa các assignment có `dealer_id IS NULL` (lỗi race condition hoặc migration cũ). Gán dealer thực tế vào assignment.

**Luồng**:
1. Query assignments `WHERE dealer_id IS NULL AND status = 'assigned'`
2. Gọi `fill_dealer_id` RPC để gán `attendance_id` → `dealer_id` (join qua `dealer_attendance.dealer_id`)
3. Nếu không có attendance → đánh dấu assignment là `completed` (orphaned)

### PASS 3 — Execute Swings at T-0

**(Chi tiết ở Section 3 bên dưới)**

### PASS 4 — End Expired Breaks

**Mục đích**: Tự động kết thúc break đã quá hạn.

**Luồng**:
1. Gọi `end_expired_breaks` RPC:
   - Query breaks có `break_end IS NULL` và `NOW() > break_start + expected_duration_minutes * 1.2`
   - Set `break_end = NOW()`
   - Reset `current_state = 'available'` cho dealer
   - Reset `worked_minutes_since_last_break = 0`
2. Telegram notification nếu có break được end

### PASS 4b — Refresh Dealer Pool Summary

**Mục đích**: Cập nhật bảng `dealer_pool_summary` cho monitoring dashboard.

**Luồng**:
1. Gọi `refresh_dealer_pool_summary` RPC:
   - Đếm available, assigned, on_break, pre_assigned, checked_in, checked_out
   - Ghi vào bảng summary với timestamp
2. Dùng cho biểu đồ pool health, alerting

---

## 3. Pass 3 — Thực Thi Swing (Chi Tiết)

Pass 3 là pass phức tạp nhất trong toàn bộ pipeline. Đây là nơi thực sự thực hiện swing — dealer cũ rời bàn, dealer mới vào.

### 3.1 Query & Sort

**Query assignments cần swing**:
```sql
SELECT * FROM dealer_assignments
WHERE status = 'assigned'
  AND swing_processed_at IS NULL
  AND (swing_due_at <= NOW() + INTERVAL '5 minutes' OR force_all = true)
LIMIT 8
```

**Sort order**:
1. **OT (overtime) first**: assignment có `swing_due_at` đã qua → ưu tiên xử lý trước
2. **Oldest `swing_due_at` first**: trong cùng nhóm OT/non-OT, assignment nào đến hạn sớm nhất được xử lý trước

**LIMIT 8**: Giới hạn số swing mỗi lần chạy để tránh timeout edge function (50s hard limit của Supabase).

### 3.2 Circuit Breaker

**Điều kiện**: Assignment có `swing_due_at` quá hạn >60 phút so với hiện tại.

**Hành động**:
- Đánh dấu `swing_processed_at = NOW()`, `status = 'completed'`
- Gửi Telegram alert: "⚠️ Bàn X — Swing quá hạn 60+ phút, đã bỏ qua. Cần xử lý thủ công."
- Ghi `swing_audit_logs` với lý do `overdue_skip`

### 3.3 Pre-Assigned Path

Nếu assignment có `pre_assigned_attendance_id`:

```
Gọi execute_pre_assigned_swing() RPC
  ├─ CAS lock: version = old_version AND swing_processed_at IS NULL
  ├─ Verify: dealer còn current_state = 'pre_assigned'
  ├─ OK:
  │   ├─ Release old dealer (completed, available)
  │   ├─ Assign pre-assigned dealer vào assignment
  │   ├─ Update states: old → available, new → assigned
  │   └─ Return: { status: 'ok' }
  └─ race_lost / pre_assigned_lost:
      └─ Fallback: perform_swing() + pickNextDealer() (non-pre-assigned path)
```

**`pre_assigned_lost` scenarios**:
- Dealer đã bị gán đi bàn khác (state không còn `pre_assigned`)
- Dealer đã checkout
- Version CAS fail (process khác đã swing trước)

### 3.4 Non-Pre-Assigned Path — pickNextDealer với 3 Levels

Khi assignment không có pre-assign (hoặc pre-assign bị mất), hệ thống tìm dealer mới qua 3 level fallback:

#### L1: Normal — Tất cả filter active
- Gọi `pickNextDealer()` với đầy đủ filter:
  - Busy exclusion (dealer đang assigned)
  - Tired exclusion (mệt, sắp đến giới hạn break)
  - Tier hard-exclude (Dealer C không được gán bàn HIGH)
  - Fatigue hard cap (quá max_work → không chọn)
  - Game type exclusion (không có skill tương ứng)
  - Priority break penalty (-500 nếu có `priority_break_flag`)
- **Thành công** → swing bình thường
- **Thất bại (0 candidates)** → thử L2

#### L2: skipPriorityBreakGuard — Bỏ qua penalty ưu tiên break
- **Áp dụng cho**: Bàn OT (overtime) > 0 phút
- Bỏ filter `priority_break_flag` → dealer sắp đến giờ break vẫn được chọn
- Giữ các filter khác (tier, fatigue, game type)
- **Thành công** → swing với dealer "gần giới hạn"
- **Thất bại (0 candidates)** → thử L3

#### L3: skipFatigueHardCap — Bỏ qua hard cap mệt mỏi
- **Áp dụng cho**: Bàn OT > 20 phút (cực kỳ cấp bách)
- Bỏ `fatigue_hard_cap` → dealer đã làm quá `max_work_before_mandatory_break` vẫn được chọn
- **Đây là last resort** — ưu tiên có dealer trên bàn hơn là để bàn trống
- **Thành công** → swing + Telegram alert "⚠️ Dealer X đã vượt giới hạn làm việc"
- **Thất bại (0 candidates)** → `no_dealer` — bàn không có dealer

### 3.5 SAFEGUARD — Verify Club

**Kiểm tra cuối cùng trước khi swing**:
```typescript
if (selectedDealer.club_id !== table.club_id) {
  // SAFEGUARD: Dealer không thuộc club của bàn
  // → bỏ qua dealer này, log lỗi, Telegram alert
  // → thử fallback tiếp theo hoặc no_dealer
}
```

Đây là safeguard chống lại bug data integrity — đảm bảo dealer không bao giờ được gán vào bàn của club khác.

### 3.6 Progressive Fallback Diagram

```
pickNextDealer() L1 (full filters)
  ├─ Có dealer → swing
  └─ 0 candidates → L2
      ├─ Có dealer → swing (warn: skipPriorityBreak)
      └─ 0 candidates → L3
          ├─ Có dealer → swing (crit: skipFatigueCap + alert)
          └─ 0 candidates → no_dealer
              └─ Ghi swing_metrics.no_dealer_count++
              └─ Telegram alert
              └─ Kiểm tra shortage → auto_close?
```

### 3.7 After Swing — Side Effects

1. **Release old dealer**: `current_state = 'available'` (hoặc `on_break` nếu cần break)
2. **Assign new dealer**: `current_state = 'assigned'`
3. **Break creation**: Nếu `evaluateBreakNeed()` → `should_break: true`
   - Tạo `dealer_breaks` record
   - Set old dealer `current_state = 'on_break'`
4. **Realtime broadcast**: Gửi qua Supabase Realtime channel
5. **Telegram notification**: Group message
6. **swing_audit_logs**: Ghi log audit (old_dealer, new_dealer, reason, timestamp)
7. **swing_metrics**: Cập nhật counter (success/fail/no_dealer/execution_time_ms)

---

## 4. Dealer Scoring (pickNextDealer.ts)

### 4.1 13 Score Components

| # | Component | Weight | Mô tả |
|---|-----------|--------|-------|
| 1 | `priority_swing_bonus` | **+300** | Dealer được ưu tiên swing (đã nghỉ đủ lâu, coverage tốt) |
| 2 | `priority_break_penalty` | **-500** | Dealer có `priority_break_flag = true` → cần break gấp, tránh chọn |
| 3 | `minutes_since_rest` | +min(200, minutes × 1.5) | Thưởng dealer đã nghỉ lâu |
| 4 | `minutes_until_mandatory` | -(30 - minutes) × 2 | Phạt dealer sắp tới giới hạn break bắt buộc |
| 5 | `fairness_worked` | +(avgWorked - dealerWorked) × 0.3 | Cân bằng thời gian làm việc giữa các dealer |
| 6 | `fairness_break` | +(dealerBreak - avgBreak) × 0.4 | Cân bằng thời gian nghỉ |
| 7 | `tour_tier_bonus_HIGH` | +50 (A/B), +0 (C) | Bàn HIGH ưu tiên dealer tier cao |
| 8 | `tour_tier_bonus_MEDIUM` | +30 | Bàn MEDIUM thưởng đều |
| 9 | `tour_tier_bonus_LOW` | +20 | Bàn LOW thưởng nhẹ |
| 10 | `high_value_fairness` | +(avgHV - dealerHV) × 3 | Fairness cho bàn HIGH (ai ít làm HIGH được ưu tiên) |
| 11 | `back_to_back_penalty` | -50 | Phạt dealer vừa rời bàn này (không quay lại ngay) |
| 12 | `skill_bonus` | +matchCount × 20 | Mỗi game type khớp với skill của dealer |
| 13 | `new_dealer_bonus` | +1000 | Dealer chưa có assignment nào trong ca → ưu tiên cao nhất |

### 4.2 Filter Pipeline (Trước khi Score)

Dealer bị loại trước khi tính điểm nếu thuộc các trường hợp:

| Filter | Điều kiện | Ghi chú |
|--------|-----------|---------|
| **Busy exclusion** | `current_state IN ('assigned', 'on_break', 'pre_assigned')` | Dealer đang bận |
| **Tired exclusion** | `worked_minutes_since_last_break >= max_work_before_mandatory_break * 0.9` | Sắp tới giới hạn |
| **Tier hard-exclude** | `tier = 'C' AND tour_tier = 'HIGH'` | Dealer C không làm bàn HIGH |
| **Fatigue hard cap** | `worked_minutes >= max_work_before_mandatory_break` | Vượt giới hạn (trừ L3) |
| **Game type exclude** | Không có `dealer_skills` cho game type của bàn | Không đủ kỹ năng |
| **Club mismatch** | `dealer.club_id ≠ table.club_id` | Khác club |
| **Checked out** | `status = 'checked_out'` | Đã checkout |
| **Exclusion set** | `attendance_id IN excludeAttendanceIds` | Đã được gán trong batch này |

### 4.3 Diagnostics Logging

Khi `pickNextDealer()` trả về 0 hoặc ≤ 2 candidates:
- Log tất cả dealer đã bị filter ra + lý do
- Log số dealer available ban đầu
- Log các filter đã active
- Gửi Telegram diagnostic nếu 0 candidates (shortage alert)

---

## 5. Timer & Timeline System

### 5.1 Batch Swing Duration

**TOCTOU-safe, one snapshot before batch**:
```
Bắt đầu batch:
  1. SELECT COUNT(*) FROM dealer_attendance WHERE current_state = 'available'
  2. SELECT COUNT(*) FROM game_tables WHERE status = 'active'
  3. Tính pool_ratio = available / active_tables
  4. Tính duration:
     - pool_ratio >= 2.0 → duration = swing_config.swing_duration_minutes (base)
     - pool_ratio >= 1.5 → duration = base * 1.1
     - pool_ratio >= 1.0 → duration = base * 1.2
     - pool_ratio <  1.0 → duration = base * 1.3 (shortage mode)
  5. Lưu vào batch context → dùng cho mọi swing trong batch
```

Snapshot một lần duy nhất tránh TOCTOU: nếu query pool sau mỗi lần swing trong batch, số liệu sẽ bị sai lệch do chính các swing trước đó đã thay đổi.

### 5.2 Deterministic Stagger

**Công thức**: `stagger_offset = (table_index % 10) × 30 seconds`

Mỗi bàn trong batch được offset 30s so với bàn trước, tối đa 10 nhóm. Ngăn tất cả bàn swing đồng loạt (gây spike load).

```
Bàn 0, 10, 20: swing tại T+0
Bàn 1, 11, 21: swing tại T+30s
Bàn 2, 12, 22: swing tại T+60s
...
Bàn 9, 19, 29: swing tại T+270s (4.5 phút)
```

### 5.3 Sync-Swing Mode

Khi bật `sync_swing` (config), tất cả bàn trong cùng một tour swing tại cùng một thời điểm:
- `swing_due_at` được set giống nhau cho mọi bàn
- Dùng cho giải đấu có cấu trúc blind level — tất cả dealer đổi cùng lúc

### 5.4 Config Hierarchy — Độ Ưu Tiên Cấu Hình Duration

```
table override (swing_configs)     ← ưu tiên cao nhất
  └─ tournament config (tournaments.swing_duration_minutes)
      └─ club config (swing_config.swing_duration_minutes)
          └─ default (45 minutes)  ← fallback cuối cùng
```

Mỗi bàn có thể có duration riêng, nếu không có thì kế thừa từ tournament, rồi club, rồi default.

### 5.5 Timeline Visualization

```
T-45:  assignment được tạo → trigger tính swing_due_at = now + duration
T-8:   window pre-assign mở (bình thường)
T-6:   pre-assign dealer, lock state = pre_assigned, Telegram DM
T-5:   window pre-assign mở (OT mode)
T-4:   window pre-assign đóng (bình thường)
T-3:   pre-assign dealer (OT mode)
T-1:   window pre-assign đóng (OT mode)
T-0:   swing_due_at → execute swing
       ├─ pre-assigned path: execute_pre_assigned_swing()
       └─ non-pre-assigned path: perform_swing() + pickNextDealer()
T+1:   swing hoàn thành → new assignment → T+45 tiếp theo
T+60:  circuit breaker: nếu chưa swing → overdue >60min → skip
```

---

## 6. Shortage Handling — Xử Lý Thiếu Dealer

### 6.1 Auto-Close Low Priority Tables

**Trigger**: `no_dealer_count / total_active_tables > 50%` **VÀ** `no_dealer_count >= 3`

**Hành động**:
1. Gọi `auto_close_low_priority_tables` RPC
2. Sort bàn LOW tier trước, sau đó MEDIUM, không đóng HIGH
3. Đóng từng bàn, release dealer → tăng pool available
4. Telegram alert: "⚠️ Thiếu dealer — Đã tự động đóng X bàn ưu tiên thấp"
5. Audit log

### 6.2 All-Tables-OT Alert

Khi **tất cả** bàn active đều đang OT (quá `swing_due_at`):
- Telegram alert: "🚨 TẤT CẢ BÀN ĐỀU QUÁ HẠN SWING — Thiếu dealer trầm trọng"
- Tự động bật `emergency_mode`: giảm duration, bỏ fatigue cap

### 6.3 Telegram Escalation with Recommendations

Mức độ escalation:

| Level | Điều kiện | Hành động |
|-------|-----------|-----------|
| **Info** | `no_dealer = 1-2` | Log + metric |
| **Warning** | `no_dealer >= 3` hoặc `no_dealer > 30%` | Telegram group alert |
| **Critical** | `no_dealer > 50%` hoặc tất cả OT | Telegram + tự động close LOW tables |
| **Emergency** | `available = 0` và `active_tables > 0` | Telegram + khuyến nghị: check-in thêm dealer, đóng bớt bàn |

Khuyến nghị trong alert:
- Số dealer đang checked_in nhưng chưa available (đang break, pre_assigned)
- Số bàn có thể đóng để giải phóng dealer
- Dự đoán thời gian hồi phục pool

---

## 7. Frontend (DealerSwingTab.tsx + Hooks)

### 7.1 Layout 3 Cột

```
┌──────────────┬────────────────────────┬──────────────┐
│    25%       │         50%            │     25%      │
│ RosterPanel  │      TableGrid         │ CommandCenter│
│              │                        │              │
│ Available    │ ┌──────┐ ┌──────┐      │ Auto-Swing   │
│ Assigned     │ │Bàn 1 │ │Bàn 2 │ ...  │ Toggle       │
│ On Break     │ │5:12  │ │2:30  │      │              │
│ Pre-Assigned │ │ NLH  │ │ PLO  │      │ Mass Assign  │
│              │ └──────┘ └──────┘      │              │
│ Check-in/out │                        │ Force Swing  │
│ Fatigue Dots │ TimerCell (1s tick)   │ All          │
│              │ Color: green/amber/red │              │
│              │     theo warn/crit     │ Config Panel │
│              │                        │              │
└──────────────┴────────────────────────┴──────────────┘
```

### 7.2 Supabase Realtime + Polling Fallback

- **Primary**: Supabase Realtime (`postgres_changes` trên `dealer_assignments`, `dealer_attendance`, `game_tables`)
- **Fallback**: Polling mỗi 60 giây nếu Realtime disconnect
- **Subscription filter**: `club_id` để chỉ nhận event của club hiện tại

### 7.3 14 Hooks từ useDealerSwing.ts

| # | Hook | Data Source | Refresh |
|---|------|-------------|---------|
| 1 | `useCheckedInDealers` | dealer_attendance + dealers | Realtime + 30s |
| 2 | `useActiveTables` | game_tables | Realtime |
| 3 | `useAvailableTables` | game_tables (inactive, no shift) | Realtime |
| 4 | `useActiveAssignments` | dealer_assignments + joins | Realtime + 30s |
| 5 | `useSwingConfigs` | swing_config | On mount |
| 6 | `useTableOverrides` | swing_configs | On mount |
| 7 | `useTournaments` | tournaments | On mount |
| 8 | `useSwingMetrics` | swing_metrics (today) | 60s |
| 9 | `useBreakPolicies` | shift_break_policies | On mount |
| 10 | `useSpecialDates` | special_dates | On mount |
| 11 | `useAuditLogs` | audit_logs (limit 20) | 30s |
| 12 | `usePoolSummary` | dealer_pool_summary (latest) | 30s |
| 13 | `useTourFilter` | local state | — |
| 14 | `useAnimationTracker` | local state (optimistic updates) | — |

### 7.4 Key UI Features

- **TimerCell**: Đếm ngược 1 giây/lần từ `swing_due_at`. Màu sắc:
  - Xanh lá: > `warn_at_minutes`
  - Vàng: giữa `warn_at_minutes` và `crit_at_minutes`
  - Đỏ: < `crit_at_minutes`
  - Đỏ nhấp nháy: đã quá hạn (OT)

- **FatigueDot**: Chấm tròn bên cạnh tên dealer:
  - Đỏ: `priority_break_flag = true`
  - Cam: `worked_minutes >= max_work * 0.8`
  - Xanh: bình thường

- **Optimistic Checkout Count**: Khi user bấm checkout, UI cập nhật ngay (không chờ server), rollback nếu lỗi

- **Animation Tracking**: Theo dõi dealer vừa được swing (highlight 3 giây)

- **Tour Filter Bar**: Lọc bàn theo tour (Tour Sáng, Tour Chiều, Tour Tối). Mặc định hiển thị tất cả.

- **Assignment Modal**: Khi click vào ô bàn trống → mở modal với:
  - Danh sách dealer available (sắp xếp theo score)
  - Top 3 suggestions (từ `assign-dealer` edge function)
  - Nút "Gán ngay" + "Xem thêm"

### 7.5 Command Center Actions

| Action | Edge Function | Mô tả |
|--------|---------------|-------|
| Auto-Swing Toggle | (local) | Bật/tắt cron job |
| Mass Assign | mass-assign | Fill tất cả bàn trống |
| Force Swing All | process-swing (force_all) | Swing tất cả bàn ngay lập tức |
| Close Table | close-table | Đóng bàn + release dealer |
| Manual Assign | assign-dealer | Gán dealer cụ thể vào bàn |
| Config Dialog | (local → DB) | Sửa swing_config, break policies |
| Refresh Pool | (local) | Force refresh dữ liệu |

---

## 8. Data Flow — Luồng Dữ Liệu

### 8.1 Tổng quan Flow

```
pg_cron (~60s) → process-swing edge function
  │
  ├─ fetchAllClubConfigs()
  │   └─ Lấy club_settings, swing_config, tournaments, shift_break_policies
  │
  ├─ FOR EACH club:
  │   │
  │   ├─ PASS 0: get_dealer_pool_snapshot → calculateBatchSwingDuration
  │   ├─ PASS 0b: Đếm available dealers cho break guard
  │   ├─ PASS 0c: detect_stuck_breaks + tự sửa
  │   │
  │   ├─ PASS 1: fillEmptyTables()
  │   │   └─ pickNextDealer() → INSERT assignments → update states
  │   │
  │   ├─ PASS 1b: Clean stale pre_assign records (>20min)
  │   ├─ PASS 1c: Release orphaned pre_assigned (no table)
  │   │
  │   ├─ PASS 2: pass2PreAssignNext()
  │   │   └─ pickNextDealer() → pre_assign_next_dealer_for_table RPC
  │   │   └─ Update state → pre_assigned
  │   │
  │   ├─ PASS 2.5: pass25InitialAssign()
  │   │   └─ fill_dealer_id RPC (fix NULL dealer)
  │   │
  │   ├─ PASS 3: Execute swings
  │   │   ├─ computeSwingDuration → computeNextSwingAt
  │   │   ├─ IF pre_assigned: execute_pre_assigned_swing RPC
  │   │   │   └─ race_lost? → fallback
  │   │   └─ ELSE: pickNextDealer(L1→L2→L3) → perform_swing RPC
  │   │       └─ evaluateBreakNeed → create break?
  │   │
  │   ├─ PASS 4: end_expired_breaks RPC
  │   └─ PASS 4b: refresh_dealer_pool_summary RPC
  │
  └─ Write swing_metrics + flush Telegram queue
```

### 8.2 Mutation Flow (1 lần swing)

```
1. [Edge Function] computeSwingDuration(table, club, tournament)
2. [Edge Function] pickNextDealer(club, table, excludeList)
3. [Edge Function → RPC] perform_swing(old_assignment_id, old_version, new_dealer_id, ...)
     │
     ├─ [SQL] SELECT ... WHERE version = p_old_version FOR UPDATE SKIP LOCKED
     ├─ [SQL] UPDATE old assignment: status=completed, released_at=now(), swing_processed_at=now()
     ├─ [SQL] UPDATE old dealer: current_state='available' (hoặc 'on_break')
     ├─ [SQL] INSERT break record (nếu cần)
     ├─ [SQL] INSERT new assignment: status=assigned, assigned_at=now()
     ├─ [SQL] UPDATE new dealer: current_state='assigned'
     ├─ [SQL] INSERT swing_audit_logs
     └─ [Trigger] bump_dealer_assignment_version → new.version = old.version + 1

4. [Edge Function] Telegram notification
5. [Edge Function] Realtime broadcast
6. [Edge Function] swing_metrics update
```

### 8.3 Read Flow (UI mount)

```
DealerSwingTab mount
  │
  ├─ useCheckedInDealers → SELECT dealer_attendance JOIN dealers
  ├─ useActiveTables → SELECT game_tables WHERE status='active'
  ├─ useActiveAssignments → SELECT dealer_assignments JOIN attendance JOIN dealers JOIN tables
  ├─ useSwingConfigs → SELECT swing_config
  ├─ useTableOverrides → SELECT swing_configs
  ├─ useTournaments → SELECT tournaments
  ├─ useSwingMetrics → SELECT swing_metrics WHERE date = today
  ├─ useBreakPolicies → SELECT shift_break_policies
  ├─ usePoolSummary → SELECT dealer_pool_summary ORDER BY timestamp DESC LIMIT 1
  │
  └─ Realtime subscription
      ├─ dealer_assignments: INSERT/UPDATE/DELETE
      ├─ dealer_attendance: UPDATE
      └─ game_tables: UPDATE
```

---

## 9. Key RPCs — Stored Procedures

### Swing Execution RPCs

| RPC | Mục đích | CAS/ Lock | Ghi chú |
|-----|----------|-----------|---------|
| `perform_swing` | Thực thi swing chính | version CAS + FOR UPDATE SKIP LOCKED | Release old, assign new, create break, audit log |
| `execute_pre_assigned_swing` | Swing cho dealer đã pre-assign | version CAS + verify pre_assigned state | Nhẹ hơn perform_swing, không cần pickNextDealer |
| `assign_dealer_to_table` | Gán dealer vào bàn (initial) | FOR UPDATE SKIP LOCKED | Dùng khi fill bàn trống hoặc manual assign |
| `fill_dealer_id` | Sửa assignment có dealer_id=NULL | Không lock | Fix data integrity, join attendance→dealer |

### Dealer State RPCs

| RPC | Mục đích | Ghi chú |
|-----|----------|---------|
| `transition_dealer_state` | State machine chuyển trạng thái dealer | available↔assigned↔on_break↔pre_assigned↔checked_out |
| `detect_stuck_breaks` | Tìm break quá hạn | Trả về danh sách break cần force-end |
| `end_expired_breaks` | Force-end break quá hạn | Reset state về available |
| `end_dealer_break` | Kết thúc break cụ thể | Set break_end, reset worked_minutes |
| `pre_assign_next_dealer_for_table` | Pre-assign dealer cho bàn | CAS trên pre_assigned_attendance_id |

### Pool & Monitoring RPCs

| RPC | Mục đích | Ghi chú |
|-----|----------|---------|
| `get_dealer_pool_snapshot` | Snapshot pool stats | Đếm available, assigned, on_break, pre_assigned |
| `refresh_dealer_pool_summary` | Cập nhật bảng pool_summary | Dùng cho dashboard monitoring |
| `auto_close_low_priority_tables` | Đóng bàn LOW khi thiếu dealer | Trigger khi shortage > 50% |
| `club_local_date` | Lấy ngày local theo timezone club | Dùng cho attendance, payroll |
| `get_table_assignments_with_next` | UI predictions | Dự đoán dealer sẽ swing tiếp theo |
| `get_dealer_payroll` | Tính lương dealer | Dựa trên worked_minutes, special_dates, multiplier |

### Duration Calculation

| RPC | Mục đích |
|-----|----------|
| `calculate_dynamic_swing_duration` | SQL-level duration: table override > tournament > club > default |

---

## 10. Config Tables — Bảng Cấu Hình

### 10.1 swing_config — Cấu Hình Swing Per Club

| Column | Type | Default | Mô tả |
|--------|------|---------|-------|
| `id` | UUID PK | auto | |
| `club_id` | UUID FK | | Liên kết club |
| `table_type` | TEXT | 'tournament' | Loại bàn áp dụng |
| `swing_duration_minutes` | INT | 45 | Thời gian mỗi dealer ngồi 1 bàn |
| `break_duration_minutes` | INT | 15 | Thời gian nghỉ mặc định |
| `warn_at_minutes` | INT | 10 | Ngưỡng cảnh báo (vàng) |
| `crit_at_minutes` | INT | 3 | Ngưỡng nguy cấp (đỏ) |
| `tournament_mode` | BOOLEAN | false | Bật sync-swing mode |
| `break_return_policy` | TEXT | 'new_table' | 'same_table' hoặc 'new_table' |
| `pre_announce_minutes` | INT | 6 | Thời gian pre-announce trước swing |
| `auto_swing_enabled` | BOOLEAN | false | Bật/tắt auto-swing |

### 10.2 swing_configs — Table-Level Overrides

| Column | Type | Mô tả |
|--------|------|-------|
| `id` | UUID PK | |
| `table_id` | UUID FK | Bàn cụ thể |
| `swing_duration_minutes` | INT nullable | Ghi đè duration cho bàn này |
| `break_duration_minutes` | INT nullable | Ghi đè break duration |
| `tournament_mode` | BOOLEAN nullable | Ghi đè tournament mode |

**Priority**: swing_configs (table) > tournaments > swing_config (club) > default

### 10.3 club_settings — Cấu Hình Club

| Column | Type | Mô tả |
|--------|------|-------|
| `id` | UUID PK | |
| `club_id` | UUID FK | |
| `auto_swing_enabled` | BOOLEAN | Bật/tắt auto-swing toàn club |
| `break_balance_enabled` | BOOLEAN | Bật/tắt enforce break balance |
| `shortage_auto_close` | BOOLEAN | Tự động đóng bàn khi thiếu dealer |
| `shortage_threshold_percent` | INT | Ngưỡng % để trigger auto-close |
| `shortage_min_no_dealer` | INT | Số bàn thiếu tối thiểu để trigger |
| `telegram_chat_id` | TEXT | Chat ID của group Telegram |
| `telegram_bot_token` | TEXT (encrypted) | Bot token |

### 10.4 tournaments — Cấu Hình Tournament

| Column | Type | Mô tả |
|--------|------|-------|
| `id` | UUID PK | |
| `club_id` | UUID FK | |
| `tour_name` | TEXT | Tên tournament |
| `swing_duration_minutes` | INT nullable | Duration cho tournament này |
| `break_duration_minutes` | INT nullable | Break duration |
| `tour_tier` | TEXT | HIGH / MEDIUM / LOW |
| `status` | TEXT | active / inactive |

### 10.5 shift_break_policies — Chính Sách Break Theo Ca

| Column | Type | Mô tả |
|--------|------|-------|
| `id` | UUID PK | |
| `shift_id` | UUID FK | Ca làm việc |
| `min_work_before_break` | INT | Thời gian tối thiểu trước khi được break (phút) |
| `max_work_before_mandatory_break` | INT | Giới hạn bắt buộc phải break (phút) |
| `break_duration_minutes` | INT | Thời gian break |
| `balance_deficit_threshold` | INT | Ngưỡng deficit để trigger balance break |

### 10.6 special_dates — Ngày Đặc Biệt

| Column | Type | Mô tả |
|--------|------|-------|
| `id` | UUID PK | |
| `club_id` | UUID FK | |
| `date` | DATE | Ngày đặc biệt |
| `multiplier` | DECIMAL | Hệ số nhân lương (VD: 2.0 = x2) |
| `label` | TEXT | Nhãn (VD: "Tết Nguyên Đán") |

---

## Phụ lục — File Map

| File | Vai trò |
|------|---------|
| `supabase/functions/process-swing/index.ts` | Edge function orchestrator (~447 dòng) |
| `supabase/functions/_shared/dealer-utils.ts` | pickNextDealer, fillEmptyTables, evaluateBreakNeed |
| `supabase/functions/_shared/telegram.ts` | Telegram formatting + sending utilities |
| `supabase/functions/mass-assign/index.ts` | Mass assign edge function |
| `supabase/functions/assign-dealer/index.ts` | Manual assign + suggestions |
| `supabase/functions/manage-break/index.ts` | Break management |
| `supabase/functions/enforce-break-balance/index.ts` | Break enforcement cron |
| `supabase/functions/close-table/index.ts` | Close table handler |
| `supabase/migrations/` | Tất cả migration SQL (DDL, RPC, triggers) |
| `src/hooks/useDealerSwing.ts` | 14 React Query hooks |
| `src/components/DealerSwingTab.tsx` | Component chính (1761 dòng) |
| `src/components/TimerCell.tsx` | Ô đếm ngược swing timer |
| `src/components/FatigueDot.tsx` | Chấm báo mệt mỏi |
| `src/components/RosterPanel.tsx` | Panel danh sách dealer |
| `src/components/TableGrid.tsx` | Lưới bàn |
| `src/components/CommandCenter.tsx` | Panel điều khiển |
| `src/components/AssignmentModal.tsx` | Modal gán dealer |
| `src/components/SwingConfigDialog.tsx` | Dialog cấu hình swing |
