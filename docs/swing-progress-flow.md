# Swing Progress Flow — Kiến trúc xử lý Swing Dealer

## Tổng quan

Hệ thống xử lý swing dealer theo cron tick (mỗi ~60s). Mỗi tick thực thi các **Pass** theo thứ tự, trên mỗi club.

```
Cron tick → Club loop → [Pass 0c → Pass 1 → Pass 1.5 → Pass 2 → Pass 2.5 → Pass 3 → Pass 4 → Pass 4b]
```

---

## 1. Luồng Pre-Assign (Pass 2)

### Vị trí: `supabase/functions/process-swing/passes/pass2-pre-assign.ts`

**Pass 2** chạy trước để pre-assign dealer cho các bàn sắp đến hạn swing.

```
Cửa sổ pre-assign: [NOW + (preAnnounceMinutes - 2), NOW + (preAnnounceMinutes + 2)]
Ví dụ: preAnnounceMinutes = 3 → cửa sổ [1 phút, 5 phút] từ bây giờ
```

**Luồng xử lý:**
1. Query các bàn có `swing_due_at` trong cửa sổ pre-assign
2. Với mỗi bàn, gọi `pickNextDealer()` để chọn dealer
3. Nếu chọn được → gọi RPC `pre_assign_next_dealer()` để pre-assign
4. RPC này tạo `dealer_assignment` record mới với `pre_assigned_attendance_id` + `pre_announce_sent_at = NULL`
5. Insert `pre_announce_jobs` queue để Telegram gửi pre-announce

**Post-swing pre-assign** (Pass 3.5):
- Sau khi `perform_swing` hoàn tất, gọi `pass3-post-swing-assign.ts`
- Pre-assign ngay dealer tiếp theo cho bàn vừa swing

### Điểm chốt
- **Fail-safe**: Nếu có 2 bàn cùng pre-assign 1 dealer, `pre_assign_next_dealer` RPC có race condition check
- **uq_pre_announce_active**: Partial unique index ngăn duplicate pre-announce jobs

---

## 2. Process Pre-Announce Jobs (Telegram Notification)

### Vị trí: `supabase/functions/process-pre-announce-jobs/index.ts`

**Chạy mỗi 30s**, xử lý `pre_announce_jobs` queue.

```
Cron 30s → Query pending jobs (max 20) → Claim atomic (status=processing)
→ Group by (chat_id, zone) → Gửi Telegram theo nhóm → Update status=sent
```

**Message format:**
```
📋 Tiếp theo [Bàn]: [out] ra, [in] vào (còn X phút)
```

**Guards:**
- Circuit breaker: >10 failures trong 5 phút → skip tick
- Per-job timeout: 5s (AbortController)
- HTTP retries: 3 lần (exponential backoff 200ms, 400ms)
- Tick timeout: 25s (tránh overlap với cron 30s)

---

## 3. Process Swing (Pass 3 — Swing Execution)

### Vị trí: `supabase/functions/process-swing/index.ts`

### 3.1 Pass 3 Query

Query 3 loại assignment cần xử lý:

| Loại | Filter | Ưu tiên |
|---|---|---|
| **Pre-assigned** | `pre_assigned_attendance_id IS NOT NULL` | Cao nhất |
| **Normal due** | `pre_assigned_attendance_id IS NULL` | Trung bình |
| **Zombie lock** | `swing_in_progress = true` quá 2 phút | Thấp |

Tối đa 8 assignments mỗi tick.

### 3.2 Xử lý mỗi assignment

```
For each assignment:
  1. Lock row (FOR UPDATE)
  2. Kiểm tra: table_staging, swing_in_progress
  3. Refresh cache (tránh stale)
  4. If có pre_assigned_attendance_id:
     → execute_pre_assigned_swing RPC (swing ngay)
  5. If không có pre-assign:
     → pickNextDealer() với graduated escalation
```

### 3.3 Graduated Escalation (pickNextDealer)

Khi không có pre-assign, thử pick dealer với các tier:

