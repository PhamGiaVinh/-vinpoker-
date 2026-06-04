# Sprint 3 — Payroll UI Polish: Final Deployment Plan (v2)

> Based on: PLAN_PAYROLL_ROADMAP.md, mockup analysis, code reading (DealerPayrollTab.tsx 781 lines),
> user review of 6 risks + detailed code-level analysis. All decisions locked.

---

## TL;DR

| Item | Value |
|------|-------|
| **Total effort** | ~11h (9h code + 2h buffer/verification) |
| **Waves** | 5 waves, sequential (modifies same 781-line file) |
| **Files changed** | 3 existing + 3 new + 1 migration |
| **New deps** | 1 PDF library (`html2canvas` + `jspdf`) |
| **Schema migration** | 1 (reject columns + RPC extension) |
| **Risk level** | Low — all frontend work in 1 file, backend migration non-breaking |

---

## Locked Decisions (addressing all risks)

### FT/PT section structure with filter pills

**Decision: KEEP 2 sections, filter INSIDE each section.**

```ts
// NOT this — loses section headers:
const filteredRows = payrollRows.filter(...)

// THIS — preserves FT/PT headers:
const filteredFt = useMemo(() =>
  ftDealers.filter(r => passesFilter(r, activeFilter))
             .filter(r => matchesSearch(r, searchQuery)),
  [ftDealers, activeFilter, searchQuery])

const filteredPt = useMemo(() =>
  ptDealers.filter(r => passesFilter(r, activeFilter))
             .filter(r => matchesSearch(r, searchQuery)),
  [ptDealers, activeFilter, searchQuery])
```

- `renderRow` is unchanged — still `(r: DealerPayrollRow) => JSX`
- Used as `filteredFt.map(renderRow)` / `filteredPt.map(renderRow)` (currently `ftDealers.map(renderRow)` at line 575 / `ptDealers.map(renderRow)` at line 644)
- Empty section hides when 0 results. Both 0 → "Không tìm thấy dealer"

### Reject flow built together with approval footer

**Decision: Schema migration + footer = 1 contiguous task. Concrete SQL below.**

- `payroll_periods` currently has `submitted_by/at`, `approved_by/at`, `locked_by/at`
- Does NOT have `rejected_by`, `rejection_reason`, `rejected_at`
- `transition_payroll_status` RPC must be extended. See **Wave 0** for exact SQL.

### PDF library

**Decision: `html2canvas + jspdf`. Fallback: `window.print()` with `@media print` CSS.**

Rationale: Project has zero PDF deps. `@react-pdf/renderer` adds ~150KB gzip + 2-3h setup for Vietnamese font. `html2canvas + jspdf` uses existing HTML, ~80KB, lazy-loaded on click. If diacritics fail → `window.print()` = zero work.

**Loading guard:** See Wave 4 — `exporting` state disables button during PDF generation.

### Column config BEFORE all UI tasks

**Decision: Wave 1 extracts `COLUMNS` as single source of truth.**

Used by: header render, cell render, export Excel, future PDF.
4 manual places → 1 config array.

