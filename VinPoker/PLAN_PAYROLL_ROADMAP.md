# VinPoker Payroll — Implementation Roadmap

> Dựa trên review của senior dev + kế toán. Mapping từng issue sang file/schema cụ thể cần sửa.

---

## Current State Snapshot

### Files đã xác định

| File | Vai trò | Dòng |
|------|---------|------|
| `src/hooks/useDealerPayroll.ts` | Hook chính: fetch, save, adjustments | 272 |
| `src/components/cashier/DealerPayrollTab.tsx` | UI bảng lương | 624 |
| `supabase/migrations/20260612000002_fix_get_dealer_payroll.sql` | RPC `get_dealer_payroll` | 146 |
| `supabase/migrations/20260611000000_payroll_system.sql` | View `dealer_scores` + old RPC | 134 |

### Schema hiện tại (inferred từ TypeScript + code)

**payroll_periods:** `id, club_id, period_year, period_month, period_start, period_end, status`  
→ `status` chỉ có giá trị `"draft"` (hardcoded). Không có `approved_by`, `approved_at`, `locked_at`, `locked_by`.

**dealer_payroll:** `id, dealer_id, club_id, period_id, employment_type, monthly_salary_vnd, hourly_rate_vnd, ot_multiplier, total_shifts, total_hours, regular_hours, ot_hours, base_salary_vnd, regular_pay_vnd, ot_pay_vnd, gross_pay_vnd, total_adjustments_vnd, net_pay_vnd, status, calculated_by, calculated_at`  
→ Thiếu: `tips_amount_vnd`, `taxable_income_vnd`, `tax_deduction_vnd`, `net_pay_after_tax_vnd`, `approved_by`, `approved_at`.

**payroll_adjustments:** `id, payroll_id, adjustment_type, amount_vnd, reason, created_by, approved_by, created_at`  
→ Thiếu `TIPS` trong `adjustment_type`. Không có audit trail cho update/delete.

### UI hiện tại

- Toolbar: Chọn CLB + Tháng → Làm mới → Xuất Excel → **Lưu bảng lương** → badge "Đã lưu ✓"
- Không có: status flow, summary strip, filter pills, tips column, approval buttons, audit log viewer
- Save flow: `upsert payroll_period` → `delete dealer_payroll` → `insert dealer_payroll` (3 call riêng biệt, **không transaction**)

### RPC hiện tại (`get_dealer_payroll`)

- Tính giờ: `effective_checkout = LEAST(check_out, midnight_next_day)` → **cap ở midnight, không split sang ngày hôm sau**
- Không có tips, không có tax/BHXH

---

## P0 — MUST FIX trước khi chạy data thật (Data Loss + Security)

### P0.1 Bug 2 — DELETE dealer_payroll cascade xóa adjustments

**🔴 Critical — mất data không recover được**

RPC `save_payroll_period` có:
```sql
DELETE FROM dealer_payroll WHERE period_id = v_period_id;
INSERT INTO dealer_payroll (...) -- rows mới
```

Nếu `payroll_adjustments` có FK → `dealer_payroll.id`, DELETE cascade xóa toàn bộ adjustments đã nhập tay.

**Fix:** Thay DELETE+INSERT bằng UPSERT (`ON CONFLICT DO UPDATE`).