| Tier | Điều kiện | minRestMinutes | minInterSwingRestMinutes | Skip |
|---|---|---|---|---|
| 0 (Normal) | Luôn thử | `break_duration_minutes` (default 10) | `min_inter_swing_rest_minutes` (default 10) | — |
| 1 | Quá hạn ≥ 5 phút | 5 | (giữ nguyên) | — |
| 2 | Quá hạn ≥ 15 phút | 3 | (giữ nguyên) | priority break guard |
| 3 | Quá hạn ≥ 30 phút | 0 | 0 | fatigue cap |

> **Lưu ý**: `minInterSwingRestMinutes = 0` ở Tier 3 chỉ ảnh hưởng **OR rest cooldown**, không ảnh hưởng **Break pool guard** (guard cứng 10 phút).

### 3.4 Fallback nếu không tìm được dealer

```
No dealer found after all tiers:
→ Force-release stuck assignment RPC
→ Chờ Pass 0c tick tiếp theo
→ Escalate shortage (Telegram cảnh báo)
```

---

## 4. Guards trong pickNextDealer

### Vị trí: `supabase/functions/_shared/pickNextDealer.ts`

Thứ tự guard trong vòng lặp chọn dealer:

```
1. Intra-cycle exclusion (busy dealer IDs, exclude set)
2. Meal break exclusion
3. Break pool guard (hard 10 phút, NOW(), không bypass)
4. Pool cooldown guard (1 phút Telegram buffer, NOW(), không bypass)
5. Emergency pre-assign guard (current_state = 'pre_assigned')
6. On-break minimum rest guard (active break record)
7. High-stakes tier guard (C tier không được vào HIGH)
8. Fatigue hard cap (consecutive ≥ 4 && rest < 10)
9. Priority break + rest guard (break_duration + 5 buffer)
10. Rest cooldown (OR logic: shift rest || inter-swing rest)
11. Game type hard-exclude
12. Scoring → chọn dealer điểm cao nhất
```

### 4.1 Break Pool Guard

```typescript
// Hard wall-clock check, dùng NOW()
// Không bypass được bởi OR logic hay escalation tiers
const guardMinutes = Math.max(minInterSwingRestMinutes, 10);
// Query: attendance có last_released_at > NOW() - guardMinutes
// → hard exclude
if (restGuardExcludedIds.has(row.id)) { diag.break_pool_guard_excluded++; continue; }
```

**Mục đích**: Đảm bảo dealer nghỉ tối thiểu 10 phút giữa 2 swing.

### 4.2 Pool Cooldown Guard

```typescript
// 1 phút buffer cho Telegram kịp gửi pre-assign
// pool_entered_at được set = NOW() khi dealer release hoặc break end
const poolCooldownMinutes = 1;
// Query: attendance có pool_entered_at > (NOW() - 1 phút)
// → hard exclude (dùng chung restGuardExcludedIds)
```

**Kích hoạt**:
- `perform_swing` release dealer → `pool_entered_at = NOW()`
- `execute_pre_assigned_swing` release dealer → `pool_entered_at = NOW()`
- `end_expired_breaks` kết thúc break → `pool_entered_at = NOW()`
- New hire (`pool_entered_at = NULL`) → skip (không cần cooldown)

### 4.3 Rest Cooldown (OR Logic)

```typescript
// Dealer pass nếu 1 trong 2 điều kiện đúng:
// 1. minutes_since_rest >= minRestMinutes (shift fatigue)
// 2. last_released_at >= minInterSwingRestMinutes ago (inter-swing gap)
if (!passedMinutesSinceRest && !passedLastReleased) { /* exclude */ }
```

**Khác biệt với Break Pool Guard:**
- Rest cooldown dùng `swingDueAt` (predictive), không dùng `NOW()`
- Break pool guard dùng `NOW()` (wall clock) — **cứng, không bypass**
- Cả 2 guard đều chạy, dealer bị chặn nếu fail bất kỳ guard nào

---

## 5. Perform Swing RPC

### Vị trí: `supabase/migrations/20260804000000_add_pool_entered_at.sql`

RPC `perform_swing` chịu trách nhiệm hoàn tất 1 swing cycle.

```
Input: p_assignment_id, p_next_attendance_id, p_send_to_break, ...
Output: jsonb { ok, old_attendance_id, new_assignment_id, ... }
```

