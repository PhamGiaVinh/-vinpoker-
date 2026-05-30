# Swing Bug Fixes + Dealer Management Tab

## TL;DR
> **Summary**: Fix 5 swing bugs + 1 D1 void-return bug + migration + dealer management tab. Edge functions feature the same shared module (dealer-utils.ts) — deploy ALL 3 simultaneously to avoid split behavior.
> **Deliverables**: 3 edge functions re-deployed (simultaneously), 1 DB migration (transaction-wrapped, rollback companion), 1 new UI component + 1 dialog + 1 hook, 12 TODOs
> **Effort**: Medium (~8 giờ)
> **Parallel**: YES — 4 waves
> **Critical Path**: Source fixes → simultaneous deploy → migration → dealer UI

## Context
### Original Request
- Fix lỗi "Đã gán 0 bàn trống", "force swing Failed to send request", "auto swing all :lỗi"
- Review logic swing (tier→tour, duration, auto-adjust khi mở bàn)
- Thêm tab quản lý dealer: danh sách, thêm dealer, hạng, điểm số, part/full-time, giờ làm, báo cáo lương

### Interview Summary
- **Bug 1 (CRITICAL)**: `fillEmptyTables` check `rpcResult?.outcome === "assigned"` — RPC returns TEXT `'ok'` không phải JSONB → mọi mass-assign trả về 0
- **Bug 2**: `forceSwingAll()` thiếu `club_id` → xử lý tất cả clubs → timeout >5s
- **Bug 3**: `autoSwingAll()` từ nút standalone cũng thiếu `club_id`
- **Bug 4**: `mass-assign` dùng `a.tableName` (cũ) nhưng `fillEmptyTables` mới trả về `a.table_name`, không có `tourTier`
- **Bug 5**: `force_all` mode chỉ filter pre_assigned — skip tất cả active assignments không có pre-assign
- **D1 (NEW)**: `refetchAssignments()` returns `Promise<void>` — `Object.fromEntries(undefined)` luôn empty sau massAssign
- **Dealer score**: total_hours × 1.0 + total_swings × 0.5 + tier_bonus (A=20, B=10, C=0)
- **Part-time**: Lương giờ (hourly_rate_vnd), **Full-time**: base_rate_vnd cố định, OT = hourly × 1.5

### Metis Review
Đã review và xác nhận bugs. Oracle CONDITIONAL GO: (1) deploy 3 edge functions đồng thời, (2) migration transaction wrapper + rollback. Đã fix cả hai.

## Work Objectives
### Core Objective
1. **Fix 6 bugs** để swing system hoạt động đúng
2. **Thêm Dealer Management** tab: CRUD dealer, score, rank, working hours, payroll foundation

### Deliverables
- `supabase/functions/_shared/dealer-utils.ts` — Fix Bug 1
- `supabase/functions/mass-assign/index.ts` — Fix Bug 4
- `supabase/functions/process-swing/index.ts` — Fix Bug 5
- `src/components/cashier/DealerSwingTab.tsx` — Fix Bug 2+3 + D1 + add tab button
- `src/components/cashier/DealerManagementTab.tsx` — New component
- `src/components/cashier/AddDealerDialog.tsx` — New dialog
- `src/hooks/useDealerManagement.ts` — New hook
- `supabase/migrations/20260610000000_dealer_management.sql` — Transaction-wrapped migration

### Definition of Done (verifiable)
- Tắt auto-swing → bật lại → dealer được gán vào bàn trống (toast "Đã gán X bàn")
- Click "Force Swing All" → không timeout, có processed_count > 0
- Click "Auto-Swing All" → xử lý đúng club đang chọn
- Tab "Danh sách Dealer" hiển thị đủ dealers, filter/search hoạt động, thêm/sửa dealer được
- dealer_scores VIEW trả về score đúng công thức
- Lương part-time/full-time phân biệt trong payroll export

### Must Have
- Fix Bug 1 (critical path)
- Fix Bug 2+3 (club_id)
- Fix D1 (refetch void return)
- Tab danh sách dealer + thêm dealer
- Score tự động + thứ hạng