```sql
-- 3. Upsert dealer_payroll rows (thay vì DELETE + INSERT)
FOR v_row IN SELECT * FROM jsonb_array_elements(p_payroll_rows) LOOP
  INSERT INTO dealer_payroll (
    dealer_id, club_id, period_id, employment_type, monthly_salary_vnd,
    hourly_rate_vnd, ot_multiplier, total_shifts, total_hours, regular_hours,
    ot_hours, base_salary_vnd, regular_pay_vnd, ot_pay_vnd, gross_pay_vnd,
    net_pay_vnd, status, calculated_by
  ) VALUES (
    (v_row->>'dealer_id')::UUID, p_club_id, v_period_id,
    v_row->>'employment_type', (v_row->>'monthly_salary_vnd')::NUMERIC,
    (v_row->>'hourly_rate_vnd')::NUMERIC, (v_row->>'ot_multiplier')::NUMERIC,
    (v_row->>'total_shifts')::INT, (v_row->>'total_hours')::NUMERIC,
    (v_row->>'regular_hours')::NUMERIC, (v_row->>'ot_hours')::NUMERIC,
    (v_row->>'base_salary_vnd')::NUMERIC, (v_row->>'regular_pay_vnd')::NUMERIC,
    (v_row->>'ot_pay_vnd')::NUMERIC, (v_row->>'gross_pay_vnd')::NUMERIC,
    (v_row->>'net_pay_vnd')::NUMERIC, 'draft', p_user_id
  )
  ON CONFLICT (period_id, dealer_id) DO UPDATE SET
    employment_type = EXCLUDED.employment_type,
    monthly_salary_vnd = EXCLUDED.monthly_salary_vnd,
    hourly_rate_vnd = EXCLUDED.hourly_rate_vnd,
    ot_multiplier = EXCLUDED.ot_multiplier,
    total_shifts = EXCLUDED.total_shifts,
    total_hours = EXCLUDED.total_hours,
    regular_hours = EXCLUDED.regular_hours,
    ot_hours = EXCLUDED.ot_hours,
    base_salary_vnd = EXCLUDED.base_salary_vnd,
    regular_pay_vnd = EXCLUDED.regular_pay_vnd,
    ot_pay_vnd = EXCLUDED.ot_pay_vnd,
    gross_pay_vnd = EXCLUDED.gross_pay_vnd,
    net_pay_vnd = EXCLUDED.net_pay_vnd,
    status = EXCLUDED.status,
    calculated_by = EXCLUDED.calculated_by,
    updated_at = now();
END LOOP;

-- 4. Delete dealer_payroll rows KHÔNG có trong p_payroll_rows
-- (dealer bị inactive hoặc removed khỏi kỳ lương)
DELETE FROM dealer_payroll
WHERE period_id = v_period_id
  AND dealer_id NOT IN (
    SELECT (elem->>'dealer_id')::UUID
    FROM jsonb_array_elements(p_payroll_rows) AS elem
  );
```

**Thêm unique constraint để ON CONFLICT hoạt động:**
```sql
ALTER TABLE dealer_payroll
  ADD CONSTRAINT dealer_payroll_period_dealer_unique UNIQUE (period_id, dealer_id);
```

---

### P0.2 Bug 1 — `auth.uid()` trong trigger trả về NULL

**🔴 Critical — audit log không ghi được người thay đổi**

Khi trigger chạy trong context `SECURITY DEFINER` RPC, `auth.uid()` = NULL.

**Fix:**
```sql
-- Trong save_payroll_period, trước khi UPSERT:
PERFORM set_config('app.current_user_id', p_user_id::TEXT, TRUE);

-- Trong fn_audit_trigger():
changed_by := COALESCE(
  auth.uid(),
  NULLIF(current_setting('app.current_user_id', TRUE), '')::UUID
);
```

---

### P0.3 Gap 1 — Không có RLS (Row-Level Security)

**🔴 Critical — club này nhìn thấy lương club khác**

```sql
ALTER TABLE dealer_payroll ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll_adjustments ENABLE ROW LEVEL SECURITY;

CREATE POLICY payroll_club_isolation ON dealer_payroll
  USING (club_id IN (
    SELECT club_id FROM club_members WHERE user_id = auth.uid()
  ));

CREATE POLICY audit_log_club_isolation ON payroll_audit_log
  USING (club_id IN (
    SELECT club_id FROM club_members WHERE user_id = auth.uid()
  ));
  -- NOTE: cần thêm club_id vào payroll_audit_log
```

---

## P1 — Critical (Phải fix trước khi production)

### 1.1 Approval Workflow — Status Machine

