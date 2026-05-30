# Overtime Swing System — 15 bàn, 15 dealer, xoay vòng

## TL;DR
> **Summary**: Khi pool rỗng (15 dealer / 15 bàn), swing 45' không có người thay → dealer OT → `overtime_started_at` ghi nhận → Pass 3 retry mỗi tick với backoff 55s → khi có dealer mới hoặc bàn đóng → swing xảy ra → OT dealer nghỉ bù (compensatory break). Vòng xoay tự nhiên.
> **Effort**: Small (~3-4 giờ)
> **Files**: 1 migration (add columns + update RPC) + process-swing + enforceBreakBalance

## Vấn đề

**Hiện tại** — `perform_swing` RPC khi `p_next_attendance_id IS NULL`:
```sql
IF v_retry_count >= 3 THEN
    -- BỎ CUỘC: swing_skipped, không retry nữa
END IF;
-- Retry 90s, tối đa 3 lần
```
→ Dealer không bao giờ được nghỉ, không có tracking.

**Yêu cầu**: Dealer OT tracking + xoay vòng khi có người thay.

## Flow OT

```
swing_due_at đến hạn, pool rỗng
│
├─ 🔴 perform_swing(next=NULL) → 'no_dealer' + overtime_started = true
│   → overtime_started_at = NOW()                  (chỉ lần đầu)
│   → priority_break_flag = true (attendance)      (chỉ lần đầu)
│   → is_new_overtime = true                       (chỉ lần đầu)
│   → swing_due_at = NOW() + 55s                   (backoff = cron 60s)
│   → swing_processed_at = NULL                    (giữ nguyên)
│
├─ 🔄 Pass 3 retry mỗi tick (~60s):
│   → pickNextDealer → null (vẫn rỗng)
│   → perform_swing → 'no_dealer'
│   → is_new_overtime = false (bỏ qua alert)
│
├─ 🆕 Dealer mới check-in / Bàn đóng:
│   → available pool có 1 dealer
│   → pickNextDealer → trả về dealer mới (score cao)
│   → OT dealer → forced shouldBreak = true
│   → perform_swing(next=dealer_mới) → 'swung'
│   → OT dealer → on_break với compensatory break
│   → dealer mới → assigned (bàn OT nhất)
│
└─ ☕ OT dealer nghỉ bù → available → pick cho bàn OT tiếp theo → XOAY VÒNG
```

## Files & Logic

### File 1: Migration — Columns + RPC update

```sql
ALTER TABLE dealer_assignments 
  ADD COLUMN IF NOT EXISTS overtime_started_at TIMESTAMPTZ;

ALTER TABLE dealer_attendance
  ADD COLUMN IF NOT EXISTS overtime_minutes INTEGER DEFAULT 0;
```

**perform_swing RPC — sửa 2 đoạn:**

**Đoạn 1: Pool rỗng** (thay thế retry logic cũ):
```sql
IF p_next_attendance_id IS NULL THEN
    -- Kiểm tra OT mới hay đã có
    v_is_new_ot := (SELECT overtime_started_at IS NULL 
                    FROM dealer_assignments 
                    WHERE id = p_assignment_id);
    
    UPDATE dealer_assignments
    SET overtime_started_at = COALESCE(overtime_started_at, v_now),
        swing_retry_count = 0,
        last_swing_attempted_at = v_now,
        swing_due_at = v_now + INTERVAL '55 seconds',  -- backoff = cron interval
        version = version + 1
    WHERE id = p_assignment_id;
    
    -- Đánh dấu dealer cần break (OT dealer bị deprioritize)
    UPDATE dealer_attendance
    SET priority_break_flag = true
    WHERE id = v_old_attendance_id;
    
    RETURN jsonb_build_object(
      'outcome', 'no_dealer',
      'overtime_started', true,
      'is_new_overtime', v_is_new_ot
    );
END IF;
```