### Must NOT Have (guardrails, AI slop patterns, scope boundaries)
- Không thay đổi RPC signature của `assign_dealer_to_table` (chỉ fix TS check)
- Không tách process-swing thành nhiều file (giữ nguyên structure)
- Dealer tab không dùng Realtime subscription (poll 30s đủ)
- Bug 5 fix backward compatible (force_all vẫn xử lý pre-assigned nếu có trong dữ liệu)
- Oracle blocker #1: deploy 3 edge functions đồng thời, không tuần tự
- Oracle blocker #2: migration wrapped trong BEGIN...COMMIT + rollback companion

## Verification Strategy
> ZERO HUMAN INTERVENTION — all verification is agent-executed
- **Test decision**: tests-after (manual QA qua UI)
- **QA policy**: Mỗi task có scenario agent-executed
- **Evidence**: `.omo/evidence/task-{N}-{slug}.log`

## Execution Strategy
### Parallel Execution Waves

**Wave 1** (Fix edge function source — all independent):
- Task 1: Fix Bug 1 (dealer-utils.ts) — 1 dòng
- Task 2: Fix Bug 4 (mass-assign/index.ts) — 5 dòng
- Task 3: Fix Bug 5 (process-swing/index.ts) — sửa filter

**Wave 2** (Frontend fixes + DB migration + simultaneous deploy):
- Task 4: Fix Bug 2+3 (DealerSwingTab.tsx) — thêm club_id
- Task 5: Fix D1 (DealerSwingTab.tsx) — refetchAssignments void return
- Task 6: Write migration (dealer_management.sql — transaction wrapper)
- → Deploy ALL 3 edge functions simultaneously: `supabase functions deploy mass-assign process-swing assign-dealer`
- → Apply migration: `supabase migration up`

**Wave 3** (New feature — Dealer Management):
- Task 7: New hook useDealerManagement.ts
- Task 8: New component DealerManagementTab.tsx
- Task 9: AddDealerDialog.tsx

**Wave 4** (Integration + Polish):
- Task 10: Integrate DealerManagementTab vào Swing Panel
- Task 11: Update payroll export (doExportPayrollCsv) dùng dealer_scores VIEW
- Task 12: Auto-assign dealer khi activate bàn từ pool
- → Deploy frontend (Vercel)

### Dependency Matrix
| Task | Depends On |
|------|-----------|
| 1 (Bug 1) | — |
| 2 (Bug 4) | — |
| 3 (Bug 5) | — |
| 4 (Bug 2+3) | — |
| 5 (D1 refetch) | — |
| 6 (Migration) | — |
| 7 (useDealerManagement) | 6 |
| 8 (DealerManagementTab) | 7 |
| 9 (AddDealerDialog) | — |
| 10 (Integrate tab) | 8, 9 |
| 11 (Payroll export) | 6, 7 |
| 12 (Auto-assign) | — |

### Agent Dispatch Summary
| Wave | Tasks | Categories |
|------|-------|-----------|
| 1 | 1, 2, 3 | quick (all 3 — 1-5 line fixes) |
| 2 | 4, 5, 6 | quick (4,5) + deep (6 — migration) |
| 3 | 7, 8, 9 | unspecified-high |
| 4 | 10, 11, 12 | unspecified-high |

## TODOs

- [ ] 1. Fix Bug 1 — `rpcResult?.outcome` check sai trong fillEmptyTables

  **What to do**: Sửa 2 dòng trong `supabase/functions/_shared/dealer-utils.ts`:
  - Dòng 383: `rpcResult?.outcome === "assigned"` → `rpcResult === "ok"`
  - Dòng 396: `rpcResult?.outcome === "version_conflict"` → `rpcResult === "conflict"`
  - Xóa dòng check `version_conflict` (RPC chỉ return 'conflict')
  - Accept cả `rpcResult === "ok"` (current RPC returns TEXT) VÀ `rpcResult?.outcome === "assigned"` (future-proof)

  **Must NOT do**: Không sửa RPC `assign_dealer_to_table` — chỉ fix TS check

  **References**:
  - File: `supabase/functions/_shared/dealer-utils.ts:383,396`
  - RPC: `supabase/migrations/20260605000000_unique_active_assignment.sql` — function returns TEXT
  - Pattern: `deploy-package/functions/_shared/dealer-utils.ts:647` dùng `result === "conflict"`

  **Acceptance Criteria**:
  - [ ] `fillEmptyTables` có thể assign dealer thành công (không silent fail)

  **QA Scenarios**:
  ```
  Scenario: fillEmptyTables assigns dealer successfully
    Tool: interactive_bash
    Steps: 
      1. Deploy mass-assign edge function: supabase functions deploy mass-assign
      2. Gọi mass-assign từ frontend với club có bàn trống + dealer available
      3. Kiểm tra response: assigned > 0
    Expected: assigned count > 0
    Evidence: .omo/evidence/task-1-fill-assigned.log
  ```

  **Commit**: NO (sẽ gộp với Wave 2 deploy commit)