**Exhaustive switch** for cell rendering (compile-time safety):
```ts
const renderCell = (col: typeof COLUMNS[number], row: DealerPayrollRow) => {
  switch (col.key) {
    case 'full_name':        return row.full_name;
    case 'employment_type':  return row.employment_type === 'full_time' ? 'FT' : 'PT';
    case 'total_shifts':     return row.total_shifts || '—';
    case 'total_hours':      return formatHours(row.total_hours);
    case 'regular_hours':    return formatHours(row.regular_hours);
    case 'ot_hours':         return row.ot_hours > 0
      ? <span className="text-red-400 font-semibold">{formatHours(row.ot_hours)}</span>
      : '—';
    case 'base_pay':         return row.monthly_salary_vnd
      ? formatVNDShort(row.monthly_salary_vnd) : '—';
    case 'regular_pay':      return formatVND(row.regular_pay_vnd);
    case 'ot_pay':           return row.ot_pay_vnd > 0
      ? <span className="text-red-400">{formatVND(row.ot_pay_vnd)}</span> : '—';
    case 'gross_pay':        return <span className="text-emerald-400">{formatVND(row.gross_pay_vnd)}</span>;
    case 'tips':             return row.tips_amount_vnd > 0 ? formatVND(row.tips_amount_vnd) : '—';
    case 'bhxh':             return row.employment_type === 'full_time' && row.bhxh_deduction_vnd > 0
      ? formatVND(row.bhxh_deduction_vnd) : '—';
    case 'bhyt':             return row.employment_type === 'full_time' && row.bhyt_deduction_vnd > 0
      ? formatVND(row.bhyt_deduction_vnd) : '—';
    case 'bhtn':             return row.employment_type === 'full_time' && row.bhtn_deduction_vnd > 0
      ? formatVND(row.bhtn_deduction_vnd) : '—';
    case 'pit':              return row.pit_deduction_vnd > 0 ? formatVND(row.pit_deduction_vnd) : '—';
    case 'net_after_tax':    return <span className="text-emerald-400">{formatVND(row.net_pay_after_tax_vnd)}</span>;
    case 'adjustments':      return row.total_adjustments_vnd !== 0
      ? <span className={row.total_adjustments_vnd > 0 ? 'text-emerald-400' : 'text-red-400'}>
          {formatVND(row.total_adjustments_vnd)}
        </span> : '—';
    case 'net_pay':          return <span className="font-semibold">{formatVND(row.net_pay_vnd)}</span>;
    case 'actions':          return <ActionButtons row={row} ... />;
    default: { const _: never = col.key; return null; }
  }
};
```

Note: `renderRow` currently uses `adjustments` and `savedRecords` closures (line 307-308). These are still accessible in the new `renderCell` since it's defined inside the component.

### TIPS adjustment type

**Decision: Works immediately — `adjustment_type` is TEXT, no CHECK constraint.**

Frontend: add `TIPS` to `ADJ_TYPE_LABELS` and `ADJ_TYPE_COLORS` in DealerPayrollTab.tsx. Zero migration.

### passesFilter — pure function outside component

```ts
// Outside component (file level)
function passesFilter(
  row: DealerPayrollRow,
  filter: FilterKey,
  adjustments: Record<string, PayrollAdjustmentRow[]>
): boolean {
  if (filter === 'has_adjustments') return (adjustments[row.dealer_id]?.length ?? 0) > 0;
  if (filter === 'high_ot') return row.ot_hours >= 20;
  return true; // 'all', 'full_time', 'part_time' handled by section split
}

function matchesSearch(row: DealerPayrollRow, query: string): boolean {
  if (!query) return true;
  return row.full_name.toLowerCase().includes(query.toLowerCase());
}
```

### MetricCard — `colorVariant` instead of multiple booleans

```tsx
type MetricVariant = 'default' | 'success' | 'danger' | 'warning';

function MetricCard({ label, value, sub, variant = 'default' }: {
  label: string; value: React.ReactNode; sub?: string; variant?: MetricVariant;
}) {
  const variantStyles: Record<MetricVariant, string> = {
    default: 'text-zinc-100',
    success: 'text-emerald-400',
    danger: 'text-red-400',
    warning: 'text-amber-400',
  };
  return (
    <div className="bg-zinc-900 rounded-lg p-3 flex flex-col gap-1 min-w-0 border border-zinc-800">
      <span className="text-xs text-zinc-500 uppercase tracking-wider">{label}</span>
      <span className={`text-lg font-semibold ${variantStyles[variant]}`}>{value}</span>
      {sub && <span className="text-xs text-zinc-500">{sub}</span>}
    </div>
  );
}
```

### FOOTER_ACTIONS — Record pattern (compile-time exhaustive check)

```ts
type PayrollStatus = 'draft' | 'submitted' | 'approved' | 'rejected' | 'locked';

const FOOTER_ACTIONS: Record<PayrollStatus, React.ReactNode> = {
  draft:     null, // only [Gửi duyệt] button (triggers submit)
  submitted: <><RejectButton /><ApproveButton /></>,
  approved:  <LockButton />,
  rejected:  <ResubmitButton />,
  locked:    null,
};
```

Adding a new status in the future → TS error if missing from `Record`.

---

## Wave Plan

### Wave 0 — Schema migration (0.5h)