**Đoạn 2: Khi swing cuối cùng xảy ra** (có `p_next_attendance_id`):
```sql
-- Trước khi set old dealer to break:
DECLARE
  v_ot_started_at TIMESTAMPTZ;
  v_ot_minutes INT;
  v_comp_break INT;
BEGIN
  -- Lấy overtime_started_at từ assignment
  SELECT overtime_started_at INTO v_ot_started_at
  FROM dealer_assignments WHERE id = p_assignment_id;
  
  IF v_ot_started_at IS NOT NULL THEN
    -- Tính OT minutes từ overtime_started_at đến NOW()
    v_ot_minutes := EXTRACT(EPOCH FROM (v_now - v_ot_started_at)) / 60;
    
    -- Compensatory break: standard + floor(OT * 0.5), capped at 60
    v_comp_break := LEAST(p_break_duration_minutes + FLOOR(v_ot_minutes * 0.5), 60);
    
    -- Xóa OT tracking trên assignment
    UPDATE dealer_assignments SET overtime_started_at = NULL
    WHERE id = p_assignment_id;
    
    -- Accumulate OT minutes vào attendance (không ghi đè)
    UPDATE dealer_attendance 
    SET overtime_minutes = COALESCE(overtime_minutes, 0) + v_ot_minutes,
        priority_break_flag = false
    WHERE id = v_old_attendance_id;
    
    -- Dùng v_comp_break thay vì p_break_duration_minutes
    -- (code INSERT dealer_breaks với v_comp_break)
  ELSE
    v_comp_break := p_break_duration_minutes;  -- standard break
  END IF;
  
  -- Sau đó, code break cũ dùng v_comp_break
END;
```

### File 2: `process-swing/index.ts` — 3 sửa

**Sửa 1 — Select thêm `overtime_started_at`** (line 376-384):
```typescript
.select(
  `id, table_id, attendance_id, swing_due_at, version,
   pre_assigned_attendance_id, overtime_started_at,   -- ← THÊM
   game_tables(club_id, table_name, table_type),
   dealer_attendance!attendance_id(dealers(full_name, ...))`
)
```

**Sửa 2 — Force shouldBreak = true cho OT dealer** (trước call perform_swing, non-pre-assigned path, ~line 484-495):
```typescript
// Check xem dealer hiện tại có đang OT không
const isOtDealer = !!(assignment as any).overtime_started_at;

const breakDecision = isOtDealer
  ? { shouldBreak: true, reason: "mandatory" as const, workedMinutes: 999 }
  : await evaluateBreakNeed(admin, assignment.attendance_id, {
      maxWorkMinutes: swingDurResult.durationMinutes * 3,
      minWorkMinutes: swingDurResult.durationMinutes * 2,
      clubId: cid,
    });

// Pass breakDecision vào perform_swing như hiện tại
const { data: swingResult } = await admin.rpc("perform_swing", {
  p_send_to_break: breakDecision.shouldBreak,  // OT dealer = true forced
  ...
});
```

**Sửa 3 — Xử lý outcome OT** (line 512-514):
```typescript
} else if (outcome === "no_dealer") {
    metrics.no_dealer++;
    if (swingResult?.is_new_overtime) {
      // Chỉ gửi alert 1 lần khi OT bắt đầu
      const chatId = await getClubTelegramChatId(admin, cid);
      if (botToken && chatId) {
        await sendTelegramNotification(botToken, chatId,
          `⏱ *Bàn ${tableName}* — Dealer ${outgoingDealer.full_name} đang làm thêm do không có người thay. Sẽ xoay vòng khi có dealer mới!`,
          {}
        );
      }
    }
    batchResults.push({ tableName, outgoingDealer, incomingDealer: null, minutesLeft: minsLeft });
}
```

**Sửa 4 — Alert toàn bộ OT** (sau Pass 3 loop, ~line 528):
```typescript
// After Pass 3 loop — alert nếu toàn bộ bàn đều OT
const allOtCount = (dueAssignments ?? []).filter(
  (a: any) => a.overtime_started_at
).length;
if (allOtCount === (dueAssignments ?? []).length && allOtCount > 0) {
  const chatId = await getClubTelegramChatId(admin, cid);
  if (botToken && chatId) {
    await sendTelegramNotification(botToken, chatId,
      `🚨 *TOÀN BỘ ${allOtCount} BÀN ĐANG OT* — Không có dealer available. Cần check-in thêm dealer!`,
      {}
    );
  }
}
```

### File 3: `enforceBreakBalance` — OT tracking display

Thêm logic sau phần break balance (mỗi 5 phút):
```typescript
// ── OT Minute Tracking (display only — ghi đè, không accumulate) ──
const { data: otAssignments } = await admin
  .from("dealer_assignments")
  .select("attendance_id, overtime_started_at, game_tables!inner(club_id, table_name)")
  .not("overtime_started_at", "is", null)
  .eq("status", "assigned")
  .in("game_tables.club_id", clubIds);

const otAlerts: string[] = [];
for (const ass of otAssignments ?? []) {
  const otMinutes = Math.floor(
    (Date.now() - new Date(ass.overtime_started_at).getTime()) / 60000
  );
  
  // Ghi đè current OT duration (display)
  await admin
    .from("dealer_attendance")
    .update({ overtime_minutes: otMinutes })
    .eq("id", ass.attendance_id);
  
  // Alert mỗi 30 phút
  if (otMinutes > 0 && otMinutes % 30 === 0) {
    otAlerts.push(
      `⏰ Bàn ${ass.game_tables?.table_name ?? "?"}: dealer OT ${otMinutes} phút`
    );
  }
}
if (otAlerts.length > 0 && botToken) {
  for (const clubId of clubIds) {
    const chatId = await getClubTelegramChatId(admin, clubId);
    if (chatId) {
      await sendTelegramNotification(botToken, chatId,
        `📊 *Báo cáo OT:*\n` + otAlerts.join('\n'), {}
      );
    }
  }
}
```

