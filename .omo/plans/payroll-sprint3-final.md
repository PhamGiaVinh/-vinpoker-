# Sprint 3 — Payroll UI Polish: Final Deployment Plan

> Based on: PLAN_PAYROLL_ROADMAP.md, mockup analysis, code reading (DealerPayrollTab.tsx 781 lines),
> user review of 6 risks. All decisions locked below.

---

## TL;DR

| Item | Value |
|------|-------|
| **Total effort** | ~11h (9h code + 2h buffer/verification) |
| **Waves** | 5 waves, mostly sequential (Wave 2 dependent on Wave 1) |
| **Files changed** | 3 existing + 3 new + 1 migration |
| **New deps** | 1 PDF library (decision below) |
| **Schema migration** | 1 (reject columns, no breaking changes) |
| **Risk level** | Low — all tasks modify DealerPayrollTab.tsx, no backend RPC changes needed |

---

## Locked Decisions (addressing user's 5 risks)

### Risk 1: FT/PT section structure with filter pills

**Decision: KEEP 2 sections, filter INSIDE each section.**

```ts
// NOT this (flat array — loses section headers):
const filteredRows = payrollRows.filter(...)

// THIS (preserves sections):
const filteredFt = useMemo(() =>
  ftDealers.filter(r => passesFilter(r, activeFilter))
             .filter(r => matchesSearch(r, searchQuery)),
  [ftDealers, activeFilter, searchQuery])

const filteredPt = useMemo(() =>
  ptDealers.filter(r => passesFilter(r, activeFilter))
             .filter(r => matchesSearch(r, searchQuery)),
  [ptDealers, activeFilter, searchQuery])
```

- Section headers "Full-time" / "Part-time" keep rendering.
- Empty section hides when 0 results.
- Filter pills apply to BOTH sections simultaneously.
- Search across both.
- Zero structural change to existing JSX — only wrap existing tables with conditional render.

### Risk 2: Reject flow built together with approval footer (not separate)

**Decision: Reject schema migration + footer component = 1 contiguous task.**

- `payroll_periods` currently has: `submitted_by/at`, `approved_by/at`, `locked_by/at`.
- It does NOT have `rejected_by`, `rejection_reason`, `rejected_at`.
- `transition_payroll_status` RPC only handles `draft → submitted → approved → locked`.
- **Migration needed**: add reject columns + `rejected` status to `chk_payroll_status` + extend RPC.

This avoids: build footer → realize no reject → come back to edit footer.

### Risk 3: PDF library — decision before code

**Decision: `html2canvas + jspdf` (fastest path), fallback to `window.print()` if font issues.**

Rationale:
- `@react-pdf/renderer`: ~150KB gzip, separate layout in JSX, Vietnamese font NOT built in (need `registerFont` with `.ttf` file), ~2-3h setup + per-page layout.
- `html2canvas + jspdf`: ~80KB combined, uses existing HTML, Vietnamese text works if system font supports it. Payroll table already renders correctly — just wrap in canvas.
- Bundle impact: negligible (lazy-loaded only on export click).

Contingency: If html2canvas fails on Vietnamese diacritics, fall back to `window.print()` with `@media print` CSS — zero deps, perfect font rendering.

### Risk 4: Column config extracted BEFORE all UI tasks

**Decision: Wave 1 = extract COLUMNS config as prerequisite.**

```ts
const COLUMNS = [
  { key: 'full_name',      label: 'Tên',        always: true, export: true },
  { key: 'employment_type', label: 'Loại',       always: true, export: true },
  { key: 'total_shifts',   label: 'Ca',          always: true, export: true },
  { key: 'total_hours',    label: 'Tổng giờ',    always: true, export: true },
  { key: 'regular_hours',  label: 'Giờ chuẩn',   always: true, export: true },
  { key: 'ot_hours',       label: 'OT',          always: true, export: true },
  { key: 'base_pay',       label: 'Lương CB',    always: true, export: true },
  { key: 'regular_pay',    label: 'Thường',      hideBelow: 'md', export: true },
  { key: 'ot_pay',         label: 'OT pay',     always: true, export: true },
  { key: 'gross_pay',      label: 'Gộp',        always: true, export: true },
  { key: 'tips',           label: 'Tips',        hideBelow: 'lg', export: true },
  { key: 'bhxh',           label: 'BHXH',        hideBelow: 'lg', export: true },
  { key: 'bhyt',           label: 'BHYT',        hideBelow: 'lg', export: true },
  { key: 'bhtn',           label: 'BHTN',        hideBelow: 'lg', export: true },
  { key: 'pit',            label: 'PIT',         hideBelow: 'xl', export: true },
  { key: 'net_after_tax',  label: 'Sau thuế',   hideBelow: 'lg', export: true },
  { key: 'adjustments',    label: 'Điều chỉnh', always: true, export: true },
  { key: 'net_pay',        label: 'Thực lãnh',  always: true, export: true },
  { key: 'actions',        label: '',            always: true, export: false },
] as const;
```