**File:** `VinPoker/supabase/migrations/202607XX000001_payroll_reject_flow.sql`

```sql
BEGIN;

-- 1. Add reject columns
ALTER TABLE payroll_periods
  ADD COLUMN IF NOT EXISTS rejected_by UUID REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS rejected_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rejection_reason TEXT;

-- 2. Update status check constraint
ALTER TABLE payroll_periods
  DROP CONSTRAINT IF EXISTS chk_payroll_status,
  ADD CONSTRAINT chk_payroll_status
    CHECK (status IN ('draft', 'submitted', 'approved', 'locked', 'rejected'));

-- 3. Extend RPC to handle rejected status
CREATE OR REPLACE FUNCTION transition_payroll_status(
  p_period_id UUID,
  p_expected_status TEXT,
  p_new_status TEXT,
  p_user_id UUID,
  p_rejection_reason TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current_status TEXT;
BEGIN
  SELECT status INTO v_current_status
  FROM payroll_periods WHERE id = p_period_id
  FOR UPDATE;

  IF v_current_status IS NULL THEN
    RAISE EXCEPTION 'Payroll period not found';
  END IF;

  IF v_current_status != p_expected_status THEN
    RAISE EXCEPTION 'Expected status %, but current status is %', p_expected_status, v_current_status;
  END IF;

  IF p_new_status = 'rejected' THEN
    UPDATE payroll_periods
    SET status = 'rejected',
        rejected_by = p_user_id,
        rejected_at = now(),
        rejection_reason = COALESCE(p_rejection_reason, ''),
        updated_at = now()
    WHERE id = p_period_id;
  ELSIF p_new_status = 'draft' THEN  -- resubmit after rejection
    UPDATE payroll_periods
    SET status = 'draft',
        rejected_by = NULL,
        rejected_at = NULL,
        rejection_reason = NULL,
        updated_at = now()
    WHERE id = p_period_id;
  ELSE
    UPDATE payroll_periods
    SET status = p_new_status,
        rejected_by = CASE WHEN p_new_status = 'submitted' THEN NULL ELSE rejected_by END,
        CASE p_new_status
          WHEN 'submitted' THEN submitted_by = p_user_id; submitted_at = now();
          WHEN 'approved'  THEN approved_by = p_user_id; approved_at = now();
          WHEN 'locked'    THEN locked_by = p_user_id; locked_at = now();
          ELSE NULL
        END,
        updated_at = now()
    WHERE id = p_period_id;
  END IF;

  RETURN TRUE;
END;
$$;

COMMIT;
```

**⚠️ Verify step (MANDATORY before Wave 3):**
```sql
-- Run in Supabase SQL editor after migration up:
SELECT transition_payroll_status('test-period-id', 'submitted', 'rejected', 'test-user-id', 'Sai số liệu');
-- Expected: TRUE, period status = 'rejected', rejected_at populated
```

---

### Wave 1 — Column config + refactor (1.5h)

**File:** `VinPoker/src/components/cashier/DealerPayrollTab.tsx`

| Step | What | Detail |
|------|------|--------|
| 1.1 | Create `COLUMNS` const (above component) | Type-safe, `hideBelow`, `export: boolean` |
| 1.2 | Replace FT `<TableHead>` | Map over `COLUMNS` |
| 1.3 | Replace PT `<TableHead>` | Same config, reuse |
| 1.4 | Replace `renderRow` | Map over `COLUMNS`, exhaustive switch with `never` |
| 1.5 | Replace Excel export columns | `COLUMNS.filter(c => c.export).map(...)` |
| 1.6 | **Checkpoint** | `npm run build` pass, LSP clean |

**`renderRow` closure note:** `renderRow` currently uses `adjustments`, `savedRecords` from component scope (line 307-308). The new switch-based renderer keeps these → no change needed. `actions` column renders inline buttons.

---

### Wave 2 — Core UI: summary + filter + search + responsive (2.5h)

**File:** `VinPoker/src/components/cashier/DealerPayrollTab.tsx`

#### Order: 2.4 (responsive) → 2.1 (summary) → 2.2 (pills) → 2.3 (search) → 2.5 (empty)

Rationale: responsive is pure CSS in `COLUMNS`, least risk. summary reads `totals`, next least risk. pills + search need `passesFilter` + state = more complex. Empty state = final polish.