**Vấn đề:** Bất kỳ ai cũng có thể `savePayroll()` → overwrite data. Không có quy trình duyệt.

**Schema changes:**

```sql
-- payroll_periods: thêm cột
ALTER TABLE payroll_periods
  ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS submitted_by UUID REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS locked_by UUID REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS locked_at TIMESTAMPTZ;

-- Nếu chưa có enum, tạo check constraint
ALTER TABLE payroll_periods
  DROP CONSTRAINT IF EXISTS chk_payroll_status,
  ADD CONSTRAINT chk_payroll_status
    CHECK (status IN ('draft', 'submitted', 'approved', 'locked'));
```

**Code changes:**

| File | Line | Change |
|------|------|--------|
| `useDealerPayroll.ts` | 140-148 | Thêm `submitted_by`, `submitted_at` khi upsert period. Tách `submitPayroll()` và `approvePayroll()` helpers. |
| `useDealerPayroll.ts` | 169-187 | `savePayroll()` → wrap trong transaction RPC mới `save_payroll_period` (bên dưới). |
| `DealerPayrollTab.tsx` | 388-399 | Thay thế "Lưu bảng lương" + "Đã lưu ✓" bằng status flow UI: DRAFT → SUBMIT → APPROVE → LOCK. |
| `DealerPayrollTab.tsx` | 564-621 | Dialog "Thêm điều chỉnh" → disable nếu status = `locked`. |

**RPC mới:**

```sql
-- RPC: save_payroll_period (transaction-safe)
CREATE OR REPLACE FUNCTION save_payroll_period(
  p_club_id UUID,
  p_year INT,
  p_month INT,
  p_start_date DATE,
  p_end_date DATE,
  p_payroll_rows JSONB,  -- array of dealer_payroll rows
  p_user_id UUID
)
RETURNS UUID  -- period_id
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_period_id UUID;
  v_row JSONB;
BEGIN
  -- 1. Lock period row (SELECT FOR UPDATE)
  SELECT id INTO v_period_id
  FROM payroll_periods
  WHERE club_id = p_club_id AND period_year = p_year AND period_month = p_month
  FOR UPDATE;

  -- 2. Nếu chưa có → insert, nếu có → check status không phải locked
  IF v_period_id IS NULL THEN
    INSERT INTO payroll_periods (club_id, period_year, period_month, period_start, period_end, status, calculated_by)
    VALUES (p_club_id, p_year, p_month, p_start_date, p_end_date, 'draft', p_user_id)
    RETURNING id INTO v_period_id;
  ELSE
    -- Nếu đã locked → reject
    IF EXISTS (SELECT 1 FROM payroll_periods WHERE id = v_period_id AND status = 'locked') THEN
      RAISE EXCEPTION 'Payroll period is locked and cannot be modified';
    END IF;
  END IF;

  -- 3. Delete old dealer_payroll rows
  DELETE FROM dealer_payroll WHERE period_id = v_period_id;

  -- 4. Insert new rows
  FOR v_row IN SELECT * FROM jsonb_array_elements(p_payroll_rows) LOOP
    INSERT INTO dealer_payroll (
      dealer_id, club_id, period_id, employment_type, monthly_salary_vnd,
      hourly_rate_vnd, ot_multiplier, total_shifts, total_hours, regular_hours,
      ot_hours, base_salary_vnd, regular_pay_vnd, ot_pay_vnd, gross_pay_vnd,
      net_pay_vnd, status, calculated_by
    ) VALUES (
      (v_row->>'dealer_id')::UUID, p_club_id, v_period_id,
      v_row->>'employment_type', (v_row->>'monthly_salary_vnd')::NUMERIC,
      (v_row->>'hourly_rate_vnd')::NUMERIC, (v_row->>'ot_multiplier')::NUMERIC,
      (v_row->>'total_shifts')::INT, (v_row->>'total_hours')::NUMERIC,
      (v_row->>'regular_hours')::NUMERIC, (v_row->>'ot_hours')::NUMERIC,
      (v_row->>'base_salary_vnd')::NUMERIC, (v_row->>'regular_pay_vnd')::NUMERIC,
      (v_row->>'ot_pay_vnd')::NUMERIC, (v_row->>'gross_pay_vnd')::NUMERIC,
      (v_row->>'net_pay_vnd')::NUMERIC, 'draft', p_user_id
    );
  END LOOP;

  RETURN v_period_id;
END;
$$;
```

