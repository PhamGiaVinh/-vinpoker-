# Dealer Swing — Architecture Reference (12-Hour MVP)

> **Scope**: Tài liệu này là bản tóm tắt thực tế cho MVP nội bộ.
> Xem thêm chi tiết kỹ thuật đầy đủ tại [`swing-progress-flow.md`](./swing-progress-flow.md).

---

## 1. Mục đích hệ thống

Dealer Swing tự động hóa việc luân chuyển dealer giữa các bàn poker:
- Cron chạy mỗi 30 giây, gọi `process-swing` edge function.
- Mỗi lần chạy: lock club → chạy các pass theo thứ tự → giải lock.
- Pass 2 đặt trước dealer (pre-assign) ~5 phút trước giờ swing.
- Pass 3 thực thi swing tại T-0 (hoặc khi `swing_due_at` đã qua).
- Kết quả được push lên Telegram group của club.

---

## 2. Các file chính

| File | Vai trò |
|------|---------|
| `supabase/functions/process-swing/index.ts` | Main orchestrator — toàn bộ pass logic (~3,300+ dòng) |
| `supabase/functions/process-swing/passes/pass2-pre-assign.ts` | Pass 2: tìm dealer kế tiếp, gọi CAS RPC, gửi Telegram pre-announce |
| `supabase/functions/process-swing/passes/pass3-post-swing-assign.ts` | Post-swing: đặt trước dealer cho swing tiếp theo ngay sau khi swing xong |
| `supabase/functions/_shared/pickNextDealer.ts` | Core dealer selection (ưu tiên, tier, rest time, exclusions) |
| `supabase/functions/_shared/preAssignState.ts` | `derivePreAssignStatus()`, `ZOMBIE_LOCK_WINDOW_MS`, `sortPass3Candidates()` |
| `supabase/functions/_shared/preAssignTelegram.ts` | Format + gửi Telegram pre-announce (với fallback queue) |
| `supabase/functions/_shared/telegram.ts` | `sendTelegramNotification()`, `getClubTelegramChatId()` |
| `src/components/cashier/DealerSwingTab.tsx` | UI chính (~3,400+ dòng) — quản lý swing thủ công, hiển thị trạng thái |
| `src/hooks/useDealerSwing.ts` | React hooks: queries, realtime subscriptions, pre-assign map |
| `src/lib/dealerSwingState.ts` | Client-side: `derivePreAssignStatus()`, `getPreAssignStatusLabel()` |

---

## 3. Các bảng chính

| Bảng | Vai trò |
|------|---------|
| `dealer_assignments` | Mỗi row = 1 assignment đang active; có `status`, `swing_due_at`, `pre_assigned_attendance_id`, `version` (CAS), `swing_in_progress` |
| `dealer_attendance` | Trạng thái hiện tại của dealer trong ca; có `current_state`, `status` |
| `game_tables` | Danh sách bàn; join vào `dealer_assignments` |
| `club_settings` | Cấu hình per-club: `telegram_chat_id`, `pre_announce_minutes`, `swing_duration_minutes` |
| `pre_announce_jobs` | Fallback queue: gửi lại Telegram nếu direct send thất bại |
| `diagnostic_logs` | Structured event log cho swing system (`club_id`, `diagnostic_type`, `result`) |
| `swing_escalation_config` | Ngưỡng force-release, tier thresholds |

---

## 4. Trạng thái dealer (`dealer_attendance.current_state`)

```
available → pre_assigned → assigned → on_break → available
                                    ↘ checked_out
```

| State | Ý nghĩa |
|-------|---------|
| `available` | Sẵn sàng nhận bàn |
| `pre_assigned` | Đã được đặt trước cho bàn cụ thể, chờ vào |
| `assigned` | Đang làm việc tại bàn |
| `on_break` | Đang nghỉ |
| `checked_out` | Đã kết thúc ca |

---

## 5. Trạng thái assignment (`dealer_assignments.status`)

| Status | Ý nghĩa |
|--------|---------|
| `assigned` | Assignment đang active |
| `completed` | Swing đã hoàn thành (outgoing released) |
| `released` | Released thủ công hoặc force-released |