#### 2.4 Responsive column visibility (0.5h)

`COLUMNS[n].hideBelow` drives both `<TableHead>` and `<TableCell>`:

```tsx
<TableHead className={col.hideBelow ? `hidden ${col.hideBelow}:table-cell` : ''}>
  {col.label}
</TableHead>
```

| Breakpoint | Columns hidden |
|------------|----------------|
| `< md` | Thường, Tips, BHXH, BHYT, BHTN, PIT, Sau thuế |
| `< lg` | Tips, BHYT, BHTN, Sau thuế |
| `< xl` | PIT |

Mobile: 9 column visible (Tên → Thực lãnh, bỏ tax).

#### 2.1 Summary strip (0.5h)

Render between toolbar and filter pills. `colorVariant` instead of `highlight`/`accent`:

```tsx
<div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2 mb-3">
  <MetricCard label="Tổng dealer" value={payrollRows.length}
    sub={`FT: ${ftDealers.length} · PT: ${ptDealers.length}`} />
  <MetricCard label="Tổng gross" value={formatVNDShort(totals.totalGross)} sub="Lương cơ bản" />
  <MetricCard label="Tổng OT" value={formatHours(/* computed */)}
    sub={`${highOtCount} người > 20h`} variant={totals.totalOt > 0 ? 'danger' : 'default'} />
  <MetricCard label="Điều chỉnh" value={formatVND(totals.totalAdjust)} sub="Tips · phạt" />
  <MetricCard label="Thực lãnh" value={formatVNDShort(totals.totalNet)} sub="Sau khấu trừ"
    variant="success" />
</div>
```

#### 2.2 Filter pills (0.75h)

```tsx
const FILTERS = [
  { key: 'all', label: 'Tất cả' },
  { key: 'full_time', label: 'FT' },
  { key: 'part_time', label: 'PT' },
  { key: 'has_adjustments', label: 'Có điều chỉnh' },
  { key: 'high_ot', label: 'OT nhiều', danger: true },
] as const;
type FilterKey = (typeof FILTERS)[number]['key'];
```

Count badge: `payrollRows.filter(r => passesFilter(r, key, adjustments)).length` — safe because `payrollRows[n].employment_type` exists (confirmed: line 143-144 uses `d.employment_type`).

#### 2.3 Search input (0.25h)

```tsx
<input
  placeholder="Tìm tên dealer..."
  value={searchQuery}
  onChange={e => setSearchQuery(e.target.value)}
  className="h-8 bg-zinc-900 border border-zinc-700 rounded-md px-3 pl-8 text-xs text-white ..."
/>
```

Search matches `r.full_name.toLowerCase().includes(searchQuery.toLowerCase())`.

#### 2.5 Empty state (0.5h)

When filtered FT = 0 → hide FT section. PT = 0 → hide PT. Both 0 → show "Không tìm thấy dealer phù hợp".

---

### Wave 3 — Approval footer + reject flow (2.5h)

**File:** `VinPoker/src/components/cashier/DealerPayrollTab.tsx`

#### 3.1 Extract workflow from toolbar (0.5h)

Remove lines 459-506 from toolbar. Keep: CLB select, month select, Làm mới, Xuất Excel, Lưu.

#### 3.2 Footer component (1.5h)

**ScrollArea boundary confirmed:** Lines 544 (`<ScrollArea>`) wraps FT + PT + Grand total (673-717). Closes at line 718 (`</ScrollArea>`). Footer inserts at line 719, **outside ScrollArea** — visible without scrolling.