- Used by: header rendering, cell rendering, export Excel, and future PDF export.
- 4 places → 1 place. Adds/removes columns in one edit.

### Risk 5: TIPS adjustment type

**Decision: `adjustment_type` is TEXT column with NO CHECK constraint — TIPS works immediately.**

Verify: `payroll_adjustments.adjustment_type TEXT NOT NULL` — no enum, no constraint.
Frontend `ADJ_TYPE_LABELS` + `ADJ_TYPE_COLORS` maps are local objects in DealerPayrollTab.tsx.
👉 Just add `TIPS` entry to both maps. Zero migration needed.

---

## Wave Plan

### Wave 0 — Schema migration (0.5h)

**File:** `supabase/migrations/202607XX000001_payroll_reject_flow.sql`

```sql
ALTER TABLE payroll_periods
  ADD COLUMN IF NOT EXISTS rejected_by UUID REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS rejected_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rejection_reason TEXT;

ALTER TABLE payroll_periods
  DROP CONSTRAINT IF EXISTS chk_payroll_status,
  ADD CONSTRAINT chk_payroll_status
    CHECK (status IN ('draft', 'submitted', 'approved', 'locked', 'rejected'));
```

Plus extend `transition_payroll_status` RPC to handle `submitted → rejected` transition.

---

### Wave 1 — Column config + refactor (1.5h)

**File:** `src/components/cashier/DealerPayrollTab.tsx`

| Step | What | Detail |
|------|------|--------|
| 1.1 | Create `COLUMNS` const (above component) | Type-safe, `hideBelow` for responsive, `export: boolean` |
| 1.2 | Replace FT `<TableHead>` | Map over `COLUMNS` instead of 17 hardcoded `<TableHead>` |
| 1.3 | Replace PT `<TableHead>` | Same config, reuse |
| 1.4 | Replace `renderRow` cells | Map over `COLUMNS`, switch on `col.key` to render value |
| 1.5 | Replace Excel export columns object | Map from `COLUMNS.filter(c => c.export)` |
| 1.6 | Verify | `npm run build` pass, LSP clean |

**Why first:** Every subsequent UI task touches the table. Doing column config first means:
- Summary strip (Wave 2) reads from `COLUMNS` instead of hardcoded keys
- Filter pills (Wave 2) are independent of column layout
- Responsive (Wave 2) is `hideBelow` in one place
- PDF (Wave 4) shares same column definitions

---

### Wave 2 — Core UI: summary + filter + search + responsive (2.5h)

**File:** `src/components/cashier/DealerPayrollTab.tsx`

#### 2.1 Summary strip (0.5h) — mockup cards

Render between toolbar and filter pills:

```tsx
<div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2">
  <MetricCard label="Tổng dealer" value={payrollRows.length}
    sub={`FT: ${ftDealers.length} · PT: ${ptDealers.length}`} />
  <MetricCard label="Tổng gross" value={formatVNDShort(totals.totalGross)}
    sub="Lương cơ bản" />
  <MetricCard label="Tổng OT" value={formatHours(totals.totalHours - totals.totalShifts * 8)}
    sub={`${highOtCount} người > 20h`} highlight={totals.totalOt > 0} />
  <MetricCard label="Điều chỉnh" value={formatVND(totals.totalAdjust)}
    sub="Tips · phạt" />
  <MetricCard label="Thực lãnh" value={formatVNDShort(totals.totalNet)}
    sub="Sau khấu trừ" accent />
</div>
```