Các field quan trọng:
- `swing_in_progress` (bool): optimistic lock, ngăn 2 tick xử lý cùng assignment
- `pre_assigned_attendance_id`: FK trỏ tới `dealer_attendance.id` của incoming dealer
- `version` (int): CAS version — tăng sau mỗi update; dùng trong `execute_pre_assigned_swing_rpc`

---

## 6. Tóm tắt các Pass trong `process-swing`

| Pass | Tên ngắn | Chức năng |
|------|----------|-----------|
| 0a | Lock | Acquire club-level lock |
| 0b | Available Count | Đếm dealer available (break deadlock guard) |
| 0c | Stuck Cleanup | Auto-fix stuck pre_assigned / broken break / orphan |
| 0d | Reconcile | Đồng bộ attendance ↔ assignments |
| 0e | Meal Break | Kết thúc meal break quá hạn |
| 1 | Fill Empty | Gán dealer cho bàn trống |
| 1b | Stale Circuit | 3-tier circuit breaker cho stale pre-assign |
| 1c | Orphan Release | Giải phóng pre_assigned không có assignment |
| 1.5 | Rotation | Greedy batch pre-assign planner (feature-flagged) |
| 2 | Pre-assign | Đặt trước dealer kế tiếp (CAS + Telegram pre-announce) |
| 2.5 | Initial Assign | Gán dealer cho assignment `dealer_id=NULL` |
| 3 | Execute Swing | Thực thi swing — pre-assigned path + normal path |
| 4 | End Breaks | Kết thúc break đã hết hạn |
| 4b | Refresh Pool | Refresh materialized view |

---

## 7. Luồng pre-assigned dealer

```
Pass 2 (T-5 min):
  pickNextDealer()
    → pre_assign_next_dealer_for_table RPC (CAS)
      → dealer.current_state: available → pre_assigned
      → assignment.pre_assigned_attendance_id = dealer.attendance_id
    → Telegram: "📋 Tiếp theo Bàn X: A ra, B vào (HH:MM, còn N phút)"
    → fallback: enqueue pre_announce_jobs nếu direct send thất bại

Pass 3 (T-0):
  [Guard Patch 4] preflightAtt.current_state === "available" → skip, log, continue
  preflightInvalid check (checked_out / on_break) → log diagnostic, vẫn gọi RPC
  execute_pre_assigned_swing_rpc (CAS)
    case "success":
      → refresh snapshot confirm
      → Telegram: "🔵 B vừa vào bàn X\nThay thế: A"  ← Patch 2
      → log [pass3][execute-success]                  ← Patch 3
      → postSwingPreAssign (đặt trước cho swing tiếp)
      → break_start event nếu outgoing cần nghỉ
    case "race_lost":
      → no-show detection → fallback perform_swing hoặc OT
    default:
      → log [pass3][execute-failed], metrics.failed++
```

---

## 8. Luồng Telegram notification

| Sự kiện | Message | Gửi ở đâu |
|---------|---------|-----------|
| Pre-announce (Pass 2) | `📋 Tiếp theo Bàn X: A ra, B vào (HH:MM, còn N phút)` | `pass2-pre-assign.ts` → `sendPreAssignTelegramWithFallback()` |
| Pre-assign confirmed (Patch 2) | `🔵 B vừa vào bàn X\nThay thế: A` | `index.ts` success branch, fire-and-forget `.catch()` |
| Normal swing | `🔵 B vào bàn X - Thay A` | `index.ts` perform_swing path |
| Break start | batch via `TelegramNotifier` (800ms flush) | `index.ts` break_start enqueue |
| Overtime | `⏱ Bàn X — Dealer OT ...` | `index.ts` no_dealer path |

Tất cả Telegram call đều **fire-and-forget** hoặc dùng `.catch()` — Telegram failure **không bao giờ làm fail swing**.

---

## 9. Các fix đã implement (MVP)

### Patch 1 — Realtime pre-assigned dealer display (`DealerSwingTab.tsx`)
- **Bug**: `TableGrid` dùng prediction RPC (`pred`) thay vì realtime `preAssignedMap` cho "Tiếp:" block.
- **Fix**: Ưu tiên `preAssignedMap[t.id]` (realtime FK join) trước, fallback `pred` nếu không có.
- **Cũng fix**: Empty-table card nay hiển thị status label (`Đang chuyển` / `Quá hạn`).