```tsx
{/* ... </ScrollArea> at line 718 */}
{!loading && !error && payrollRows.length > 0 && (
  <div className="mt-3 border border-zinc-800 rounded-lg p-4 bg-zinc-900/50">
    <div className="flex items-start justify-between gap-4 flex-wrap">
      {/* Left: status info */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <div className={`w-2.5 h-2.5 rounded-full ${
            payrollStatus === 'approved' ? 'bg-emerald-500' :
            payrollStatus === 'locked' ? 'bg-zinc-500' :
            payrollStatus === 'rejected' ? 'bg-red-500' : 'bg-amber-500'
          }`} />
          <span className="text-sm font-medium text-zinc-200">
            {STATUS_LABELS[payrollStatus ?? 'draft'] ?? 'Chờ'}
          </span>
        </div>
        {/* submitted_by/at, approved_by/at, rejected_by/at */}
        <div className="text-xs text-zinc-500 space-y-0.5">
          {payrollStatus && <div>Gửi bởi: {submittedBy} — {submittedAt}</div>}
          {payrollStatus === 'approved' && <div>Duyệt bởi: {approvedBy} — {approvedAt}</div>}
          {payrollStatus === 'rejected' && <div>Từ chối bởi: {rejectedBy} — Lý do: {rejectionReason}</div>}
          {payrollStatus === 'locked' && <div>Khoá bởi: {lockedBy} — {lockedAt}</div>}
        </div>
        <button className="btn-sm mt-1" onClick={openAuditLog}>
          <History className="w-3.5 h-3.5 mr-1" /> Xem audit log
        </button>
      </div>

      {/* Right: actions */}
      <div className="flex flex-col gap-2 min-w-[240px]">
        {(payrollStatus === 'submitted') && (
          <>
            <textarea placeholder="Nhập lý do từ chối..."
              className="h-16 text-xs ..." value={rejectReason}
              onChange={e => setRejectReason(e.target.value)} />
            <div className="flex gap-2">
              <button className="btn-sm border-red-500 text-red-400"
                onClick={() => handleReject(rejectReason)}>Từ chối</button>
              <button className="btn-sm flex-1 border-emerald-500 text-emerald-400 justify-center"
                onClick={handleApprove}>Duyệt bảng lương</button>
            </div>
          </>
        )}
        {payrollStatus === 'draft' && savedPeriodId && (
          <button className="btn-sm bg-amber-600 text-white" onClick={handleSubmit}>
            Gửi duyệt
          </button>
        )}
        {payrollStatus === 'approved' && (
          <button className="btn-sm bg-red-600 text-white" onClick={handleLock}>
            Khoá sổ
          </button>
        )}
        {payrollStatus === 'rejected' && (
          <button className="btn-sm bg-blue-600 text-white" onClick={handleResubmit}>
            Sửa lại và gửi duyệt
          </button>
        )}
      </div>
    </div>
  </div>
)}
```

`Record<PayrollStatus, ReactNode>` pattern can be used if the above if-else chain grows, but for 5 branches the if-else is clearer. No premature abstraction.

#### 3.3 Audit log integration (0.5h)

Wire button to open existing dialog + call `getPayrollAuditLog(periodId)`. No new component needed — reuses existing audit dialog or renders inline.

---

### Wave 4 — PDF export + row buttons + Tips Pool (3h)

#### Order: 4.3 (Tips Pool) → 4.2 (row buttons) → 4.1 (PDF)

Rationale: Tips Pool has zero dep, row buttons use existing `openAdjustDialog`, PDF has new deps + font risk.

#### 4.3 Tips Pool UI (0.75h)

**File:** `VinPoker/src/components/cashier/PayrollTipsDialog.tsx`

- Dialog: select dealer → amount → source (`player_tip` / `pool_share`)
- On save: `addPayrollAdjustment(record.id, 'TIPS', amount, source, userId)`
- In DealerPayrollTab.tsx: add `TIPS` to `ADJ_TYPE_LABELS` and `ADJ_TYPE_COLORS`
- Zero DB migration — `adjustment_type` is TEXT

#### 4.2 Row action buttons (0.25h)

Replace current `+` icon (line 318) with proper buttons in `actions` column:
```tsx
<Button variant="ghost" size="sm" onClick={() => exportSinglePdf(r)}
  disabled={exporting === r.dealer_id}>
  <FileText className="w-3.5 h-3.5" />
</Button>
<Button variant="ghost" size="sm" onClick={() => openAdjustDialog(r.dealer_id)}>
  <Pencil className="w-3.5 h-3.5" />
</Button>
```

#### 4.1 PDF export (2h)

**New file:** `VinPoker/src/lib/exportPayrollPdf.ts`

```ts
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';

export async function exportPayrollPdf(
  rows: DealerPayrollRow[],
  clubName: string,
  monthLabel: string,
  singleDealerId?: string
) { ... }
```