**Các bước:**
```
[1] Lock assignment row (FOR UPDATE)
[2] Calculate actual worked minutes
[3] Calculate OT minutes
[4] Complete old assignment (status='completed', released_at=NOW())
[5] Update old dealer state → pool_entered_at = NOW()
[5b] If send_to_break → insert dealer_breaks record
[6] Get swing config
[7] Calculate next swing_due_at
[8] Create new assignment for incoming dealer
[9] Update incoming dealer state (current_state='assigned')
[10] Return result
```

**Bước [5] là điểm chốt** — set `pool_entered_at = v_now`:
```sql
UPDATE dealer_attendance
SET current_state = CASE WHEN p_send_to_break THEN 'on_break' ELSE 'available' END,
    last_released_at = v_now,
    pool_entered_at = v_now,     -- ← pool cooldown guard sẽ chặn 1 phút
    ...
WHERE id = v_old_attendance_id;
```

### execute_pre_assigned_swing RPC

Giống `perform_swing` nhưng thêm **rest deficit calculation**:
```sql
-- Nếu incoming dealer vừa break xong, delay swing_due_at
v_rest_deficit_min := GREATEST(0, p_break_duration_minutes - v_swing_duration_min);
```

---

## 6. Flow Diagram

```
                    ┌─────────────────────────────┐
                    │   Cron tick (mỗi ~60s)      │
                    └─────────────┬───────────────┘
                                  │
                    ┌─────────────▼───────────────┐
                    │  Pass 0c: Force-release      │
                    │  stuck assignments           │
                    └─────────────┬───────────────┘
                                  │
                    ┌─────────────▼───────────────┐
                    │  Pass 1: Fill empty tables  │
                    └─────────────┬───────────────┘
                                  │
                    ┌─────────────▼───────────────┐
                    │  Pass 1.5: Rotation planner │
                    └─────────────┬───────────────┘
                                  │
                    ┌─────────────▼───────────────┐
                    │  Pass 2: Pre-assign dealer  │
                    │  + pre_announce_jobs queue  │
                    └─────────────┬───────────────┘
                                  │
                    ┌─────────────▼───────────────┐
                    │  Pass 2.5: Initial assign   │
                    └─────────────┬───────────────┘
                                  │
                    ┌─────────────▼───────────────┐
                    │  Pass 3: Swing execution    │
                    │  (8 assignments / tick)     │
                    └─────────────┬───────────────┘
                                  │
                    ┌─────────────▼───────────────┐
                    │  Pass 4: End expired breaks │
                    │  → set pool_entered_at=NOW()│
                    └─────────────┬───────────────┘
                                  │
                    ┌─────────────▼───────────────┐
                    │  Pass 4b: Dealer pool       │
                    │  summary refresh            │
                    └─────────────────────────────┘
```

### Telegram Timeline

```
0:00  Pass 2 pre-assign + pre_announce_jobs insert
0:30  process-pre-announce-jobs sends Telegram: "📋 Bàn X: A ra, B vào (còn 3 phút)"
0:31  Pool cooldown guard chặn dealer B (pool_entered_at = 0:00)
1:00  Pool cooldown guard hết hiệu lực (quá 1 phút)
X:00  Pass 3 execute swing
      → swing_due_at đến hạn
      → execute_pre_assigned_swing (pre-assigned path)
      → hoặc pickNextDealer (fallback path)
      → perform_swing RPC
      → Telegram: "🔵 B vào bàn X - Thay A"
      → pool_entered_at = NOW() (bắt đầu cooldown mới)
X:01  Break pool guard: 10 phút hard cooldown
X+10  Dealer A có thể được pick lại (nếu break pool guard pass)
```

---

## 7. Database Schema — pool_entered_at

### `dealer_attendance` table

```sql
ALTER TABLE public.dealer_attendance ADD COLUMN pool_entered_at TIMESTAMPTZ;

-- Partial index
CREATE INDEX idx_dealer_attendance_pool_entered
  ON public.dealer_attendance(pool_entered_at)
  WHERE current_state IN ('available', 'on_break');
```

**Backfill**:
```sql
UPDATE dealer_attendance
SET pool_entered_at = last_released_at
WHERE last_released_at IS NOT NULL AND pool_entered_at IS NULL;
```

