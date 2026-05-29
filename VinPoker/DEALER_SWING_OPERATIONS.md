# Dealer Swing — Vận Hành Gọi Người & Tự Động Thay Thế

> Tài liệu này giải thích chi tiết cách hệ thống gọi dealer, chấm điểm, gửi Telegram, và tự động swing.

---

## 1. Luồng Gọi Người (Assign Dealer)

### 1.1 Khi Nào Gọi Người Mới?

Có **3 thời điểm** gọi dealer mới, tương ứng 3 Pass trong `process-swing`:

```
Pass 1 (mỗi phút) — Fill bàn trống
  Điều kiện: bàn active nhưng chưa có dealer_assignments.status='assigned'
  Gọi: fillEmptyTables() → pickNextDealer() → INSERT + UPDATE current_state='assigned'

Pass 2 (T-6) — Pre-assign dealer thay thế
  Điều kiện: assignment có swing_due_at trong [4 phút tới, 8 phút tới]
  Gọi: pickNextDealer() → UPDATE pre_assigned_attendance_id → SET current_state='pre_assigned'

Pass 3 (T-0) — Thực thi swing
  Điều kiện: swing_due_at <= NOW() + 5 phút
  Gọi: execute_pre_assigned_swing() RPC → release old + activate new
    hoặc: perform_swing() RPC (legacy / fallback)
```

**Luồng đầy đủ cho 1 dealer từ lúc check-in đến lúc được gọi:**

```
check-in → available
              ↓ Pass 1/2
        pickNextDealer() chấm điểm
              ↓
        current_state = 'assigned' (Pass 1)
        current_state = 'pre_assigned' (Pass 2, T-6)
              ↓
        execute_pre_assigned_swing (Pass 3, T-0)
              ↓
        current_state = 'assigned' (vào bàn mới)
```

### 1.2 Code Gọi Dealer (từ process-sign Pass 2)

```typescript
// File: supabase/functions/process-swing/index.ts:147-211
// Pass 2 — Pre-assign: T-6 phút, chọn dealer thay thế

// 1. Query assignments sắp đến giờ swing
const { data: preAssignList } = await admin
  .from("dealer_assignments")
  .select(`
    id, table_id, attendance_id, assigned_at, version, swing_due_at,
    game_tables!inner(id, table_name, table_type, club_id, game_type, tour_tier),
    dealer_attendance!attendance_id!inner(id, dealer_id, shift_id,
      dealers!inner(id, full_name, tier, telegram_username, telegram_user_id))
  `)
  .eq("status", "assigned")
  .is("swing_processed_at", null)
  .is("pre_assigned_attendance_id", null)
  .gte("swing_due_at", NOW + 4min)
  .lte("swing_due_at", NOW + 8min);

// 2. Với mỗi assignment, chọn dealer thay thế
for (const a of preAssignList) {
  const nextDealer = await pickNextDealer(
    admin, table.club_id, da.shift_id, table.table_type,
    table.tour_tier, 45, [], table.id,
  );

  if (!nextDealer) {
    // Không có dealer → gửi pre-announce cảnh báo floor
    sendTelegramNotification(..., formatPreAnnounceMessage(...));
    continue;
  }

  // 3. Atomic CAS: lock pre_assigned_attendance_id (tránh race condition)
  const { data: locked } = await admin
    .from("dealer_assignments")
    .update({ pre_assigned_attendance_id: nextDealer.attendance_id, pre_assigned_at: now })
    .eq("id", a.id)
    .is("pre_assigned_attendance_id", null)
    .eq("status", "assigned")
    .select("id");

  if (!locked?.length) continue; // race lost → cycle sau xử lý lại

  // 4. Lock dealer state → pre_assigned
  await admin
    .from("dealer_attendance")
    .update({ current_state: "pre_assigned", pre_assigned_table_id: table.id, pre_assigned_at: now })
    .eq("id", nextDealer.attendance_id)
    .eq("current_state", "available");

  // 5. Gửi Telegram
  sendGroupNotify(botToken, admin, table.club_id,
    formatPreAssignMessage({ tableName, incomingDealer, minutesLeft }), a.id);
  notifyIncomingDealer(botToken, dealer, table.table_name, minutesLeft);
}
```

