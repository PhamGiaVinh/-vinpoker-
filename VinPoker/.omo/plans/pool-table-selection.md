# Pool Table Selection Dialog - Show Bàn 1-100 with Multi-Select

## TL;DR
> **Summary**: Modify "Thêm bàn từ pool" dialog to show ALL pool tables (Bàn 1-100) instead of only currently available (unassigned active) tables. Users see full pool with status badges, can multi-select, and activate tables.
> **Deliverables**: 1 new hook in `useDealerSwing.ts`, dialog UI update in `DealerSwingTab.tsx`
> **Effort**: Quick
> **Parallel**: NO (2 sequential edits, but 1 file is a hook that must be done first)
> **Critical Path**: Add hook → Update dialog → Build verify

## Context
### Original Request
"Bây giờ khi ấn vào thêm bàn, hãy cho chọn danh sách từ bàn 1-bàn 100 và có thể chọn nhiều bàn 1 lúc, hãy lưu ý dealer có thể gán được vào các bàn này."

### Interview Summary
- User wants the "Thêm bàn từ pool" dialog to show ALL pool tables (Bàn 1-Bàn 100) instead of only "available" (active + unassigned) tables
- Multi-select must be preserved (already works)
- After activating a table from pool, dealers must be assignable (already works via existing assign flow)
- Current bug: dialog showed misleading "Đã hết bàn trống" when no active tables exist (fixed in previous session)

### Metis Review (gaps addressed)
- Pending — will incorporate findings

## Work Objectives
### Core Objective
Replace the pool dialog's data source from `useAvailableTables` (active-only) to a full pool query, and show status indicators per table.

### Deliverables
1. New `usePoolTables` hook in `src/hooks/useDealerSwing.ts`
2. Updated dialog in `src/components/cashier/DealerSwingTab.tsx`

### Definition of Done
- [ ] `npm run build` passes
- [ ] Dialog loads all Bàn 1-100 from DB when opened
- [ ] Each table shows: table name + status badge ("Chưa active", "Đang hoạt động", "Đã có dealer")
- [ ] Inactive + unassigned active tables can be checked (multi-select)
- [ ] Active+assigned tables show as disabled with "Đã có dealer" label
- [ ] Confirm button activates selected tables (status='active', shift_id, table_type)
- [ ] Table 11, 12, 13, 21, A25 are excluded from the list

### Must Have
- All pool tables visible (not just "available" subset)
- Clear status communication per table
- Multi-select + activation works

### Must NOT Have
- No changes to battlefield/TableGrid component
- No changes to dealer assignment flow
- No changes to existing table status data model

## Verification Strategy
- **Test decision**: Tests-after (manual + build verify)
- **QA policy**: Build verify + LSP diagnostics
- **Evidence**: Build output + final code review

## Execution Strategy
### Parallel Execution Waves
Wave 1: Add `usePoolTables` hook + Update dialog

### Dependency Matrix
- Task 1: Add hook → Task 2: Update dialog (blocked by Task 1) → Build verify

### Agent Dispatch Summary
Wave 1 → 2 tasks → hook + UI

## TODOs

- [ ] 1. Add `usePoolTables` hook in `useDealerSwing.ts`

  **What to do**: Add a new exported function `usePoolTables(clubIds: string[])` that queries ALL game_tables for the given club IDs (no status filter), ordered by table_name. Use `useRealtimeQuery` same as `useActiveTables`.

  **Must NOT do**: Do NOT modify existing hooks. Do NOT add filters except club_id.

  **Recommended Agent Profile**:
  - Category: `quick` - Reason: Single function addition, follows exact pattern of `useActiveTables`
  - Skills: [] - Reason: Simple pattern copy
  - Omitted: N/A

  **Parallelization**: Can Parallel: NO | Wave 1 | Blocks: [2] | Blocked By: []

  **References**:
  - Pattern: `src/hooks/useDealerSwing.ts:206-218` (useActiveTables — exact pattern to follow, just remove `.eq("status", "active")`)
  - Schema: `game_tables` columns: id, club_id, table_name, table_type, status, shift_id, current_blind_level, down_count, created_at
  - Import: `useRealtimeQuery` is defined locally in same file (line 73), no additional import needed

  **Acceptance Criteria**:
  - [ ] `usePoolTables` is exported from `useDealerSwing.ts`
  - [ ] It queries `supabase.from("game_tables").select("*").in("club_id", clubIds).order("table_name")`
  - [ ] It returns `{ data, loading, error, refetch }` matching the `useRealtimeQuery` return type
  - [ ] No LSP errors

  **QA Scenarios**:
  ```
  Scenario: Hook compiles and exports correctly
    Tool: Bash
    Steps: Run `npm run build` after adding the hook
    Expected: Build passes with no TS errors
    Evidence: .omo/evidence/task-1-hook-build.txt
  ```

  **Commit**: YES | Message: `feat(swing): add usePoolTables hook for full pool table listing` | Files: [`src/hooks/useDealerSwing.ts`]