---

### 1.2 Audit Trail

**Vấn đề:** Kế toán không biết ai sửa gì, lúc nào, từ bao nhiêu thành bao nhiêu.

**Schema changes:**

```sql
CREATE TABLE IF NOT EXISTS payroll_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  table_name TEXT NOT NULL,              -- 'dealer_payroll' | 'payroll_adjustments' | 'payroll_periods'
  record_id UUID NOT NULL,               -- ID của row bị thay đổi
  action TEXT NOT NULL,                  -- 'INSERT' | 'UPDATE' | 'DELETE'
  old_values JSONB,                      -- Toàn bộ old row (UPDATE/DELETE)
  new_values JSONB,                      -- Toàn bộ new row (INSERT/UPDATE)
  changed_by UUID REFERENCES auth.users(id),
  changed_at TIMESTAMPTZ DEFAULT now(),
  reason TEXT                            -- Optional: lý do thay đổi
);

CREATE INDEX IF NOT EXISTS idx_audit_log_record ON payroll_audit_log(table_name, record_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_changed_at ON payroll_audit_log(changed_at);
```

**Triggers:**

```sql
-- Generic audit trigger function
CREATE OR REPLACE FUNCTION fn_audit_trigger()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    INSERT INTO payroll_audit_log (table_name, record_id, action, old_values, changed_by)
    VALUES (TG_TABLE_NAME, OLD.id, 'DELETE', to_jsonb(OLD), auth.uid());
    RETURN OLD;
  ELSIF TG_OP = 'UPDATE' THEN
    INSERT INTO payroll_audit_log (table_name, record_id, action, old_values, new_values, changed_by)
    VALUES (TG_TABLE_NAME, NEW.id, 'UPDATE', to_jsonb(OLD), to_jsonb(NEW), auth.uid());
    RETURN NEW;
  ELSIF TG_OP = 'INSERT' THEN
    INSERT INTO payroll_audit_log (table_name, record_id, action, new_values, changed_by)
    VALUES (TG_TABLE_NAME, NEW.id, 'INSERT', to_jsonb(NEW), auth.uid());
    RETURN NEW;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Attach triggers
DROP TRIGGER IF EXISTS trg_dealer_payroll_audit ON dealer_payroll;
CREATE TRIGGER trg_dealer_payroll_audit
  AFTER INSERT OR UPDATE OR DELETE ON dealer_payroll
  FOR EACH ROW EXECUTE FUNCTION fn_audit_trigger();

DROP TRIGGER IF EXISTS trg_payroll_adjustments_audit ON payroll_adjustments;
CREATE TRIGGER trg_payroll_adjustments_audit
  AFTER INSERT OR UPDATE OR DELETE ON payroll_adjustments
  FOR EACH ROW EXECUTE FUNCTION fn_audit_trigger();

DROP TRIGGER IF EXISTS trg_payroll_periods_audit ON payroll_periods;
CREATE TRIGGER trg_payroll_periods_audit
  AFTER UPDATE ON payroll_periods
  FOR EACH ROW EXECUTE FUNCTION fn_audit_trigger();
```

**Code changes:**

| File | Change |
|------|--------|
| `useDealerPayroll.ts` | Thêm `getAuditLog(recordId, limit?)` helper |
| `DealerPayrollTab.tsx` | Thêm nút "Lịch sử thay đổi" → mở Dialog hiển thị audit log (dạng timeline) |

---

### 1.3 Race Condition — Transaction RPC