---

## 2. Logic Chấm Điểm Chọn Dealer (pickNextDealer)

### 2.1 Bộ Lọc Cứng (Hard Filters) — Loại Bỏ Hoàn Toàn

```typescript
// File: supabase/functions/_shared/dealer-utils.ts:119-328

// Filter 1: dealer không available
.eq("current_state", "available")

// Filter 2: chưa check-in
.eq("status", "checked_in")

// Filter 3: khác club
.eq("dealers.club_id", clubId)

// Filter 4: pool đã cạn (đã được chọn trong cycle này)
if (excludeAttendanceIds?.size) {
  available = available.filter(a => !excludeAttendanceIds.has(a.id));
}

// Filter 5: HIGH tour → loại Dealer C
if (tourTier === "HIGH") {
  available = available.filter(a => a.dealers.tier !== "C");
}

// Filter 6: Fatigue — < 15 phút đến mandatory break (120 phút)
const MANDATORY_BREAK_MINUTES = 120;
available = available.filter(a => {
  const worked = a.worked_minutes_since_last_break ?? 0;
  return (MANDATORY_BREAK_MINUTES - worked) >= 15;
});

// Filter 7: Skill match (nếu requiredGameTypes có)
// Chỉ giữ dealer có ALL required game types
```

### 2.2 Bảng Chấm Điểm (Scoring)

Sau khi lọc, mỗi dealer được chấm điểm. Dealer có điểm **cao nhất** được chọn.

```typescript
// File: supabase/functions/_shared/dealer-utils.ts:248-318

const scored = available.map(a => {
  let score = 0;

  // ─── 1000 điểm: Dealer mới chưa có assignment nào + không back-to-back ───
  if (totalAssignments === 0 && lastTableMap.get(a.dealer_id) !== currentTableId)
    score += 1000;

  // ─── Thời gian nghỉ từ lần break cuối (tối đa 200 điểm) ───
  score += Math.min(200, minutesSinceRest * 1.5);

  // ─── Sắp đến giới hạn break? (trừ điểm, áp dụng khi < 30 phút) ───
  const minutesUntilMandatory = 120 - workedSinceBreak;
  if (minutesUntilMandatory < 30) {
    score -= (30 - minutesUntilMandatory) * 2;
  }

  // ─── Công bằng workload (so với trung bình club) ───
  score += (avgWorkedMinutes - dealerWorkedMinutes) * 0.3;

  // ─── Cân bằng break (dealer nghỉ nhiều hơn TB = ưu tiên) ───
  score += (dealerBreakMinutes - avgBreakMinutes) * 0.4;

  // ─── Tier matching theo tour ───
  // HIGH: A=+30, B=+5
  // MEDIUM: B=+20, A=+5, C=+5
  // LOW: C=+20, B=+5, A=+2

  // ─── High-value balance (chỉ HIGH tour) ───
  score += (avgHv - dealerHv) * 3;

  // ─── Phạt back-to-back (cùng bàn) ───
  if (lastTableMap.get(a.dealer_id) === currentTableId) score -= 50;

  // ─── Phạt consecutive >= 3 lần ───
  if (recentAssignments >= 3) score -= (recentAssignments - 2) * 15;

  // ─── Skill match bonus ───
  if (requiredGameTypes.length > 0) {
    const matchCount = requiredGameTypes.filter(gt => skills.includes(gt)).length;
    score += matchCount * 20;
  }

  return { attendance_id, dealer_id, dealer_name, tier, score };
});

// Sắp xếp giảm dần theo điểm
.sort((a, b) => b.score - a.score);

// Lọc lại theo skill match (nếu có)
const filtered = requiredGameTypes.length > 0
  ? scored.filter(d => requiredGameTypes.every(gt => skills.includes(gt)))
  : scored;

// Trả về dealer tốt nhất
return filtered[0] ?? null;
```

