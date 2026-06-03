# PLAN: VinPoker Payroll System — Tóm tắt để review

## 1. Tổng quan

Payroll tính lương dealer theo tháng. Hỗ trợ 2 loại:
- **Full-time (FT)**: lương theo ca/ngày (`base_rate_vnd`) + OT
- **Part-time (PT)**: lương theo giờ (`hourly_rate_vnd`) + OT

---

## 2. Frontend

### 2.1 Components

| File | Vai trò |
|------|---------|
| `DealerPayrollTab.tsx` | Tab chính hiển thị bảng lương, cho phép chọn tháng, lưu, thêm điều chỉnh, xuất Excel |
| `QuickLinksCard.tsx` | Nút "Xuất bảng lương" trong CommandCenter |
| `DealerAdjustDialog.tsx` | Dialog chỉnh sửa dealer (có tab Payroll với hourly_rate, base_rate, monthly_salary) |
| `AddDealerDialog.tsx` | Dialog thêm dealer (có trường Payroll) |

### 2.2 Hook — `useDealerPayroll.ts`

```
useDealerPayroll(clubIds) → { data, period, loading, error, fetchPayroll }
  └─ fetchPayroll(clubId, start, end)
      └─ RPC: calculate_club_payroll(p_club_id, p_start_date, p_end_date)
```

**Helpers:**
- `savePayroll(clubId, year, month, rows, userId)` → lưu vào `payroll_periods` + `dealer_payroll`
- `getSavedPayroll(clubId, year, month)` → lấy bảng lương đã lưu
- `addPayrollAdjustment(payrollId, type, amount, reason, userId)` → thêm điều chỉnh
- `loadPayrollAdjustments(periodId)` → lấy adjustments
- `deletePayrollAdjustment(id)` → xóa điều chỉnh

### 2.3 UI Flow

```
User chọn Tháng + CLB
    ↓
Gọi fetchPayroll() → RPC trả về rows
    ↓
Hiển thị bảng: Tên | Loại | Ca | Tổng giờ | Giờ chuẩn | Giờ OT | Lương cơ bản | Lương thường | Lương OT | Tổng gộp | Điều chỉnh | Thực lãnh
    ↓
User bấm "Lưu bảng lương" → savePayroll() → tạo payroll_period + dealer_payroll rows
    ↓
Sau khi lưu: có thể thêm điều chỉnh (Bonus, Penalty, Deduction, Advance, Other)
    ↓
Xuất Excel nếu cần
```

---

## 3. Backend

### 3.1 RPC chính — `calculate_club_payroll`

File: `supabase/migrations/20260612000002_fix_get_dealer_payroll.sql` (rewrite của `get_dealer_payroll`)

**Logic tính:**

```
Part-time:
  total_hours = SUM(net_hours per day, capped at 16h/day)
  net_hours = (effective_checkout - check_in) - break_duration
  effective_checkout = LEAST(check_out_time, end_of_day)  ← cap để tránh shift chưa đóng
  base_pay = total_hours × hourly_rate_vnd
  overtime_pay = overtime_minutes / 60 × hourly_rate_vnd × 1.5
  total_pay = base_pay + overtime_pay

Full-time (có base_rate_vnd):
  base_pay = days_worked × base_rate_vnd
  overtime_pay = overtime_minutes / 60 × hourly_rate_vnd × 1.5
  total_pay = base_pay + overtime_pay

Full-time (không có base_rate_vnd):
  base_pay = total_hours × hourly_rate_vnd  ← fallback
  overtime_pay = như trên
```

**Defaults:**
- `v_min_hourly_rate` = 50,000 VND
- `v_min_base_rate` = 200,000 VND
- `v_max_daily_hours` = 16 giờ

### 3.2 Database Schema