**Vấn đề:** `savePayroll()` trong hook hiện tại:

```typescript
// useDealerPayroll.ts lines 140-187
// 1. upsert payroll_period        ← call 1
// 2. delete dealer_payroll        ← call 2
// 3. insert dealer_payroll      ← call 3
```

Nếu 2 manager bấm save cùng lúc → data corrupt (1 upsert thắng, 2 delete/insert lẫn lộn).

**Fix:** Dùng RPC `save_payroll_period` ở mục 1.1 — wrap toàn bộ trong 1 transaction với `SELECT FOR UPDATE`. Frontend gọi 1 RPC thay vì 3 call.

**Code changes:**

| File | Line | Change |
|------|------|--------|
| `useDealerPayroll.ts` | 129-187 | Rewrite `savePayroll()` để gọi RPC `save_payroll_period` thay vì 3 call riêng |

---

## P2 — Important (Góc kế toán, nên có trong sprint 2)

### 2.1 Shift qua midnight — Split by date

**Vấn đề:** Dealer làm 22:00–02:00. RPC hiện tại:

```sql
-- get_dealer_payroll lines 51-54
effective_checkout = LEAST(check_out, midnight_next_day)
```

→ Chỉ tính 2 giờ (22:00–00:00), mất 2 giờ (00:00–02:00) của ngày hôm sau.

**Fix:** Trong CTE `attendance_hours`, split shift thành 2 records khi `check_out.date > check_in.date`.

```sql
-- Trong CTE attendance_hours, thay vì 1 row per attendance,
-- tạo ra 1 row per date segment:

WITH attendance_segments AS (
  SELECT
    da.id AS attendance_id,
    da.dealer_id,
    da.shift_date AS segment_date,
    da.check_in_time,
    -- Segment 1: check_in → midnight (hoặc checkout nếu cùng ngày)
    CASE
      WHEN DATE(da.check_in_time) = DATE(COALESCE(da.check_out_time, da.shift_date + 1))
        THEN COALESCE(da.check_out_time, da.shift_date + 1)
      ELSE (da.shift_date + 1)::TIMESTAMPTZ
    END AS segment_end,
    da.overtime_minutes,
    -- prorate OT: nếu split, chia theo tỷ lệ giờ
    ...
  FROM dealer_attendance da
  WHERE ...

  UNION ALL

  -- Segment 2: midnight → checkout (nếu qua ngày)
  SELECT
    da.id,
    da.dealer_id,
    (da.shift_date + 1)::DATE AS segment_date,
    (da.shift_date + 1)::TIMESTAMPTZ AS check_in_time,
    COALESCE(da.check_out_time, da.shift_date + 2) AS segment_end,
    0 AS overtime_minutes,  -- OT thuộc về ngày checkout
    ...
  FROM dealer_attendance da
  WHERE da.check_out_time IS NOT NULL
    AND DATE(da.check_out_time) > DATE(da.check_in_time)
)
```

**Code changes:**

| File | Change |
|------|--------|
| `supabase/migrations/20260612000002_fix_get_dealer_payroll.sql` (hoặc migration mới) | Rewrite CTE `attendance_hours` → `attendance_segments` với split logic |

---

### 2.2 Tax + BHXH (Compliance Việt Nam)

**Vấn đề:** Hiện chỉ tính `gross_pay`. Thiếu:
- BHXH (8%)
- BHYT (1.5%)
- BHTN (1%)
- PIT (Thuế TNCN theo bậc lũy tiến)

**Schema changes:**

```sql
ALTER TABLE dealer_payroll
  ADD COLUMN IF NOT EXISTS tips_amount_vnd NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS taxable_income_vnd NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS bhxh_deduction_vnd NUMERIC DEFAULT 0,   -- 8%
  ADD COLUMN IF NOT EXISTS bhyt_deduction_vnd NUMERIC DEFAULT 0,    -- 1.5%
  ADD COLUMN IF NOT EXISTS bhtn_deduction_vnd NUMERIC DEFAULT 0,    -- 1%
  ADD COLUMN IF NOT EXISTS pit_deduction_vnd NUMERIC DEFAULT 0,   -- Thuế TNCN
  ADD COLUMN IF NOT EXISTS net_pay_after_tax_vnd NUMERIC DEFAULT 0;
```