### Patch 2 — Telegram confirmation sau execute success (`index.ts`)
- **Gap**: Pre-assigned path không gửi Telegram khi swing thật sự xảy ra (chỉ có pre-announce).
- **Fix**: Sau khi refresh guard pass, gửi `🔵 B vừa vào bàn X\nThay thế: A`. Fire-and-forget.

### Patch 3 — Structured logs Pass 2 / Pass 3 (`index.ts`, `pass2-pre-assign.ts`)
- Tags: `[pass2][preassign-created]`, `[pass2][preassign-skipped]`, `[pass2][telegram-preannounce-sent/queued/failed]`
- Tags: `[pass3][execute-success]`, `[pass3][execute-failed]`, `[pass3][telegram-confirmation-dispatched/failed]`

### Patch 4 — Stale pre-assign guard (`index.ts`)
- **Gap**: Nếu incoming dealer đã bị release về `available` trước khi Pass 3 chạy, RPC vẫn được gọi (trả về `race_lost` mà không trigger fallback).
- **Fix**: Guard `preflightAtt?.current_state === "available"` → skip, log `[guard-stale-preassign]`, `metrics.skipped++`, `continue`.

---

## 10. Các rủi ro còn lại (chưa fix trong MVP)

| Rủi ro | Mô tả | Mức độ |
|--------|-------|--------|
| Zombie `swing_in_progress` | Lock bị stuck nếu function crash giữa chừng. `ZOMBIE_LOCK_WINDOW_MS=2min` có reclaim logic nhưng không phải transaction-safe. | Medium |
| TOCTOU race | Khoảng thời gian giữa preflight check và RPC call — dealer có thể đổi state. CAS version giảm thiểu nhưng không loại bỏ hoàn toàn. | Low-Medium |
| Stale cleanup limits | Pass 1b circuit breaker chỉ xử lý tối đa N rows/tick. Club có nhiều bàn OT lâu có thể bị lag. | Low |
| Break deadlock | Nếu tất cả dealer đang nghỉ cùng lúc, Pass 0b phát hiện nhưng chỉ log — không tự resolve. Cần intervention thủ công. | Medium |
| `cycleExcludedIds` in-memory | Set này chỉ tồn tại trong 1 tick. Nếu 2 Deno invocation chạy song song (edge case), không có cross-process guard. Club lock giảm thiểu nhưng không đảm bảo 100%. | Low |

---

## 11. Danh sách KHÔNG được thay đổi

Các thành phần sau **không được sửa** trong MVP — rủi ro cao, cần test kỹ trước:

```
supabase/migrations/          — không edit migration cũ
execute_pre_assigned_swing_rpc — không đổi RPC signature
pre_assign_next_dealer_for_table — không đổi RPC signature
perform_swing                 — không đổi RPC signature
pickNextDealer()              — không refactor
Pass 0a–0e                    — không touch các pass cleanup
Pass 1b stale circuit breaker — đang ổn định, không cần thay đổi
TelegramNotifier batch system — không refactor
```

---

## 12. Đề xuất các patch tiếp theo (sau MVP)

| Priority | Đề xuất | Lý do |
|----------|---------|-------|
| High | E2E test cho pre-assigned swing flow | Hiện chưa có test coverage cho path quan trọng nhất |
| High | Atomic zombie lock reclaim trong DB transaction | Hiện reclaim là optimistic, không transaction-safe |
| Medium | Cấu hình `ZOMBIE_LOCK_WINDOW_MS` per-club qua `club_settings` | Hiện hardcode 2 phút |
| Medium | UI alert khi tất cả dealer on break (break deadlock) | Cashier hiện không biết khi nào hệ thống bị deadlock |
| Medium | `pre_announce_jobs` retry monitor | Queue có thể tích lũy nếu Telegram down lâu |
| Low | Tách `DealerSwingTab.tsx` thành sub-components | 3,400+ dòng, khó debug khi có regression |
| Low | Structured logs → Supabase Logs dashboard query | Hiện logs chỉ có trong Deno console |
