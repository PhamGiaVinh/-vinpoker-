# Draft: Pool Table Selection Dialog

## Requirements (confirmed)
- Khi ấn "+ Thêm bàn" → hiển thị danh sách Bàn 1 đến Bàn 100 từ pool
- Có thể chọn nhiều bàn cùng lúc (giữ multi-select hiện tại)
- Dealer có thể gán được vào các bàn sau khi kích hoạt

## Technical Analysis
- `game_tables` table: club_id, table_name (e.g. "Bàn 1"), table_type, status ('active'|'inactive'|'maintenance'), shift_id, current_blind_level, down_count
- Pool được tạo tự động (100 bàn/club) với status = 'inactive' qua trigger `initialize_club_tables`
- Khi bàn được kích hoạt: status → 'active', shift_id → selectedTour

## Current Code
- **`useDealerSwing.ts`**: `useActiveTables()` lọc `.eq("status", "active")` → dùng cho battlefield
- **`useDealerSwing.ts`**: `useAvailableTables()` lấy active tables trừ các bàn đã có dealer → dùng cho pool dialog
- **`DealerSwingTab.tsx`** (line 880-976): Dialog "Thêm bàn từ pool" dùng `availableTables`
- **`DealerSwingTab.tsx`** (line 67): `tables` từ `useActiveTables`
- **`DealerSwingTab.tsx`** (line 68): `availableTables` từ `useAvailableTables`
- `tableAssignmentMap` đã có sẵn (từ `assignments`) → dùng để biết bàn nào đã có dealer

## What Needs to Change

### 1. Add `usePoolTables` hook in `useDealerSwing.ts`
- Fetch ALL `game_tables` for club (no status filter), `.order("table_name")`

### 2. Update dialog in `DealerSwingTab.tsx`
- Thêm import & hook: `usePoolTables`
- Đổi data source từ `availableTables` → `poolTables`
- Hiển thị tất cả bàn với status badge:
  - `inactive` → có thể chọn (để active)
  - `active` + chưa có dealer → đã active, có thể chọn (đã sẵn sàng)
  - `active` + đã có dealer → disabled (đã có người)
- Giữ nguyên multi-select, search, và activation logic
- Thêm `refetchPoolTables()` trong confirm handler

### 3. Activation logic (giữ nguyên)
- UPDATE game_tables SET status='active', shift_id=selectedTour, table_type=newTableType WHERE id IN (selectedIds)

## Open Questions (auto-resolved)
- [x] Query nào để lấy pool tables? → `usePoolTables` - SELECT * FROM game_tables WHERE club_id IN (...) ORDER BY table_name
- [x] Bàn active + có dealer thì sao? → Disable checkbox, hiển thị "Đã có dealer"
- [x] Bàn đã active + không dealer? → Cho phép chọn (đã sẵn sàng dùng)
- [x] Cần filter bàn đặc biệt? → Giữ filter hiện tại: !["11","12","13","21","A25"]

## Scope Boundaries
- IN: Pool dialog hiển thị tất cả bàn, multi-select, activation
- OUT: Không thay đổi battlefield/TableGrid, không thay đổi assign dealer flow