**Logic tính (trong RPC hoặc helper):**

```typescript
// gross = base_pay + ot_pay + tips
taxable_income = gross - bhxh - bhyt - bhtn  // Giảm trừ trước thuế
// PIT theo bậc lũy tiến VN (simplified):
// Đến 5tr: 5%
// 5-10tr: 10%
// 10-18tr: 15%
// ... (có thể dùng lookup table)
net_after_tax = taxable_income - pit
```

**Code changes:**

| File | Change |
|------|--------|
| RPC / helper mới | Thêm `calculate_vietnam_tax(gross_income)` function |
| `useDealerPayroll.ts` | Thêm `calculateNetAfterTax(gross, tips)` helper |
| `DealerAdjustDialog.tsx` | Thêm tab "Khấu trừ" với BHXH/BHYT/BHTN toggle + PIT auto-calc |
| `DealerPayrollTab.tsx` | Thêm cột Tips, cột Tax, cột Net sau thuế vào table |

---

### 2.3 Tips Pool

**Vấn đề:** Poker đặc thù — dealer nhận tips từ player. Hiện không có cách nào nhập tips.

**Schema changes:**

```sql
-- Thêm TIPS vào adjustment type (nếu dùng enum)
-- HOẶC nếu adjustment_type là TEXT, chỉ cần frontend validation

-- Thêm tips vào dealer_payroll (đã có ở 2.2)
-- Thêm bảng tips_pool nếu muốn track nguồn gốc:
CREATE TABLE IF NOT EXISTS dealer_tips (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dealer_id UUID REFERENCES dealers(id),
  club_id UUID REFERENCES clubs(id),
  period_id UUID REFERENCES payroll_periods(id),
  amount_vnd NUMERIC NOT NULL,
  source TEXT,  -- 'player_tip', 'pool_share', 'bonus'
  recorded_by UUID REFERENCES auth.users(id),
  recorded_at TIMESTAMPTZ DEFAULT now()
);
```

**Code changes:**

| File | Change |
|------|--------|
| `useDealerPayroll.ts` | Thêm `addTip(dealerId, amount, source)` helper |
| `DealerPayrollTab.tsx` | Thêm nút "Nhập tips" + bulk tips entry dialog |
| Adjustment dialog | Thêm type `TIPS` vào filter/adjustment type |

---

## P3 — Nice to have

### 3.1 Batch calculation (nhiều club cùng lúc)

- Hiện `fetchPayroll` chỉ gọi 1 club. Có thể dùng `Promise.all(clubIds.map(...))`.
- Tối ưu: RPC nhận array `p_club_ids` thay vì single `p_club_id`.

### 3.2 Analytics / Trends

- Thêm tab "Báo cáo" trong DealerPayrollTab
- Chart: Chi phí lương theo tháng (Recharts)
- Top dealer OT, top dealer tips

### 3.3 Dealer self-service

- Trang riêng cho dealer xem slip lương (read-only)
- Không cần quyền admin

---

## Sprint Mapping

### Sprint 1 — Foundation (Tuần 1–2)