### 2.3 Giải Thích Ý Nghĩa Từng Yếu Tố

| Yếu tố | Ý nghĩa | Tại sao? |
|--------|---------|----------|
| **+1000** | Dealer chưa từng được gán | Đảm bảo dealer mới check-in được ưu tiên, không bị bỏ quên |
| **+min(200, rest*1.5)** | Vừa nghỉ xong được bonus | Dealer vừa break xong là ứng viên tốt nhất |
| **-(30-phút)*2** | Trừ điểm nếu sắp đến break | Tránh gán cho dealer sắp phải nghỉ bắt buộc (sắp đạt 120 phút) |
| **+(TB-dealer)*0.3** | Ưu tiên người làm ít hơn | Công bằng: dealer làm ít được ưu tiên hơn |
| **+(nghỉ-TB)*0.4** | Dealer nghỉ nhiều hơn TB | Dealer vừa break xong (đã nghỉ nhiều) đáng được chọn |
| **+score theo tier** | Tier phù hợp tour | Bàn HIGH cần dealer A/B, bàn LOW có thể dealer C |
| **+(TBhv-dealerHv)*3** | Cân bằng high-value | Phân bố đều các bàn HIGH cho mọi dealer |
| **-50** | Back-to-back | Tránh dealer ngồi mãi một bàn (công bằng, giảm chán) |
| **-(count-2)*15** | Consecutive penalty | Không để cùng 1 dealer bị gọi 3+ lần liên tiếp |
| **+matchCount*20** | Skill match | Dealer có kỹ năng phù hợp được bonus |

---

## 3. Đếm Thời Gian Còn Bao Nhiêu Phút

### 3.1 Khi Nào Tính `swing_due_at`?

**Trigger `trg_calc_swing_due_at`** (BEFORE INSERT ON dealer_assignments):

```sql
-- Từ migration 20260530000003_sprint3_schema.sql
CREATE OR REPLACE FUNCTION func_calc_swing_due_at()
RETURNS TRIGGER AS $$
DECLARE
  v_duration INT;
  v_pre_announce INT;
BEGIN
  -- Lấy swing_duration từ swing_config dựa trên club + table_type
  SELECT swing_duration_minutes, pre_announce_minutes
  INTO v_duration, v_pre_announce
  FROM swing_config sc
  JOIN game_tables gt ON gt.club_id = sc.club_id AND gt.table_type = sc.table_type
  WHERE gt.id = NEW.table_id;

  v_duration := COALESCE(v_duration, 45);
  v_pre_announce := COALESCE(v_pre_announce, 10);

  NEW.swing_due_at := NEW.assigned_at + (v_duration || ' minutes')::INTERVAL;
  NEW.pre_announce_due_at := NEW.swing_due_at - (v_pre_announce || ' minutes')::INTERVAL;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_calc_swing_due_at
  BEFORE INSERT ON dealer_assignments
  FOR EACH ROW EXECUTE FUNCTION func_calc_swing_due_at();
```

> **Lưu ý:** Hiện tại trigger đang bị bug (self-join `dealer_assignments` trong BEFORE INSERT). Cần fix bằng cách JOIN qua `game_tables` thay vì `dealer_assignments` (đang pending fix).

### 3.2 Công Thức Tính Thời Gian

```
assigned_at = NOW (khi dealer ngồi bàn)
swing_due_at = assigned_at + swing_duration_minutes (default 45 phút)
pre_announce_due_at = swing_due_at - pre_announce_minutes (default 10 phút)

Ví dụ:
  assigned_at = 10:00
  swing_duration = 45 phút
  pre_announce = 10 phút
  → swing_due_at = 10:45
  → pre_announce_due_at = 10:35

Pass 2 (pre-assign) trigger: swing_due_at BETWEEN (NOW+4min) AND (NOW+8min)
  → Khoảng 10:37-10:41 → chọn dealer mới, set pre_assigned

Pass 3 (execute): swing_due_at <= NOW+5min
  → Khoảng 10:40+ → thực thi swing
```

### 3.3 Code Đếm Phút