**Loading guard** — prevent double-click:
```ts
const [exporting, setExporting] = useState<string | null>(null);

const exportSinglePdf = async (row: DealerPayrollRow) => {
  setExporting(row.dealer_id);
  try {
    const { exportPayrollPdf } = await import('@/lib/exportPayrollPdf');
    await exportPayrollPdf([row], clubName, monthLabel, row.dealer_id);
  } finally {
    setExporting(null);
  }
};
```

If html2canvas fails on Vietnamese → `window.print()` fallback:
```ts
const printWindow = window.open('', '_blank');
printWindow!.document.write(`
  <html><head><style>
    @media print { table { width:100%; border-collapse:collapse; } ... }
  </style></head><body>${tableHTML}</body></html>
`);
printWindow!.print();
```

**Dependency install:**
```bash
npm install html2canvas jspdf
```

---

### Wave 5 — Integration + verification (2h)

| Step | What | Detail |
|------|------|--------|
| 5.1 | Build check | `npm run build` |
| 5.2 | LSP diagnostics | All changed files clean |
| 5.3 | Verify reject flow | Supabase: call `transition_payroll_status(id, 'submitted', 'rejected', uid, 'reason')` → status=rejected |
| 5.4 | Manual QA | Filter pills + search + responsive + footer + PDF + tips |
| 5.5 | Column parity | Excel export columns match table columns |
| 5.6 | Empty states | Both sections empty, one empty, no data |
| 5.7 | PDF test | Export single + all, check Vietnamese text renders |

---

## Execution order (tweaked per analysis)

```
Wave 0 ─→ [Verify RPC on Supabase SQL editor] ─→ Wave 1 ─→ [Build checkpoint]
                                                           ↓
                              ┌────────────────────────────┤
                              │                            │
                         Wave 2 (2.4 → 2.1 → 2.2 → 2.3 → 2.5)
                              │                            │
                              └────────────────────────────┤
                                                           ↓
                              Wave 3 (3.1 → 3.2 → 3.3) ──→ [Build checkpoint]
                                                           ↓
                              Wave 4 (4.3 → 4.2 → 4.1)
                                                           ↓
                              Wave 5 (verify all)
```

Key changes from v1:
- **Wave 0 verify**: Test RPC on Supabase BEFORE Wave 3
- **Wave 2 reorder**: Responsive (2.4) → Summary (2.1) → Pills (2.2) → Search (2.3) → Empty (2.5)
- **Wave 4 reorder**: Tips Pool → Row buttons → PDF (least risk first)

---

## Files changed/created

| File | Action | Wave |
|------|--------|------|
| `VinPoker/supabase/migrations/202607XX000001_payroll_reject_flow.sql` | **Create** | 0 |
| `VinPoker/src/components/cashier/DealerPayrollTab.tsx` | **Edit** (major) | 1, 2, 3, 4 |
| `VinPoker/src/lib/exportPayrollPdf.ts` | **Create** | 4 |
| `VinPoker/src/components/cashier/PayrollTipsDialog.tsx` | **Create** | 4 |
| `VinPoker/src/hooks/useDealerPayroll.ts` | **Minor edit** (add TIPS constant) | 4 |
| `VinPoker/package.json` | **Edit** (add html2canvas + jspdf) | 4 |

---

## Effort Summary

| Wave | Task | Effort |
|------|------|--------|
| 0 | Schema: reject columns + RPC extension + verify | 0.5h |
| 1 | COLUMNS config + refactor table render (exhaustive switch) | 1.5h |
| 2 | Responsive + summary + filter pills + search + empty | 2.5h |
| 3 | Approval footer + reject flow + audit log | 2.5h |
| 4 | Tips Pool + row buttons + PDF export (with loading guard) | 3h |
| 5 | Integration + verification | 1h |
| | **Total** | **~11h** |

---

## Commands

```bash
# Wave 0
supabase migration up
# Manual: test transition_payroll_status in SQL editor

# Wave 1
npm run build  # checkpoint

# Wave 2
npm run build

# Wave 3
npm run build

# Wave 4
npm install html2canvas jspdf
npm run build

# Wave 5
npm run build
```