## 6 Issues đã fix

| # | Issue | Fix |
|---|-------|-----|
| 🔴 1 | `swing_due_at = NOW() - 1s` tạo infinite loop | `swing_due_at = NOW() + 55s` — backoff đúng cron interval ✅ |
| 🔴 2 | Flag `overtime_started_at_already_set` không tồn tại | Thay bằng `is_new_overtime` boolean trong RPC return ✅ |
| 🔴 3 | Compensatory break không fire nếu `evaluateBreakNeed` false | Force `shouldBreak = true` cho OT dealer khi swing cuối cùng ✅ |
| 🟡 4 | Race condition `overtime_minutes` giữa 2 nguồn ghi | enforceBreakBalance: ghi đè (display). perform_swing: accumulate từ `overtime_started_at` ✅ |
| 🟡 5 | Không có escape valve khi toàn bộ OT | Alert Telegram "TOÀN BỘ N BÀN ĐANG OT" + scope force-break feature thành future ticket ✅ |
| 🟡 6 | Thiếu cap compensatory break | `LEAST(comp_break, 60)` — hard cap 60 phút ✅ |

## pickNextDealer — Giữ nguyên

Logic hiện tại đã đúng cho OT scenario:

```typescript
// Hard exclude: priority_break=true AND workedMin>=100 → không pick
// Penalty -500: priority_break=true (OT dealer score thấp)
// Rest bonus +200: dealer mới check-in (rest_minutes=999)
```

→ Dealer mới luôn được pick trước dealer đang OT.

## Xoay vòng cụ thể

```
15 bàn, 15 dealer, swing 45' bắt đầu
T+45:  OT bắt đầu (15 dealer)
T+60:  Bàn 10 đóng → dealer B10 available
T+61:  B1 (OT lâu nhất) swing → B1 nghỉ bù 22', B10 assigned bàn 1
T+83:  B1 available → swing B2 (OT tiếp) → B2 nghỉ bù 27', B1 assigned bàn 2
T+110: B2 available → swing B3... (xoay vòng)
```

## Implementation Waves

### Wave 1: Migration + RPC (~1h)
- [ ] Tạo migration: add columns + replace `perform_swing` RPC
- [ ] Test: `perform_swing(next=NULL)` → `overtime_started_at` set, `is_new_overtime = true`
- [ ] Test: `perform_swing(next=NULL)` lần 2 → `is_new_overtime = false`
- [ ] Test: `perform_swing(next=dealer)` có OT → compensatory break tính đúng

### Wave 2: process-swing (~1h)
- [ ] Thêm `overtime_started_at` vào Pass 3 select
- [ ] Force `shouldBreak = true` cho OT dealer
- [ ] Telegram alert `is_new_overtime`
- [ ] Alert toàn bộ OT sau loop
- [ ] Deploy + test cron

### Wave 3: enforceBreakBalance (~30m)
- [ ] OT minute display tracking (ghi đè)
- [ ] Alert mỗi 30 phút
- [ ] Deploy + test

### Future (separate ticket)
- [ ] Force-break escape valve: khi toàn bộ OT > X phút, auto-free dealer OT lâu nhất
- [ ] Shift-aware compensatory break cap (min(comp_break, remaining_shift))
- [ ] OT payroll trong `get_shift_payroll_summary`

## Risks

| Risk | Mitigation |
|------|------------|
| 55s backoff không đủ cho cron 60s + processing time | SWING_WINDOW_BUFFER=2 phút → 55s luôn trong window |
| OT dealer bị pick lại ngay sau break (rest_minutes=999) | priority_break_flag đã clear, score bình thường |
| enforceBreakBalance ghi đè overtime_minutes trước khi perform_swing accumulate | performance_swing accumulate từ `overtime_started_at` thay vì đọc column |
| Nhiều bàn OT → nhiều RPC gọi mỗi tick | Mỗi bàn 1 RPC, parallel trong for loop, timeout 60s |