| # | Task | Files | Effort |
|---|------|-------|--------|
| 1.1 | Schema: Thêm status, submitted/approved/locked columns + constraint | Migration mới | 1h |
| 1.2 | Schema: Tạo `payroll_audit_log` + trigger + index | Migration mới | 1.5h |
| 1.3 | RPC: `save_payroll_period` (transaction-safe, SELECT FOR UPDATE) | Migration mới | 2h |
| 1.4 | Hook: Rewrite `savePayroll()` gọi RPC thay vì 3 call | `useDealerPayroll.ts` | 1h |
| 1.5 | Hook: Thêm `submitPayroll()`, `approvePayroll()`, `getAuditLog()` | `useDealerPayroll.ts` | 1.5h |
| 1.6 | UI: Status badge + step indicator (DRAFT → SUBMIT → APPROVE → LOCK) | `DealerPayrollTab.tsx` | 2h |
| 1.7 | UI: Audit log dialog (timeline view) | `DealerPayrollTab.tsx` + component mới | 2h |
| 1.8 | UI: Disable edit khi locked | `DealerPayrollTab.tsx` | 0.5h |
| **Tổng** | | | **~11.5h** |

### Sprint 2 — Business Logic (Tuần 3–4)

| # | Task | Files | Effort |
|---|------|-------|--------|
| 2.1 | RPC: Split shift qua midnight trong `get_dealer_payroll` | Migration mới (hoặc sửa 20260612) | 2h |
| 2.2 | Schema: Thêm tips, tax columns vào `dealer_payroll` | Migration mới | 0.5h |
| 2.3 | Helper: `calculate_vietnam_tax()` | Helper mới + test | 2h |
| 2.4 | Hook: Thêm tips + tax calculation vào flow | `useDealerPayroll.ts` | 1h |
| 2.5 | UI: Thêm cột Tips, Tax, Net sau thuế | `DealerPayrollTab.tsx` | 1h |
| 2.6 | UI: Dialog nhập tips (single + bulk) | Component mới | 2h |
| 2.7 | UI: Tab "Khấu trừ" trong DealerAdjustDialog | `DealerAdjustDialog.tsx` | 1.5h |
| **Tổng** | | | **~10h** |

### Sprint 3 — UI Polish (Tuần 5–6)

| # | Task | Files | Effort |
|---|------|-------|--------|
| 3.1 | UI: Summary strip 5 metrics ở đầu | `DealerPayrollTab.tsx` | 1h |
| 3.2 | UI: Filter pills (Tất cả / FT / PT / Có điều chỉnh) | `DealerPayrollTab.tsx` | 1h |
| 3.3 | UI: Search dealer by name | `DealerPayrollTab.tsx` | 0.5h |
| 3.4 | UI: Approval footer với action buttons + audit note | `DealerPayrollTab.tsx` | 1.5h |
| 3.5 | UI: Export PDF phiếu lương (từng dealer) | Helper mới | 2h |
| 3.6 | UI: Responsive / mobile-friendly table | `DealerPayrollTab.tsx` | 2h |
| **Tổng** | | | **~8h** |

### Sprint 4 — Compliance + Analytics (Tuần 7–8, optional)

| # | Task | Files | Effort |
|---|------|-------|--------|
| 4.1 | PIT lookup table theo luật VN | Migration + helper | 2h |
| 4.2 | Analytics tab: chart chi phí theo tháng | Component mới | 2h |
| 4.3 | Dealer self-service: xem slip lương | Trang mới | 3h |
| 4.4 | Batch multi-club calculation | `useDealerPayroll.ts` + RPC | 1h |
| **Tổng** | | | **~8h** |

---

## Danh sách file cần tạo mới

1. `supabase/migrations/2026XXXX_payroll_approval_workflow.sql` — Schema + RPC + triggers
2. `supabase/migrations/2026XXXX_payroll_tax_tips.sql` — Tax/tips columns
3. `src/components/cashier/PayrollAuditLogDialog.tsx` — Audit log timeline UI
4. `src/components/cashier/PayrollTipsDialog.tsx` — Tips entry dialog
5. `src/lib/vietnamTax.ts` — Tax calculation helper
6. `src/i18n/locales/vi.json` — Thêm keys cho payroll (nếu chưa có)

## Dependencies

- Sprint 2 phụ thuộc Sprint 1 (schema changes)
- Sprint 3 phụ thuộc Sprint 1 + 2
- Sprint 4 optional

---

## Implementation Log

### Sprint 1 — Foundation ✅ COMPLETED