- [ ] 2. Fix Bug 4 — Property names trong mass-assign/index.ts

  **What to do**: Trong `supabase/functions/mass-assign/index.ts`:
  - `a.tableName` → `a.table_name`
  - `a.dealerName` → `a.full_name`
  - `a.tourTier` → `"tournament"` (hằng số vì FillResult mới không có tourTier)
  - Cập nhật Telegram `formatMassAssignMessage` call: property names tương tự

  **Must NOT do**: Không thay đổi signature của `fillEmptyTables`

  **References**:
  - File: `supabase/functions/mass-assign/index.ts:41-46,50-53,73-76`
  - `_shared/dealer-utils.ts`: FillResult.AssignmentInfo = { table_id, table_name, attendance_id, full_name }

  **Acceptance Criteria**:
  - [ ] Audit log có `table_name` hợp lệ (không undefined)
  - [ ] Response có `table_name` hợp lệ

  **QA Scenarios**:
  ```
  Scenario: mass-assign returns correct property names
    Tool: interactive_bash
    Steps:
      1. Deploy mass-assign edge function
      2. Invoke mass-assign với club có bàn trống
      3. Kiểm tra response.assignments[0].table_name không undefined
    Expected: table_name === tên bàn thật
    Evidence: .omo/evidence/task-2-property-names.log
  ```

  **Commit**: NO

- [ ] 3. Fix Bug 5 — `force_all` mode trong process-swing

  **What to do**: Sửa filter trong `supabase/functions/process-swing/index.ts` dòng ~342-346:
  ```typescript
  // Cũ:
  if (!forceAll) {
    query.lte("swing_due_at", nowPlusBuf);
  } else {
    query.not("pre_assigned_attendance_id", "is", null);
  }

  // Mới:
  if (!forceAll) {
    query.lte("swing_due_at", nowPlusBuf);
  }
  // forceAll = bỏ time filter, xử lý tất cả assignments chưa swing (status='assigned' AND swing_processed_at IS NULL)
  ```

  **Must NOT do**: Không xóa logic pre_assigned path — pre-assigned swing vẫn chạy trong Pass 3

  **References**:
  - File: `supabase/functions/process-swing/index.ts:342-346`

  **Acceptance Criteria**:
  - [ ] `force_all=true` xử lý tất cả active assignments (không chỉ pre-assigned)

  **QA Scenarios**:
  ```
  Scenario: Force Swing All processes all assignments
    Tool: interactive_bash
    Steps:
      1. Deploy process-swing edge function
      2. Gọi process-swing với { force_all: true, club_id: "xxx", manual_trigger: true }
      3. Kiểm tra response.processed_count > 0
    Expected: processed_count = số assignments đã xử lý
    Evidence: .omo/evidence/task-3-force-all.log
  ```

  **Commit**: NO

- [ ] 4. Fix Bug 2+3 — Thêm club_id vào forceSwingAll + autoSwingAll

  **What to do**: Trong `src/components/cashier/DealerSwingTab.tsx`:
  1. `forceSwingAll` (dòng 227-242):
     ```typescript
     const activeClubId = clubFilter ?? filteredClubIds[0];
     if (!activeClubId) { toast.error("Vui lòng chọn CLB trước"); return; }
     body.club_id = activeClubId;
     ```
  2. `autoSwingAll` (dòng 196-224): Nếu `clubId` falsy:
     ```typescript
     if (!clubId) clubId = clubFilter ?? filteredClubIds[0];
     if (!clubId) { toast.error("Vui lòng chọn CLB"); return; }
     ```

  **Must NOT do**: Không thay đổi signature của `massAssign` (đã có clubFilter)

  **References**:
  - File: `src/components/cashier/DealerSwingTab.tsx:196-242`

  **Acceptance Criteria**:
  - [ ] `forceSwingAll` luôn có `club_id` trong request body
  - [ ] `autoSwingAll` standalone (từ nút) có `club_id` mặc định

  **QA Scenarios**:
  ```
  Scenario: Force swing passes club_id
    Tool: interactive_bash
    Steps: Kiểm tra trong code sau khi sửa
    Expected: body.club_id !== undefined
    Evidence: .omo/evidence/task-4-club-id.log
  ```

  **Commit**: NO