- [ ] 2. Update pool dialog to use full pool table listing

  **What to do**: Modify the "Thêm bàn từ pool" Dialog in `DealerSwingTab.tsx` to:

  1. **Import and use `usePoolTables`**:
     ```ts
     // Near line 25, add to the import:
     usePoolTables,
     ```
     ```ts
     // Near line 68, add hook:
     const { data: poolTables, loading: poolLoading, error: poolError, refetch: refetchPoolTables } = usePoolTables(filteredClubIds);
     ```

  2. **Replace dialog content** (line 880-976):
     - Change data source from `availableTables` to `poolTables`
     - Show ALL pool tables (Bàn 1-100) regardless of status
     - For each table row, show:
       - Table name (e.g. "Bàn 1")
       - Status badge:
         - `status === 'inactive'` → Badge "Chưa active" (outline/gray)
         - `status === 'active' && !tableAssignmentMap[t.id]` → Badge "Sẵn sàng" (emerald)
         - `status === 'active' && tableAssignmentMap[t.id]` → Badge "Đã có dealer" (amber/warning), DISABLE checkbox
       - Checkbox (disabled for active+assigned tables)
     - Keep the same "Tìm bàn..." search filter
     - Keep the same exclude list: `!["11", "12", "13", "21", "A25"].includes(t.table_name)`
     - Keep the same "Chọn tất cả" / "Bỏ chọn" buttons (but only for selectable tables)
     - Keep the same table_type Select
     - Keep the same confirm handler (UPDATE status='active', shift_id, table_type)
     - Add `refetchPoolTables()` next to existing `refetchTables()` and `refetchAvailableTables()` in confirm handler
     - Remove the `availableTablesError` check blocks — replace with `poolError` handling

  3. **Multi-select behavior**:
     - Inactive tables → checkbox enabled, selecting will activate them
     - Active + no dealer → checkbox enabled (already usable)
     - Active + has dealer → checkbox disabled, with "Đã có dealer" label
     - "Chọn tất cả" only selects enabled (selectable) tables

  4. **Dialog title**: Keep "Thêm bàn từ pool" or change to "Chọn bàn từ pool" (optional)

  **Must NOT do**:
  - Do NOT modify `useAvailableTables` or `useActiveTables`
  - Do NOT change `tableAssignmentMap` logic
  - Do NOT change the activation SQL (UPDATE game_tables SET status='active'...)
  - Do NOT modify TableGrid component

  **Recommended Agent Profile**:
  - Category: `visual-engineering` - Reason: React TSX component modification with conditional rendering, badges, and multi-select logic
  - Skills: [] - Reason: Standard React patterns
  - Omitted: N/A

  **Parallelization**: Can Parallel: NO | Wave 1 | Blocks: [] | Blocked By: [1]

  **References**:
  - Current dialog code: `src/components/cashier/DealerSwingTab.tsx:880-976`
  - `tableAssignmentMap` definition: line 181-188 (available in same scope)
  - `poolTables` variable name: use `poolTables` (from Task 1 hook)
  - Existing exclude list: line 900 — `!["11", "12", "13", "21", "A25"].includes(t.table_name)`
  - Existing confirm handler: line 950-971
  - Badge component: `Badge` from shadcn/ui (already imported at top of file)
  - Table type: use `t.table_type` for badge display (already in data)
  - `cn()` utility: available from `src/lib/utils.ts`

  **Acceptance Criteria**:
  - [ ] Dialog shows all pool tables (Bàn 1-100 expected) with status badges
  - [ ] Inactive tables have checkbox enabled with "Chưa active" badge
  - [ ] Active + no dealer tables have checkbox enabled with "Sẵn sàng" badge
  - [ ] Active + assigned tables have checkbox disabled with "Đã có dealer" badge
  - [ ] "Chọn tất cả" only selects enabled (non-disabled) tables
  - [ ] Confirm activates selected inactive tables
  - [ ] Build passes (`npm run build`)
  - [ ] No LSP errors

  **QA Scenarios**:
  ```
  Scenario: Dialog renders all pool tables with correct badges
    Tool: Bash
    Steps: Run `npm run build`
    Expected: Build passes
    Evidence: .omo/evidence/task-2-dialog-build.txt
  ```

  **Commit**: YES | Message: `feat(swing): update pool table dialog to show all Bàn 1-100 with status` | Files: [`src/components/cashier/DealerSwingTab.tsx`]

## Final Verification Wave (MANDATORY — after ALL implementation tasks)
- [ ] F1. Plan Compliance Audit — oracle
- [ ] F2. Code Quality Review — unspecified-high
- [ ] F3. Real Manual QA — unspecified-high
- [ ] F4. Scope Fidelity Check — deep

## Commit Strategy
1. `feat(swing): add usePoolTables hook for full pool table listing`
2. `feat(swing): update pool table dialog to show all Bàn 1-100 with status`

## Success Criteria
- Pool dialog shows ALL Bàn 1-100 with clear status feedback
- Users can multi-select and activate tables
- Dealers can be assigned to activated tables (existing flow)
- `npm run build` passes