```typescript
// Trong process-swing Pass 2:
const swingDueAt = new Date(a.swing_due_at ?? a.assigned_at);
const minutesLeft = Math.max(1, Math.round((swingDueAt.getTime() - now.getTime()) / 60000));
// → Kết quả: "còn ~6 phút" (dùng trong formatPreAssignMessage)

// Trong process-swing Pass 3 (Telegram sau swing):
const minutesLeft = Math.max(0, Math.round((swingDueAt.getTime() - Date.now()) / 60000));
// → Kết quả: "còn X phút" (dùng trong formatSwingMessage)
```

---

## 4. Gửi Tin Nhắn Telegram

### 4.1 Cơ Chế Gửi Chung

```typescript
// File: supabase/functions/_shared/telegram.ts:188-232

async function sendTelegramNotification(
  botToken: string,
  chatId: string,        // Telegram chat/group ID
  text: string,          // Nội dung tin nhắn (HTML)
  options?: { retries?: number; logError?: (msg: string) => void },
): Promise<boolean> {
  const maxRetries = options?.retries ?? 3;

  for (let i = 0; i < maxRetries; i++) {
    try {
      const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: String(chatId),
          text,                              // Nội dung
          parse_mode: "HTML",                // Hỗ trợ HTML tags
          disable_web_page_preview: true,
        }),
      });
      if (res.ok) return true;               // Thành công

      // Thất bại → log lỗi
      const err = await res.text();
      console.error(`Telegram attempt ${i + 1} failed:`, res.status, err);
    } catch (err) { /* exception */ }

    // Exponential backoff: 1s, 2s, 4s
    if (i < maxRetries - 1) {
      await new Promise(r => setTimeout(r, 1000 * Math.pow(2, i)));
    }
  }
  return false;
}
```

### 4.2 Format Từng Loại Tin Nhắn

#### 🔔 Pre-Assign (Pass 2 — Có dealer thay)
```typescript
formatPreAssignMessage({
  tableName: "Bàn 5",
  tourTier: "HIGH",
  incomingDealer: { full_name: "Nguyễn Văn A", telegram_username: "nguyenvana" },
  minutesLeft: 6,
})
// Kết quả: 🔔 Bàn 5 [HIGH]: @nguyenvana chuẩn bị ra bàn sau ~6 phút!
```

#### ⏰ Pre-Announce (Pass 2 — Không có dealer thay)
```typescript
formatPreAnnounceMessage({
  tableName: "Bàn 5",
  outgoingDealer: { full_name: "Trần Văn B" },
  minutesLeft: 10,
})
// Kết quả: ⏰ Bàn 5: Trần Văn B còn ~10 phút. Floor chuẩn bị!
```

#### 📋 Swing Execute
```typescript
formatSwingMessage({
  tableName: "Bàn 5",
  tourName: "Tournament",
  outgoingDealer: { full_name: "Trần Văn B" },
  incomingDealer: { full_name: "Nguyễn Văn A", telegram_username: "nguyenvana" },
  minutesLeft: 45,
})
// Kết quả: 📋 Bàn 5 (Tournament): Trần Văn B ra, @nguyenvana vào (còn 45 phút).

// Nếu không có dealer thay:
// ⚠️ Bàn 5 (Tournament): Trần Văn B ra — CHƯA CÓ DEALER THAY!
```

#### ⚠️ Pre-Assign Fallback
```typescript
formatPreAssignFallbackMessage({
  tableName: "Bàn 5",
  oldDealer: { full_name: "Trần Văn B" },
  reason: "không còn available",
})
// Kết quả: ⚠️ Bàn 5: Trần Văn B ra — dealer dự kiến không còn available. Đang chọn lại...
```

#### 🆕 Auto-Fill (Pass 1)
```typescript
formatAutoFillMessage([
  { tableName: "Bàn 3", dealer: { full_name: "Nguyễn Văn A" }, tourTier: "HIGH" },
  { tableName: "Bàn 7", dealer: { full_name: "Lê Thị C" }, tourTier: "LOW" },
])
// Kết quả:
// 🆕 Tự động gán dealer (2 bàn):
//   • Bàn 3 [HIGH] → Nguyễn Văn A
//   • Bàn 7 [LOW] → Lê Thị C
```