- [ ] 5. Fix D1 — `refetchAssignments()` returns void, không thể dùng return value

  **What to do**: Trong `src/components/cashier/DealerSwingTab.tsx` dòng ~161-162:
  ```typescript
  // Cũ (lỗi):
  const updatedAssignments = await refetchAssignments(); // returns void
  const assignedMap = Object.fromEntries(
    (updatedAssignments ?? []).map(a => [a.table_id, true])
  );

  // Mới:
  await refetchAssignments(); // triggers re-render với data mới
  // Đọc từ hook state đã có sẵn trong scope
  const assignedMap = Object.fromEntries(
    (activeAssignments ?? []).map(a => [a.table_id, true])
  );
  ```

  **Must NOT do**: Không đổi signature của `refetchAssignments` trong useDealerSwing hook

  **References**:
  - File: `src/components/cashier/DealerSwingTab.tsx:161-162`
  - Hook: `src/hooks/useDealerSwing.ts` — `refetchAssignments` returns `Promise<void>`
  - `activeAssignments` là biến hook state đã có trong scope

  **Acceptance Criteria**:
  - [ ] Post-massAssign empty-table check hoạt động (dùng activeAssignments từ state)
  - [ ] Không còn `Object.fromEntries(undefined)` runtime error

  **QA Scenarios**:
  ```
  Scenario: D1 fix — post-massAssign check works
    Tool: interactive_bash
    Steps: Kiểm tra code: Object.fromEntries dùng activeAssignments (không phải return value của refetchAssignments)
    Expected: assignedMap populated correctly
    Evidence: .omo/evidence/task-5-d1-void-fix.log
  ```

  **Commit**: NO