**Note:** `MetricCard` can be a tiny local sub-component (4 lines) or inline divs. No separate file needed.

#### 2.2 Filter pills (0.75h)

```tsx
const FILTERS = [
  { key: 'all', label: 'Tất cả' },
  { key: 'full_time', label: 'FT' },
  { key: 'part_time', label: 'PT' },
  { key: 'has_adjustments', label: 'Có điều chỉnh' },
  { key: 'high_ot', label: 'OT nhiều', color: 'red' },
] as const;
type FilterKey = (typeof FILTERS)[number]['key'];
```

Each pill shows count badge: `payrollRows.filter(r => passesFilter(r, key)).length`

#### 2.3 Search input (0.25h)

```tsx
<input
  placeholder="Tìm tên dealer..."
  value={searchQuery}
  onChange={e => setSearchQuery(e.target.value)}
  className="h-8 ..."
/>
```

Search matches `r.full_name.toLowerCase().includes(searchQuery.toLowerCase())`.

#### 2.4 Responsive column visibility (0.5h)

Use `COLUMNS[n].hideBelow` in table header + cell:

```tsx
// In header map:
<TableHead className={col.hideBelow ? `hidden ${col.hideBelow}:table-cell` : ''}>
  {col.label}
</TableHead>
```

| Breakpoint | Columns hidden |
|------------|----------------|
| `< md` (768px) | Thường, Tips, BHXH, BHYT, BHTN, PIT, Sau thuế |
| `< lg` (1024px) | Tips, BHYT, BHTN, Sau thuế |
| `< xl` (1280px) | PIT |

On mobile: 9 core columns remain visible (Tên, Loại, Ca, Tổng giờ, OT, Lương CB, Gộp, Điều chỉnh, Thực lãnh).

#### 2.5 Empty state per section (0.5h)

When filtered FT section = 0 results: hide FT table entirely.
When filtered PT section = 0 results: hide PT table.
When both 0: show "Không tìm thấy dealer phù hợp".

---

### Wave 3 — Approval footer + reject flow (2.5h)

**File:** `src/components/cashier/DealerPayrollTab.tsx`

#### 3.1 Extract workflow from toolbar (0.5h)

Move from current toolbar (lines 459-506) to a separate component:
- Remove status badges + workflow buttons from toolbar
- Keep only: CLB select, month select, Làm mới, Xuất Excel, Lưu

#### 3.2 Footer component (1.5h)

Renders BELOW the grand total grid (outside ScrollArea):

```
┌──────────────────────────────────────────────────────────────┐
│ Left:                                                        │
│   ● status dot + "Chờ duyệt" / "Đã duyệt" / "Đã khoá sổ"    │
│   submitted_by + timestamp                                   │
│   approved_by + timestamp (or "chưa có")                     │
│   [Xem audit log →] button                                   │
│                                                              │
│ Right:                                                       │
│   textarea: "Ghi chú duyệt..."                               │
│   [Từ chối] [Duyệt] buttons                                  │
└──────────────────────────────────────────────────────────────┘
```

Conditional rendering:
- **Draft**: show [Gửi duyệt] button only
- **Submitted**: show [Từ chối] [Duyệt] + textarea
- **Approved**: show [Khoá sổ] button + status info
- **Rejected**: show [Sửa lại] button + reject reason
- **Locked**: show read-only status only

#### 3.3 Audit log integration (0.5h)

- "Xem audit log" button opens existing dialog (or inline timeline)
- `getPayrollAuditLog` RPC already exists in useDealerPayroll.ts
- No new code needed — just wire button to open

---

### Wave 4 — PDF export + Tips Pool (3h)

#### 4.1 PDF export (2h)

**New file:** `src/lib/exportPayrollPdf.ts`

```ts
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';

export async function exportPayrollPdf(
  rows: DealerPayrollRow[],
  clubName: string,
  monthLabel: string,
  singleDealerId?: string  // if set, export only 1 dealer
) { ... }
```

**Decision locked:** `html2canvas + jspdf`.
- Each dealer = 1 page (or grouped in table if "PDF tất cả")
- Table layout reuses same column structure as COLUMNS config
- If html2canvas fails on Vietnamese: `window.print()` fallback