| # | Task | Status | Notes |
|---|------|--------|-------|
| 1.1 | Schema: status columns + constraint | ✅ Done | `20260716000000_payroll_p0_fixes.sql` |
| 1.2 | Schema: `payroll_audit_log` + trigger | ✅ Done | `fn_audit_trigger`, `transition_payroll_status` |
| 1.3 | RPC: `save_payroll_period` (transaction-safe) | ✅ Done | UPSERT with `ON CONFLICT`, `SELECT FOR UPDATE` |
| 1.4 | Hook: `savePayroll()` gọi RPC | ✅ Done | `useDealerPayroll.ts` |
| 1.5 | Hook: `submitPayroll()`, `approvePayroll()`, `lockPayroll()` | ✅ Done | `useDealerPayroll.ts` |
| 1.6 | UI: Status badge + workflow buttons | ✅ Done | `DealerPayrollTab.tsx` (Draft → Submit → Approve → Lock) |
| 1.7 | UI: Audit log dialog | ✅ Done | Dialog + timeline view |
| 1.8 | UI: Disable edit khi locked | ✅ Done | `isLocked` guard trên adjustments + save |

### Sprint 2 — Business Logic ✅ COMPLETED (with locked decisions)

| # | Task | Status | Notes |
|---|------|--------|-------|
| 2.1 | Midnight shift handling | ✅ Done | **DEVIATION:** Option A locked — OT thuộc ngày check-in, không split. `is_overnight` flag để UI badge. Cap 24h/shift. |
| 2.2 | Schema: Thêm tips, tax columns | ✅ Done | Migration `20260717000000_payroll_sprint2.sql`. Columns: `tips_amount_vnd`, `bhxh_deduction_vnd`, `bhyt_deduction_vnd`, `bhtn_deduction_vnd`, `pit_deduction_vnd`, `net_pay_after_tax_vnd` (all BIGINT). `dependents_count` trên `dealers`. |
| 2.3 | RPC: `calculate_dealer_payroll` rewrite | ✅ Done | Integer arithmetic (`FLOOR(gross * rate / 100)::BIGINT`). BHXH 8%/BHYT 1.5%/BHTN 1% cho FT only. PIT = 0 (deferred Sprint 4). Tips = 0 placeholder (deferred Sprint 3). |
| 2.4 | RPC: `save_payroll_period` persist new columns | ✅ Done | UPSERT includes all new columns. Adjustments preserved. |
| 2.5 | Hook: Update types | ✅ Done | `DealerPayrollRow` + `SavedPayrollRecord` interfaces updated. `shifts[*].is_overnight` added. |
| 2.6 | UI: Thêm cột Tips, BHXH, BHYT, BHTN, PIT, Sau thuế | ✅ Done | `DealerPayrollTab.tsx` — 17 columns total. Moon icon cho overnight shifts. Grand total grid expanded to 10 metrics. |
| 2.7 | UI: Excel export new columns | ✅ Done | Export includes Tips, BHXH, BHYT, BHTN, PIT, Sau thuế. |
| 2.8 | Build verification | ✅ Done | `npm run build` pass, LSP diagnostics clean. |

**Locked decisions (Sprint 2):**
1. Option A: OT thuộc ngày check-in — không split aggregate, không prorate
2. Tips = net, không taxable, placeholder = 0 → Sprint 3
3. BHXH/BHYT/BHTN = informational only (hiển thị nhưng chưa trừ từ net) → Sprint 4
4. PIT + giảm trừ gia cảnh → deferred to Sprint 4
5. Tips pool → deferred to Sprint 3
6. Tất cả giá trị VND = integer (`BIGINT`), không float/NUMERIC

### Remaining Post-Deploy

1. **Recalculation query:** Chạy SQL để đánh dấu draft/submitted periods là `needs_recalculation` sau deploy RPC mới.
2. **Production verification:** Test với 1 kỳ lương thật để confirm integer arithmetic không có off-by-one.