#### 📋 Mass Assign
```typescript
formatMassAssignMessage([
  { tableName: "Bàn 3", dealer: { full_name: "Nguyễn Văn A" } },
])
// Kết quả: 📋 Mass Assign (1 bàn):
//   • Bàn 3 → Nguyễn Văn A
```

#### ☕ Break Start
```typescript
formatBreakMessage({
  dealer: { full_name: "Nguyễn Văn A" },
  durationMinutes: 20,
  startTime: "14:30",
})
// Kết quả: ☕ Nguyễn Văn A đang nghỉ (20 phút). Bắt đầu lúc: 14:30.
```

#### ✅ Break End
```typescript
formatBreakEndMessage({
  dealer: { full_name: "Nguyễn Văn A" },
  tableName: "Bàn 5",
})
// Kết quả: ✅ Nguyễn Văn A đã nghỉ xong, quay lại bàn 5.
```

#### 🔴 Close Table
```typescript
formatCloseTableMessage({
  tableName: "Bàn 5",
  lastDealer: { full_name: "Nguyễn Văn A" },
  workedMinutes: 120,
  reason: "Kết thúc giải",
})
// Kết quả: 🔴 Đóng bàn 5. Dealer cuối: Nguyễn Văn A (120 phút). Lý do: Kết thúc giải.
```

#### ⚠️ Break Alert (từ enforceBreakBalance)
```typescript
formatBreakAlertMessage({
  dealer: { full_name: "Nguyễn Văn A" },
  workedMinutes: 110,
  clubName: "Club Poker",
})
// Kết quả: ⚠️ Cảnh báo break: Nguyễn Văn A đã làm 110 phút tại Club Poker.
//          Cần cho nghỉ ngay!
```

### 4.3 DM Riêng Cho Dealer (nếu đã /link)

```typescript
// File: supabase/functions/_shared/telegram.ts:143-170
async function notifyIncomingDealer(
  botToken: string,
  dealer: { telegram_user_id?: number; full_name: string; telegram_username?: string },
  tableName: string,
  minutesLeft: number,
  chatId?: string, // fallback group
): Promise<void> {
  const msg = `🔔 Chuẩn bị: Bàn <b>${tableName}</b> sau ~${minutesLeft} phút. Đến vị trí!`;

  // Thử DM trực tiếp
  if (dealer.telegram_user_id) {
    const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: String(dealer.telegram_user_id), text: msg, parse_mode: "HTML" }),
    });
    if (res.ok) return; // DM thành công
  }
  // Fallback: group notification đã được gửi riêng
}
```

### 4.4 Full Diagram Gửi Tin Nhắn Trong 1 Swing

```
Thời gian:     T-10                 T-6                    T-0
               │                    │                       │
Telegram:  ⏰ pre-announce     🔔 pre-assign          📋 swing execute
           (cảnh báo floor)   (group + DM cho        (thông báo ai ra, ai vào)
                               dealer mới)
```

---

## 5. Auto Swing — Tự Động Thay Thế Người

### 5.1 Kích Hoạt

**Cron job mỗi phút** (pg_cron):
```sql
-- File: 20260530000004_pg_cron_auto_swing.sql
SELECT cron.schedule(
  'process-swing-auto',
  '* * * * *',                     -- Mỗi phút
  $$SELECT net.http_post(
    url:='https://orlesggcjamwuknxwcpk.supabase.co/functions/v1/process-swing',
    headers:=jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer [ANON_KEY]'
    ),
    body:='{}'                     -- Không club_id → xử lý tất cả clubs
  )$$
);
```

