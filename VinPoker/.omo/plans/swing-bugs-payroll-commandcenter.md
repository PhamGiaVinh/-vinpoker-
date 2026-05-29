# SDD Plan: Swing Bugs + Payroll + CommandCenter Redesign

## Phase 0 — Bug Fixes

### Bug 1: DEALER_NOT_CHECKED_IN on manual assign
**File**: `supabase/functions/assign-dealer/index.ts`
**Line**: 88-90
**Cause**: `shift_id` filter added to `force_dealer_id` path but NOT in suggestions query (`buildDealerCandidates`)
**Fix**: Remove `if (shift_id) query.eq("shift_id", shift_id)` at line 90
**Why safe**: `buildDealerCandidates` already finds dealers with `status='checked_in'` AND `current_state='available'` without shift_id filter. The shift_id on attendance is a grouping property, not an availability constraint.

### Bug 2: "Không có dealer khả dụng" when enabling auto-swing
**File**: `src/components/cashier/DealerSwingTab.tsx`
**Lines**: 489-495, 496-504
**Cause**: Re-check-in doesn't reset `current_state` → stays `"checked_out"` → `buildDealerCandidates` requires `current_state = "available"`
**Fix**: 
- Line 493: Add `current_state: "available"` to UPDATE payload
- Line 497-502: Add `current_state: "available"` to UPSERT payload

### Bonus Fix: `buildDealerCandidates` no date filter
**File**: `supabase/functions/_shared/dealer-utils.ts`
**Lines**: 134-136
**Issue**: No `shift_date` filter → dealers from previous days with stale `status='checked_in'` appear
**Fix**: Add `.eq("shift_date", today)` using `club_local_date` RPC (minor, non-critical)

---

## Phase 1 — Payroll System

### 1A. Migration: Update `dealer_scores` VIEW
**File**: `supabase/migrations/20260611000000_payroll_system.sql`
```sql
-- Add payroll columns to dealer_scores VIEW:
-- - total_overtime_minutes (SUM from dealer_attendance last 30 days)
-- - total_base_pay: hours * hourly_rate (PT) or base_rate (FT)
-- - total_overtime_pay: overtime_hours * hourly_rate * 1.5
-- - employment_type, hourly_rate_vnd, base_rate_vnd from dealers table
-- Keep 30-day window, add today-only variant
```

### 1B. Payroll UI in DealerSwingTab.tsx
- Create `PayrollTab.tsx` component (or expand existing payroll dialog)
- **Filters**: "Hôm nay", "Tháng này", "Tùy chỉnh" date range
- **Table columns**: Dealer, Hạng, Loại HĐ, Giờ làm, Giờ tăng ca, Lương CB, Lương OT, Tổng lương
- **Summary row**: SUM all columns at bottom
- **CSV Export**: Same columns, filter-aware
- **Adjustment Form**: Dialog to edit dealer's `employment_type`, `hourly_rate_vnd`, `base_rate_vnd`, `tier`

### 1C. Dealer Adjustment Dialog
- Opens from Payroll tab or DealerManagementTab
- Fields: tier (A/B/C), employment_type (full_time/part_time), hourly_rate_vnd, base_rate_vnd
- Supabase UPDATE on `dealers` table
- Toast confirmation

---

## Phase 2 — CommandCenter Redesign

### 2A. Current State
File: `DealerSwingTab.tsx:1587-1740`
All buttons flat in one column. No grouping, no confirmation.

### 2B. New Layout (4 groups with dividers)

**Group 1 — "Vận hành nền"**
- Auto-Swing toggle + current duration display
- Auto-Swing All button (when toggle is OFF, show "Chạy Auto Swing 1 lần")

**Group 2 — "Thao tác thường xuyên"**  
- "Swing thủ công": opens dialog → select a table → calls process-swing with that table_id
- "Xem lịch swing": opens upcoming swings calendar

**Group 3 — "Đầu ca / Cuối ca"**
- Mass Assign
- Xuất báo cáo ca
- Xuất bảng lương

**Group 4 — "Khẩn cấp"** (red #EF4444)
- Force Swing All — có confirm popup trước khi chạy
- Dừng toàn bộ Swing — set auto_swing_enabled=false trong club_settings

### 2C. Force Swing All Confirm Dialog
```tsx
<AlertDialog>
  <AlertDialogTrigger>Force Swing All</AlertDialogTrigger>
  <AlertDialogContent>
    <AlertDialogTitle>Xác nhận Force Swing?</AlertDialogTitle>
    <AlertDialogDescription>
      Hành động này sẽ force swing TẤT CẢ bàn, bỏ qua timing.
    </AlertDialogDescription>
    <AlertDialogAction>Xác nhận</AlertDialogAction>
    <AlertDialogCancel>Huỷ</AlertDialogCancel>
  </AlertDialogContent>
</AlertDialog>
```

### 2D. Stop Auto Swing
- Nút màu đỏ, gọi `supabase.from("club_settings").upsert({ club_id, auto_swing_enabled: false })`
- Toast xác nhận

### 2E. Manual Swing Dialog
- Opens dialog with list of active tables
- Select one table → call `process-swing` with `force_all=false, table_id=selectedTableId`
- Only works for tables with active assignments

---

## Implementation Order

1. **Bug fixes** (2 files, 5 lines total)
2. **Payroll migration** (1 SQL file)
3. **Payroll UI** (payroll dialog expansion in DealerSwingTab.tsx + DealerManagementTab adjustment form)
4. **CommandCenter redesign** (DealerSwingTab.tsx, heavy edit)
5. **Deploy edge functions** (assign-dealer)
6. **Apply migration** (supabase db push)
7. **Build + Vercel deploy**
8. **QA**

## Files to Change
```
supabase/functions/assign-dealer/index.ts          — Bug 1
src/components/cashier/DealerSwingTab.tsx          — Bug 2 + Payroll UI + CommandCenter
src/components/cashier/DealerManagementTab.tsx     — Adjustment form link
src/components/cashier/DealerAdjustDialog.tsx      — NEW: adjustment form
supabase/functions/_shared/dealer-utils.ts         — Bonus: date filter
supabase/migrations/20260611000000_payroll_system.sql  — NEW: payroll VIEW
```