| Bảng | Cột chính | Mô tả |
|------|-----------|-------|
| `dealers` | `employment_type`, `hourly_rate_vnd`, `base_rate_vnd`, `monthly_salary_vnd` | Thông tin lương của dealer |
| `dealer_attendance` | `check_in_time`, `check_out_time`, `overtime_minutes`, `shift_date` | Dữ liệu chấm công |
| `dealer_breaks` | `break_start`, `break_end`, `expected_duration_minutes` | Thời gian nghỉ (trừ vào giờ làm) |
| `dealer_assignments` | `status`, `assigned_at`, `ended_at` | Gán bàn (đếm số swing) |
| `payroll_periods` | `club_id`, `period_year`, `period_month`, `period_start`, `period_end`, `status` | Kỳ lương |
| `dealer_payroll` | `dealer_id`, `period_id`, `employment_type`, `total_shifts`, `total_hours`, `regular_hours`, `ot_hours`, `base_salary_vnd`, `regular_pay_vnd`, `ot_pay_vnd`, `gross_pay_vnd`, `total_adjustments_vnd`, `net_pay_vnd`, `status` | Dòng lương đã lưu |
| `payroll_adjustments` | `payroll_id`, `adjustment_type`, `amount_vnd`, `reason` | Điều chỉnh lương |

### 3.3 View — `dealer_scores`

```sql
Score = total_hours×1 + total_swings×0.5 + tier_bonus(A=20, B=10)
```
Dùng để xếp hạng dealer, có thêm `hourly_rate_vnd` và `base_rate_vnd`.

---

## 4. Data Flow

```
[DB] dealers (rates) + dealer_attendance (attendance) + dealer_breaks (breaks) + dealer_assignments (swings)
    ↓
[RPC] calculate_club_payroll(p_club_id, start, end)
    ↓
[Frontend] DealerPayrollTab hiển thị rows
    ↓
[User] Bấm "Lưu" → savePayroll() → INSERT/UPDATE payroll_periods + dealer_payroll
    ↓
[User] Thêm điều chỉnh → addPayrollAdjustment() → INSERT payroll_adjustments
    ↓
[Frontend] Recalculate net_pay = gross_pay + adjustments
```

---

## 5. Công thức tính chi tiết

### 5.1 Giờ làm thực tế

```
net_hours_per_day = LEAST(
  (effective_checkout - check_in) - total_break_duration,
  16  // cap
)

effective_checkout = LEAST(check_out_time, midnight_next_day)
```

### 5.2 Lương

| Loại | Công thức |
|------|-----------|
| **PT base** | `total_hours × hourly_rate_vnd` |
| **FT base (có base_rate)** | `days_worked × base_rate_vnd` |
| **FT base (không base_rate)** | `total_hours × hourly_rate_vnd` |
| **OT** | `overtime_minutes / 60 × hourly_rate_vnd × 1.5` |
| **Tổng** | `base + OT` |

### 5.3 Điều chỉnh

| Type | Ảnh hưởng |
|------|-----------|
| BONUS, OTHER | `+amount` |
| PENALTY, DEDUCTION, ADVANCE | `-amount` |

```
net_pay = gross_pay + SUM(adjustments)
```

---

## 6. Files liên quan

```
Frontend:
  src/hooks/useDealerPayroll.ts                    ← Hook chính
  src/components/cashier/DealerPayrollTab.tsx        ← UI chính
  src/components/cashier/DealerAdjustDialog.tsx      ← Chỉnh sửa dealer (tab Payroll)
  src/components/cashier/AddDealerDialog.tsx           ← Thêm dealer (tab Payroll)
  src/components/cashier/command-center/QuickLinksCard.tsx  ← Nút xuất payroll

Backend:
  supabase/migrations/20260611000000_payroll_system.sql              ← View + function ban đầu
  supabase/migrations/20260612000002_fix_get_dealer_payroll.sql       ← Rewrite function (hiện tại)
  supabase/migrations/20260610000000_dealer_management.sql             ← ALTER dealers thêm pay rates
  supabase/migrations/20260612000001_fix_seed_dealers_payroll.sql      ← Seed data
```

---

## 7. Ghi chú

- `calculate_club_payroll` (frontend gọi) chính là `get_dealer_payroll` (trong DB) — đã được rewrite trong migration 20260612.
- Dữ liệu attendance dùng `shift_date` để filter, không phải `created_at`.
- Shift chưa đóng (`check_out_time IS NULL`) được cap về midnight của ngày hôm sau để tránh giờ làm bị độn.
- Mỗi tháng chỉ có 1 `payroll_period` per club (unique constraint `club_id, period_year, period_month`).