**Hoặc manual từ Frontend (khi bật Auto-Swing toggle):**
```typescript
// Trong DealerSwingTab.tsx:
const [autoSwing, setAutoSwing] = useState(false); // Mặc định OFF

// Khi toggle ON:
const handleAutoSwingToggle = async (checked: boolean) => {
  setAutoSwing(checked);
  if (checked) {
    // 1. Upsert club_settings.auto_swing_enabled = true
    await upsertClubSetting(cid, { auto_swing_enabled: true });

    // 2. Mass assign (fill bàn trống trước)
    const result = await massAssign({ club_id: cid, shift_id });
    const emptyTablesExist = result === 0; // nếu có bàn trống

    // 3. Process swing (manual trigger + force_all)
    const swingResult = await autoSwingAll(cid, selectedTour);
    if (swingResult === 0 && emptyTablesExist) {
      // Rollback: tắt auto swing
      setAutoSwing(false);
    }
  } else {
    // Upsert club_settings.auto_swing_enabled = false
    await upsertClubSetting(cid, { auto_swing_enabled: false });
  }
};
```

### 5.2 3-Pass Architecture (process-swing)

Đây là cốt lõi của auto swing. Mỗi lần chạy, function thực hiện 3 pass:

```
process-swing mỗi phút
│
├── PASS 1: Cleanup + Fill bàn trống
│   ├── Reset stale pre_assigned (> 15 phút) → available
│   ├── fillEmptyTables(): tìm bàn trống, pickNextDealer, INSERT
│   └── Gửi 🆕 Telegram nếu có bàn mới
│
├── PASS 2: Pre-assign T-6
│   ├── Tìm assignments swing_due_at ~4-8 phút tới
│   ├── pickNextDealer() → CAS lock pre_assigned_attendance_id
│   ├── Lock dealer: current_state = 'pre_assigned'
│   ├── Gửi 🔔 Telegram group + DM dealer mới
│   └── Nếu không có dealer → gửi ⏰ pre-announce
│
└── PASS 3: Execute T-0
    ├── Tìm assignments swing_due_at <= NOW+5ph
    ├── Có pre_assigned?
    │   ├── YES → execute_pre_assigned_swing() RPC
    │   │   ├── swung → release old + activate pre-assigned
    │   │   ├── pre_assigned_lost → fallback: pickNextDealer mới
    │   │   └── race_lost → skip
    │   └── NO (legacy) → perform_swing() RPC
    │       ├── evaluateBreakNeed()
    │       ├── pickNextDealer()
    │       └── atomic: release old + break + assign new
    ├── Realtime broadcast → frontend
    └── Gửi 📋 Telegram
```

### 5.3 Auto-Fill Bàn Trống (fillEmptyTables)

```typescript
// File: supabase/functions/_shared/dealer-utils.ts:333-423

async function fillEmptyTables(admin, clubId, shiftId) {
  // 1. Đếm tổng bàn active → 0? skip (guard count)
  const { count: totalActive } = await admin
    .from("game_tables").select("id", { count: "exact", head: true })
    .eq("club_id", clubId).eq("status", "active");
  if (!totalActive) return [];

  // 2. Fetch tất cả active tables + tier
  const { data: allTables } = await admin
    .from("game_tables").select("id, table_name, table_type, tour_tier")
    .eq("club_id", clubId).eq("status", "active");

  // 3. Fetch assignment đang active → build busy set
  const { data: activeAssignments } = await admin
    .from("dealer_assignments").select("table_id")
    .eq("status", "assigned")
    .in("table_id", allTables.map(t => t.id));
  const busyTableIds = new Set(activeAssignments.map(a => a.table_id));
  let emptyTables = allTables.filter(t => !busyTableIds.has(t.id));

  // 4. Sort: HIGH → MEDIUM → LOW
  const tierOrder = { HIGH: 0, MEDIUM: 1, LOW: 2 };
  emptyTables.sort((a, b) => tierOrder[a.tour_tier] - tierOrder[b.tour_tier]);

  // 5. Với mỗi bàn trống → pickNextDealer + INSERT
  const assignments = [];
  const assignedAttendanceIds = new Set(); // pool depletion

  for (const table of emptyTables) {
    const nextDealer = await pickNextDealer(
      admin, clubId, shiftId, table.table_type,
      table.tour_tier, 45, [], table.id,
      assignedAttendanceIds, // exclude set
    );
    if (!nextDealer) break; // hết dealer khả dụng

    assignedAttendanceIds.add(nextDealer.attendance_id);

    // INSERT assignment
    await admin.from("dealer_assignments").insert({
      attendance_id: nextDealer.attendance_id,
      table_id: table.id,
      assigned_at: new Date().toISOString(),
      status: "assigned",
      idempotency_key: `fill-${table.id}-${Date.now()}`,
    });

    // UPDATE dealer state
    await admin.from("dealer_attendance")
      .update({ current_state: "assigned" })
      .eq("id", nextDealer.attendance_id);
  }

  return assignments;
}
```