- [ ] 6. Migration — 20260610000000_dealer_management.sql (transaction-wrapped)

  **What to do**: Tạo file `supabase/migrations/20260610000000_dealer_management.sql`:

  ```sql
  BEGIN;

  -- 1. ALTER dealers table: add employment columns
  ALTER TABLE dealers
    ADD COLUMN IF NOT EXISTS employment_type TEXT NOT NULL DEFAULT 'full_time'
      CHECK (employment_type IN ('full_time', 'part_time')),
    ADD COLUMN IF NOT EXISTS hourly_rate_vnd INT,
    ADD COLUMN IF NOT EXISTS base_rate_vnd INT,
    ADD COLUMN IF NOT EXISTS joined_date DATE DEFAULT CURRENT_DATE,
    ADD COLUMN IF NOT EXISTS notes TEXT;

  -- 2. ALTER dealer_pay_rates: ensure overtime column exists
  ALTER TABLE dealer_pay_rates
    ADD COLUMN IF NOT EXISTS overtime_rate INT DEFAULT 0,
    ADD COLUMN IF NOT EXISTS part_time_rate INT DEFAULT 0;

  -- 3. CREATE dealer_scores VIEW (read-only, zero migration risk)
  CREATE OR REPLACE VIEW dealer_scores AS
  SELECT
    d.id AS dealer_id,
    d.full_name,
    d.tier,
    d.club_id,
    d.employment_type,
    COALESCE(SUM(dsm.total_worked_minutes), 0) / 60.0 AS total_hours,
    COALESCE(SUM(dsm.total_assignments), 0) AS total_swings,
    COALESCE(SUM(dsm.total_worked_minutes), 0) / 60.0 * 1.0
      + COALESCE(SUM(dsm.total_assignments), 0) * 0.5
      + CASE d.tier
          WHEN 'A' THEN 20
          WHEN 'B' THEN 10
          WHEN 'C' THEN 0
          ELSE 0
        END AS score
  FROM dealers d
  LEFT JOIN dealer_shift_metrics dsm ON dsm.dealer_id = d.id
    AND dsm.shift_date >= CURRENT_DATE - 30
  GROUP BY d.id, d.full_name, d.tier, d.club_id, d.employment_type;

  -- 4. RLS: mirror existing dealers policies (dealers already has RLS)
  -- dealers table RLS already exists from migration 20260522000001
  -- dealer_pay_rates inherits existing RLS

  -- 5. Index for performance
  CREATE INDEX IF NOT EXISTS idx_dealer_attendance_club_date
    ON dealer_attendance(club_id, shift_date);

  COMMIT;

  -- ROLLBACK companion (chạy nếu migration thất bại giữa chừng):
  -- DROP VIEW IF EXISTS dealer_scores;
  -- ALTER TABLE dealers DROP COLUMN IF EXISTS employment_type;
  -- ALTER TABLE dealers DROP COLUMN IF EXISTS hourly_rate_vnd;
  -- ALTER TABLE dealers DROP COLUMN IF EXISTS base_rate_vnd;
  -- ALTER TABLE dealers DROP COLUMN IF EXISTS joined_date;
  -- ALTER TABLE dealers DROP COLUMN IF EXISTS notes;
  -- ALTER TABLE dealer_pay_rates DROP COLUMN IF EXISTS overtime_rate;
  -- ALTER TABLE dealer_pay_rates DROP COLUMN IF EXISTS part_time_rate;
  -- DROP INDEX IF EXISTS idx_dealer_attendance_club_date;
  ```

  **Must NOT do**: Không xóa/xóa column cũ, chỉ ADD IF NOT EXISTS. Không dùng FUNCTION (dùng VIEW để zero migration risk)

  **References**:
  - dealers schema: `supabase/migrations/20260522000001_dealer_swing_manager.sql:113-124`
  - dealer_shift_metrics: `supabase/migrations/20260602000001_phase3_table_type_metric.sql`
  - dealer_pay_rates: `supabase/migrations/20260529000001_swing_enhancements.sql:19-72`
  - Oracle blocker #2: transaction wrapper + rollback companion

  **Acceptance Criteria**:
  - [ ] Migration apply thành công: `supabase migration up`
  - [ ] `dealer_scores` VIEW tồn tại và query được
  - [ ] columns mới xuất hiện trong dealers table
  - [ ] Nếu migration fail giữa chừng, rollback companion khôi phục được

  **QA Scenarios**:
  ```
  Scenario: Migration applies cleanly
    Tool: interactive_bash
    Steps: supabase migration up
    Expected: No errors, migration applied
    Evidence: .omo/evidence/task-6-migration.log

  Scenario: dealer_scores returns data
    Tool: interactive_bash
    Steps: SELECT * FROM dealer_scores WHERE club_id = 'xxx'
    Expected: Returns rows with score != null
    Evidence: .omo/evidence/task-6-view.log
  ```

  **Commit**: YES | `feat(dealer): migration — dealer employment columns + dealer_scores VIEW` | Files: `supabase/migrations/20260610000000_dealer_management.sql`

- [ ] 7. New hook — useDealerManagement.ts

  **What to do**: Tạo file `src/hooks/useDealerManagement.ts`

  ```typescript
  export function useAllDealers(clubIds: string[]) {
    // Query: select * from dealers where club_id IN clubIds
    // Includes: employment_type, hourly_rate_vnd, base_rate_vnd, tier, status
    // Poll 30s, no realtime
  }

  export function useDealerScore(clubId: string) {
    // Query: select * from dealer_scores where club_id = clubId
    // Returns: DealerScore[] sorted by score DESC (rank = index+1)
    // Poll 60s
  }

  export interface DealerScore {
    dealer_id: string;
    full_name: string;
    tier: string;
    club_id: string;
    employment_type: string;
    total_hours: number;
    total_swings: number;
    score: number;
  }
  ```

  **Must NOT do**: Không dùng Realtime subscription — polling 30s đủ. Không gọi RPC — query VIEW trực tiếp

  **References**:
  - Pattern: `src/hooks/useDealerSwing.ts` (polling pattern)
  - VIEW: Migration task 6 — `dealer_scores`

  **Acceptance Criteria**:
  - [ ] `useAllDealers` trả về dealers từ Supabase
  - [ ] `useDealerScore` trả về scores từ dealer_scores VIEW

  **Commit**: YES | `feat(dealer): add useDealerManagement hook` | Files: `src/hooks/useDealerManagement.ts`