### Khi nào `pool_entered_at` được set?

| Sự kiện | Set pool_entered_at | Set last_released_at |
|---|---|---|
| `perform_swing` release dealer | `= NOW()` | `= NOW()` |
| `execute_pre_assigned_swing` release | `= NOW()` | `= NOW()` |
| `end_expired_breaks` | `= NOW()` (⚠️ không NULL) | `= NULL` |
| Dealer check-out | Bỏ qua | Bỏ qua |

### Khi nào `last_released_at` được clear?

| Sự kiện | last_released_at | pool_entered_at |
|---|---|---|
| `end_expired_breaks` (break kết thúc) | `= NULL` | `= NOW()` (giữ nguyên) |
| Dealer check-out | `= NULL` | `= NULL` |

---

## 8. Configuration

### `swing_config` table

| Column | Default | Mô tả |
|---|---|---|
| `min_inter_swing_rest_minutes` | 10 | Thời gian nghỉ tối thiểu giữa 2 swing |
| `break_duration_minutes` | 10 | Thời gian break tối thiểu |
| `pre_announce_minutes` | 3 | Số phút trước swing để pre-announce |
| `swing_duration_minutes` | 45 | Thời gian mỗi swing |

### `swing_escalation_config` table

| Column | Default | Mô tả |
|---|---|---|
| `tier_1_min_overdue_min` | 5 | Quá hạn bao nhiêu phút thì kích hoạt Tier 1 |
| `tier_1_min_rest_min` | 5 | minRestMinutes ở Tier 1 |
| `tier_2_min_overdue_min` | 15 | Quá hạn bao nhiêu phút thì kích hoạt Tier 2 |
| `tier_2_min_rest_min` | 3 | minRestMinutes ở Tier 2 |
| `tier_3_min_overdue_min` | 30 | Quá hạn bao nhiêu phút thì kích hoạt Tier 3 |
| `tier_3_min_rest_min` | 0 | minRestMinutes ở Tier 3 |
| `force_release_at_overdue_min` | 30 | Quá hạn bao nhiêu phút thì force-release |

---

## 9. Edge Cases & Race Conditions

### Pool cooldown + break end
```
Dealer break kết thúc lúc 10:30
→ end_expired_breaks set pool_entered_at = 10:30
→ Pool cooldown guard chặn đến 10:31
→ Telegram có 1 phút để gửi pre-assign
```

### Pool cooldown + perform_swing (cùng tick)
```
10:05:00 perform_swing set pool_entered_at = 10:05:00
10:05:02 Pass 2 query với poolCutoff = 10:04:02
         → 10:05:00 > 10:04:02 → dealer bị exclude (safe)
```

### New hire (pool_entered_at = NULL)
```
Dealer mới check-in, chưa từng swing
→ pool_entered_at = NULL
→ .not("pool_entered_at", "is", null) → skip
→ Dealer được pick ngay (không cần pool cooldown)
```

### Break pool guard bypass (hard không bypass)
```
Tier 3 set minInterSwingRestMinutes = 0
→ OR rest cooldown bỏ qua inter-swing check
→ NHƯNG break pool guard vẫn chạy với Math.max(0, 10) = 10 phút
→ Dealer vẫn bị chặn 10 phút
```

---

## 10. Files liên quan

| File | Chức năng |
|---|---|
| `supabase/functions/process-swing/index.ts` | Main process-swing cron (3297 dòng) |
| `supabase/functions/process-swing/passes/pass2-pre-assign.ts` | Pass 2 pre-assign logic (419 dòng) |
| `supabase/functions/process-swing/passes/pass3-post-swing-assign.ts` | Post-swing immediate pre-assign |
| `supabase/functions/_shared/pickNextDealer.ts` | Core pick + guards (896 dòng) |
| `supabase/functions/process-pre-announce-jobs/index.ts` | Telegram pre-announce queue (430 dòng) |
| `supabase/functions/_shared/telegram.ts` | Telegram notification helpers |
| `supabase/migrations/20260804000000_add_pool_entered_at.sql` | Pool cooldown migration |
| `supabase/migrations/20260801000006_min_inter_swing_rest.sql` | Inter-swing rest migration |