### 5.4 Atomic Swing Execution (RPC)

Khi đến giờ swing, hệ thống thực hiện **atomic transaction** để tránh race condition:

#### Pre-assigned path:

```sql
-- File: 20260530000005_pre_assign_swing.sql
-- execute_pre_assigned_swing() RPC

-- 1. CAS lock: SELECT ... FOR UPDATE (chỉ lock nếu version khớp)
SELECT * FROM dealer_assignments
WHERE id = p_old_assignment_id
  AND version = p_old_version
  AND status = 'assigned'
FOR UPDATE;

-- 2. Verify pre-assigned dealer còn valid
SELECT * FROM dealer_attendance
WHERE id = pre_att_id AND current_state = 'pre_assigned'
FOR UPDATE;

-- Nếu mất → UPDATE pre_assigned_attendance_id = NULL
--          RETURN { status: 'pre_assigned_lost' }

-- 3. Release old assignment
UPDATE dealer_assignments SET status='completed', released_at=NOW(), ...;

-- 4. Reset old dealer
UPDATE dealer_attendance SET current_state='available' WHERE id=old_id;

-- 5. Create new assignment cho pre-assigned dealer
INSERT INTO dealer_assignments(table_id, attendance_id, ...);

-- 6. Activate new dealer
UPDATE dealer_attendance SET current_state='assigned', pre_assigned_table_id=NULL
WHERE id=pre_att_id;

-- 7. Audit log
INSERT INTO swing_audit_logs(...);
```

#### Legacy path (không pre-assign):

```sql
-- File: 20260528000002_perform_swing_rpc.sql
-- perform_swing() RPC

-- Atomic CAS release
UPDATE dealer_assignments SET released_at=NOW(), status='completed',
       swing_processed_at=NOW(), version=version+1
WHERE id=p_old_assignment_id AND version=p_old_version
  AND status='assigned' AND swing_processed_at IS NULL;

IF NOT FOUND THEN RETURN { status: 'race_lost' }; END IF;

-- Release old dealer
UPDATE dealer_attendance SET current_state='available' WHERE id=old_id;

-- Break if needed
IF p_should_break THEN
  INSERT INTO dealer_breaks(assignment_id, break_start, ...);
  UPDATE dealer_attendance SET current_state='on_break' WHERE id=old_id;
END IF;

-- Assign new dealer
INSERT INTO dealer_assignments(attendance_id, table_id, ...);
UPDATE dealer_attendance SET current_state='assigned' WHERE id=new_id;

-- Audit
INSERT INTO swing_audit_logs(...);
```

### 5.5 Telegram Notifications Trong Auto Swing

Dưới đây là thứ tự Telegram khi auto swing chạy cho 1 bàn:

```
⏰ Bàn 5: Trần Văn B còn ~10 phút. Floor chuẩn bị!
    → Pass 2: không tìm được dealer thay, cảnh báo floor

--- hoặc ---

🔔 Bàn 5 [HIGH]: @nguyenvana chuẩn bị ra bàn sau ~6 phút!
    → Pass 2: tìm được dealer mới (group thông báo)

🔔 Chuẩn bị: Bàn 5 sau ~6 phút. Đến vị trí!
    → DM riêng cho Nguyễn Văn A (nếu đã /link)

📋 Bàn 5 (Tournament): Trần Văn B ra, @nguyenvana vào (còn 45 phút).
    → Pass 3: swing thực thi thành công

--- nếu pre-assign mất ---

⚠️ Bàn 5: Trần Văn B ra — dealer dự kiến không còn available. Đang chọn lại...
    → Pass 3: fallback, chọn dealer mới
```