- [ ] 8. New component — DealerManagementTab.tsx

  **What to do**: Tạo `src/components/cashier/DealerManagementTab.tsx`:
  - Full-width table/list layout, thay center column khi active
  - Columns: Hạng, Tên, Loại (FT/PT), Giờ làm (30-day), Điểm, Thứ hạng
  - Filter bar: Tất cả / Full-time / Part-time / Hạng A/B/C + Search input theo tên
  - Click dealer → mở DealerDetailPanel (inline hoặc modal) hiển thị stats
  - Stats: 30-day summary — total_hours, total_swings, score
  - Score cell: màu xanh cho top 3, mặc định cho còn lại

  **Must NOT do**: Không chỉnh sửa DealerSwingTab.tsx layout (sẽ add tab button riêng ở task 10)

  **References**:
  - Pattern: `src/components/cashier/DealerSwingTab.tsx` — RosterPanel, CommandCenter component patterns
  - Styling: shadcn/ui + Tailwind, dark theme #0A0A0A, emerald accent #10B981
  - Hook: task 7 — useDealerManagement

  **Acceptance Criteria**:
  - [ ] Component renders without error
  - [ ] Hiển thị danh sách dealer + filter/search hoạt động
  - [ ] Click dealer hiển thị detail panel
  - [ ] Score hiển thị đúng công thức

  **Commit**: YES | `feat(dealer): add DealerManagementTab component` | Files: `src/components/cashier/DealerManagementTab.tsx`

- [ ] 9. New component — AddDealerDialog.tsx

  **What to do**: Tạo `src/components/cashier/AddDealerDialog.tsx`:
  - Dialog form: full_name (required), tier (A/B/C select), employment_type (full_time/part_time toggle), hourly_rate_vnd, base_rate_vnd
  - Optional: phone, joined_date (default today), notes
  - On save: INSERT into dealers table dùng supabase client
  - On success: toast + refetch dealer list (gọi callback `onDealerAdded`)

  **Must NOT do**: Không gọi edge function — dùng supabase client trực tiếp (RLS đã có)

  **References**:
  - RLS: `supabase/migrations/20260522000001_dealer_swing_manager.sql:139-145` — dealers_insert_control
  - Dialog pattern: `DealerSwingTab.tsx` — TelegramConfigDialog, SwingConfigDialog

  **Acceptance Criteria**:
  - [ ] Form validate (full_name required)
  - [ ] INSERT thành công vào dealers table
  - [ ] Auto-refresh dealer list sau khi thêm

  **Commit**: YES | `feat(dealer): add AddDealerDialog` | Files: `src/components/cashier/AddDealerDialog.tsx`

- [ ] 10. Integrate DealerManagementTab vào Swing Panel

  **What to do**:
  1. Trong DealerSwingTab.tsx, thêm biến trạng thái `activeView: "roster" | "tables" | "dealers"` (mặc định "tables")
  2. Thêm nút chuyển tab trên toolbar (bên cạnh nút "BẢN ĐỒ CHIẾN TRƯỜNG" hiện tại)
  3. Khi `activeView === "dealers"`, render DealerManagementTab thay vì TableGrid
  4. Import useAllDealers + useDealerScore hooks
  5. Pass clubFilter vào DealerManagementTab

  **Must NOT do**: Không xóa RosterPanel/CommandCenter — chỉ thay TableGrid

  **References**:
  - File: `src/components/cashier/DealerSwingTab.tsx:592-729` — layout rendering
  - Component: task 8 (DealerManagementTab), task 9 (AddDealerDialog)

  **Acceptance Criteria**:
  - [ ] Tab switching hoạt động (roster ↔ tables ↔ dealers)
  - [ ] Dealer tab hiển thị đúng club đang filter
  - [ ] AddDealerDialog có thể mở từ toolbar

  **Commit**: YES | `feat(dealer): integrate DealerManagementTab into SwingPanel` | Files: `src/components/cashier/DealerSwingTab.tsx`