**UI changes in DealerPayrollTab.tsx:**
- Add "PDF" button each row (in `actions` column from Wave 1)
- Add "PDF tất cả" button in toolbar (next to "Xuất Excel")
- Import lazy: `const pdf = await import('@/lib/exportPayrollPdf')`

**Dependency install (1 command):**
```
npm install html2canvas jspdf
```

#### 4.2 Row action buttons (0.25h)

Add to `actions` column (from COLUMNS config):
```tsx
<button onClick={() => exportSinglePdf(r)} title="Xuất PDF">
  <FileText className="w-3.5 h-3.5" />
</button>
<button onClick={() => openAdjustDialog(r.dealer_id)} title="Điều chỉnh">
  <Edit className="w-3.5 h-3.5" />
</button>
```

Replace current tiny `+` icon (line 318) with proper buttons.

#### 4.3 Tips Pool UI (0.75h)

**New file:** `src/components/cashier/PayrollTipsDialog.tsx`

- Dialog: select dealer → amount → source (`player_tip` / `pool_share`)
- On save: call `addPayrollAdjustment(record.id, 'TIPS', amount, source, userId)`
- Add `TIPS` to `ADJ_TYPE_LABELS` and `ADJ_TYPE_COLORS` in DealerPayrollTab.tsx
- No DB migration needed — `adjustment_type` is TEXT, no constraint

---

### Wave 5 — Integration + verification (2h)

| Step | What | Detail |
|------|------|--------|
| 5.1 | Merge all changes | Single DealerPayrollTab.tsx file, no conflicts |
| 5.2 | Build check | `npm run build` |
| 5.3 | LSP diagnostics | All changed files clean |
| 5.4 | Manual QA | Filter pills + search + responsive + footer + PDF + tips |
| 5.5 | Verify reject flow | Submit → Reject → status check → resubmit → Approve → Lock |
| 5.6 | Verify PDF | Export single + all, check Vietnamese text |
| 5.7 | Column parity | Excel export matches table columns |

---

## Dependency Graph

```
Wave 0 (Migration) ──────┐
                          ├── Wave 3 (Footer + reject) ──┐
Wave 1 (Column config) ───┤                              ├── Wave 5 (Verify)
                          ├── Wave 2 (Summary + filter) ─┤
                          │                              │
                          └── Wave 4 (PDF + Tips) ───────┘
```

Wave 1 is the ONLY hard prerequisite. Waves 2+3+4 can theoretically run in parallel if needed (different sections of the same file → risk of merge conflicts).

**Recommended: Sequential.** Modifying 781-line file needs clean checkpoints.

---

## Files changed/created

| File | Action | Wave |
|------|--------|------|
| `supabase/migrations/202607XX000001_payroll_reject_flow.sql` | **Create** | 0 |
| `src/components/cashier/DealerPayrollTab.tsx` | **Edit** (major) | 1, 2, 3, 4 |
| `src/lib/exportPayrollPdf.ts` | **Create** | 4 |
| `src/components/cashier/PayrollTipsDialog.tsx` | **Create** | 4 |
| `src/hooks/useDealerPayroll.ts` | **Minor edit** (add TIPS constant) | 4 |
| `package.json` | **Edit** (add html2canvas + jspdf) | 4 |

---

## Effort Summary

| Wave | Task | Effort |
|------|------|--------|
| 0 | Schema: reject columns + RPC extension | 0.5h |
| 1 | COLUMNS config + refactor table render | 1.5h |
| 2 | Summary strip + filter pills + search + responsive | 2.5h |
| 3 | Approval footer + reject flow + audit log | 2.5h |
| 4 | PDF export + row buttons + Tips Pool | 3h |
| 5 | Integration + verification | 1h |
| | **Total** | **~11h** |

---

## Commands to run at each stage

```bash
# Wave 0 - migration
supabase migration up

# Wave 1 - verify
npm run build
# LSP: check DealerPayrollTab.tsx

# Wave 2 - verify
npm run build

# Wave 3 - verify
npm run build

# Wave 4 - install deps
npm install html2canvas jspdf
npm run build

# Wave 5 - final build
npm run build
npm test  # if any tests exist for payroll
```