### 5.6 Xử Lý Lỗi & Fallback

| Tình huống | Xử lý | Hậu quả |
|------------|-------|---------|
| **race_lost** (CAS fail) | Skip, cycle sau xử lý lại | Bàn trễ swing 1 phút |
| **pre_assigned_lost** | Fallback: pickNextDealer + perform_swing | Swing vẫn diễn ra, nhưng có thể chậm hơn |
| **Không có dealer thay** | Ghi swung_no_dealer, bàn tạm trống | Pass 1 cycle sau sẽ fill |
| **Stale pre_assigned > 15 phút** | Reset to available | Dealer được giải phóng |
| **Telegram fail** | Retry 3 lần (1s, 2s, 4s), log error vào swing_audit_logs | Tin nhắn có thể mất |
| **Auto-swing disabled** | Skip toàn bộ | Chỉ chạy khi manual trigger |

### 5.7 Enforce Break Balance (Cron 15 Phút)

```typescript
// Khi dealer đã làm >= 120 phút không nghỉ:
// Nếu available + không có assignment → force break ngay
// Nếu assigned → set priority_break_flag + Telegram cảnh báo
// Lý do: fatigue hard-exclude đã loại dealer khi < 15 phút đến break,
// nhưng enforceBreakBalance đảm bảo dealer được cho nghỉ trước khi
// đến ngưỡng fatigue
```

---

## 6. Tổng Kết Luồng

```
Frontend User                    process-swing                     Database                  Telegram Group
    │                                │                               │                          │
    │ Bật Auto Swing                 │                               │                          │
    │───────────────────────────────►│                               │                          │
    │                                │                               │                          │
    │                          ┌─────┴──────┐                       │                          │
    │                          │ Pass 1: Fill│                       │                          │
    │                          │ bàn trống   │────► INSERT + UPDATE ──►                          │
    │                          │             │────► 🆕 Telegram ─────────────────────────────────►
    │                          └─────┬──────┘                       │                          │
    │                                │                               │                          │
    │                          ┌─────┴──────┐                       │                          │
    │                          │ Pass 2:    │                       │                          │
    │                          │ Pre-assign │────► CAS lock + state ──►                          │
    │                          │ T-6        │────► 🔔 Telegram ─────────────────────────────────►
    │                          │            │────► DM riêng ──────────► (DM dealer mới)          │
    │                          └─────┬──────┘                       │                          │
    │                                │                               │                          │
    │                          ┌─────┴──────┐                       │                          │
    │                          │ Pass 3:    │                       │                          │
    │                          │ Execute    │────► RPC: swing ──────►                          │
    │                          │ T-0        │────► 📋 Telegram ─────────────────────────────────►
    │                          │            │────► Realtime ─────────►                          │
    │◄─────────────────────────┤            │                       │                          │
    │   { success, swings,     └────────────┘                       │                          │
    │     errors, ...}                                              │                          │
    │                                │                               │                          │
    │ Frontend cập nhật UI           │                               │                          │
    │ (await refetchAssignments()     │                               │                          │
    │  → build fresh map từ data mới) │                               │                          │
```

---

*File tham khảo chính:*
- `supabase/functions/_shared/dealer-utils.ts` — pickNextDealer, fillEmptyTables, evaluateBreakNeed
- `supabase/functions/_shared/telegram.ts` — format messages, sendTelegramNotification
- `supabase/functions/process-swing/index.ts` — 3-pass orchestrator
- `supabase/functions/mass-assign/index.ts` — fill bàn trống manual
- `supabase/migrations/20260528000002_perform_swing_rpc.sql` — atomic swing RPC
- `supabase/migrations/20260530000005_pre_assign_swing.sql` — pre-assign swing RPC
- `src/components/cashier/DealerSwingTab.tsx` — frontend auto-swing toggle