- [ ] 11. Update payroll export

  **What to do**: Sửa `doExportPayrollCsv` trong DealerSwingTab.tsx (dòng 574-588):
  - Query `dealer_scores` VIEW thay vì gọi `get_shift_payroll_summary`
  - Thêm columns: employment_type, hourly_rate_vnd, base_rate_vnd
  - Tính lương part-time: total_hours × hourly_rate_vnd
  - Tính lương full-time: base_rate_vnd (fixed từ dealers table)
  - OT: nếu total_hours > 160/tháng, OT = (total_hours - 160) × hourly_rate_vnd × 1.5

  **Must NOT do**: Không xóa `get_shift_payroll_summary` — có thể vẫn dùng cho shift-level

  **References**:
  - File: `src/components/cashier/DealerSwingTab.tsx:574-588`
  - VIEW: task 6 — `dealer_scores`
  - Hook: task 7 — useDealerScore

  **Acceptance Criteria**:
  - [ ] Export CSV có columns mới (employment_type, hourly_rate, base_rate, pay_estimate)
  - [ ] Lương part-time tính đúng theo giờ
  - [ ] Lương full-time tính base_rate cố định

  **Commit**: YES | `feat(dealer): update payroll export with dealer_scores VIEW` | Files: `src/components/cashier/DealerSwingTab.tsx`

- [ ] 12. Auto-assign dealer khi activate bàn từ pool

  **What to do**: Trong DealerSwingTab.tsx, sau khi activate bàn từ pool dialog (dòng ~993-997 `game_tables.update({status: "active"})`):
  1. Gọi `massAssign()` từ useDealerSwing hook để fill nhanh
  2. Show toast "Đang gán dealer cho bàn mới..."
  3. Nếu massAssign trả về assigned > 0, toast "Đã gán X bàn trống"

  **Must NOT do**: Không tạo DB trigger — gọi từ frontend để dễ debug

  **References**:
  - File: `src/components/cashier/DealerSwingTab.tsx:976-1009`
  - Hook: `useDealerSwing.massAssign`

  **Acceptance Criteria**:
  - [ ] Sau khi activate table từ pool, dealer được gán tự động (toast "Đã gán X bàn trống")

  **Commit**: YES | `fix(swing): auto-assign dealer on table activation` | Files: `src/components/cashier/DealerSwingTab.tsx`

## Deploy Strategy (CRITICAL — Oracle Blocker #1)
> Wave 2 phải deploy CẢ 3 edge functions ĐỒNG THỜI vì `dealer-utils.ts` là shared module được bundle vào mỗi function tại deploy time.

**Command duy nhất cho Wave 2 deploy:**
```bash
supabase functions deploy mass-assign process-swing assign-dealer
```

**Sau đó apply migration:**
```bash
supabase migration up
```

Không deploy tuần tự. Không deploy lẻ từng function. Cả 3 trong 1 lệnh.

## Final Verification Wave (MANDATORY)
- [ ] F1. Plan Compliance Audit — oracle (verify all 12 TODOs completed per spec)
- [ ] F2. Code Quality Review — unspecified-high
- [ ] F3. Real Manual QA — playwright: test swing flow + dealer CRUD
- [ ] F4. Scope Fidelity Check — deep (no scope creep)

## Commit Strategy
> **Squash strategy**: Wave 1-2 (bug fixes) → 1 commit. Wave 3-4 (dealer feature) → 1 commit per file.

| Commit | Wave | Message | Files |
|--------|------|---------|-------|
| 1 | 1-2 | `fix(swing): 6 bugs — assign RPC check, club_id, property names, force_all filter, refetch void` | dealer-utils.ts, mass-assign/index.ts, process-swing/index.ts, DealerSwingTab.tsx |
| 2 | 3 | Migration SQL | 20260610000000_dealer_management.sql |
| 3 | 3 | `feat(dealer): management tab + hooks + dialogs` | useDealerManagement.ts, DealerManagementTab.tsx, AddDealerDialog.tsx |
| 4 | 4 | `feat(dealer): integrate tab into SwingPanel, update payroll` | DealerSwingTab.tsx |
| 5 | 4 | `fix(swing): auto-assign on table activation` | DealerSwingTab.tsx |

## Success Criteria
1. ✅ Auto-swing toggle → gán dealer vào bàn trống thành công (không còn "0 bàn trống")
2. ✅ Force Swing All → không timeout, xử lý tất cả bàn
3. ✅ Tab "Danh sách Dealer" hiển thị đủ dealer + stats + score
4. ✅ Thêm dealer mới thành công từ dialog (full_name, tier, employment_type)
5. ✅ Payroll export có employment_type + lương đúng loại (PT=hourly, FT=base)
6. ✅ Khi mở bàn từ pool → dealer tự động được gán
