# Dealer Swing — Toàn Bộ Codebase & Tài Liệu

> **Dự án:** VinPoker  
> **Project ID:** `orlesggcjamwuknxwcpk`  
> **Bot Token:** `8966181611:AAH0A_3WpRaZW6JD2Ss-EcpKrOy6b4cPIAY`  
> **Royal Club ID:** `22222222-2222-2222-2222-222222222222`  
> **FM Chat ID:** `8580772442`  
> **Group Chat ID:** `-1003620964119`  
> **Service Role Key:** `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9ybGVzZ2djamFtd3Vrbnh3Y3BrIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3ODk1MjAyMiwiZXhwIjoyMDk0NTI4MDIyfQ.Kb0mS0vny7_YqJI59mIieyq2YGgvCmb9HQFzhPP1ROc`  
> **Webhook Secret:** `e15cad04aa2942d194e05bfab77eafc7`

---

## Mục lục

1. [Tổng quan & Kiến trúc](#1-tổng-quan--kiến-trúc)
2. [Database Schema](#2-database-schema)
3. [Migrations](#3-migrations)
4. [RPCs (Stored Procedures)](#4-rpcs-stored-procedures)
5. [Triggers](#5-triggers)
6. [Shared Utilities](#6-shared-utilities)
7. [Edge Functions](#7-edge-functions)
8. [Frontend](#8-frontend)
9. [E2E Tests](#9-e2e-tests)
10. [Cron Jobs & Config](#10-cron-jobs--config)
11. [Vận Hành & Scoring](#11-vận-hành--scoring)
12. [Lịch sử quyết định](#12-lịch-sử-quyết-định-quan-trọng)

---

## 1. Tổng quan & Kiến trúc

### Vòng đời 1 dealer tại 1 bàn

```
check-in → available → assigned → pre_assigned (T-6) → swing (T-0) → available/on_break
```

### Luồng chính (Auto-Swing)

```
pg_cron (mỗi phút)
  │
  └─► process-swing (Edge Function)
        │
        ├─ Pass 1: Auto-fill bàn trống
        │   └─ fillEmptyTables() → pickNextDealer() → dealer_assignments.insert
        │
        ├─ Pass 2: Pre-assign dealer T-6
        │   └─ pickNextDealer() → lock pre_assigned_attendance_id → dealer state = pre_assigned
        │
        └─ Pass 3: Execute swing T-0
              ├─ execute_pre_assigned_swing() RPC (nếu có pre-assign)
              │   └─ CAS lock → verify pre_assigned còn hợp lệ → swing
              │   └─ pre_assigned_lost → fallback: perform_swing() + pickNextDealer()
              └─ perform_swing() RPC (legacy fallback)
                    └─ CAS lock → release old → create break? → assign new → audit log
```

### 3-Pass Architecture

**Pass 1 — Auto-fill bàn trống**
- Query tất cả `game_tables` active không có `dealer_assignments` active
- Sort theo `tour_tier` (HIGH → MEDIUM → LOW)
- Gọi `pickNextDealer()` với `excludeAttendanceIds` để tránh dealer trùng
- Insert `dealer_assignments`, update `current_state = 'assigned'`
- **Cleanup stale pre_assigned** (> 15 phút) → release lock
- **Clock sync**: piggyback `updated_at` từ cleanup query (tránh clock skew)

**Pass 2 — Pre-assign dealer T-6**
- Query assignments có `swing_due_at` trong window 4-8 phút tới, chưa có `pre_assigned_attendance_id`
- Gọi `pickNextDealer()` → CAS lock `pre_assigned_attendance_id`
- Update dealer attendance state → `pre_assigned`
- Telegram: group + DM cho incoming dealer

**Pass 3 — Execute swing T-0**
- Query assignments due (swing_due_at <= now + 5 phút OR force_all)
- Nếu có `pre_assigned_attendance_id`: gọi `execute_pre_assigned_swing()` RPC
  - Nếu `pre_assigned_lost`: fallback `perform_swing()` với `pickNextDealer()` mới
- Nếu không pre-assigned: `perform_swing()` legacy path
- Batch Telegram notification (1 msg/cycle per club)
- Realtime broadcast
- FM DM alert nếu `swung_no_dealer`

### Luồng phụ

```
enforceBreakBalance (cron 15 phút)
  └─ forced break (available quá threshold)
  └─ priority_break_flag (assigned quá threshold)

manage-break (manual)
  ├─ start → create break record, set on_break
  ├─ end → close break, reassign to table
  └─ return_from_break → complete_dealer_break RPC

close-table
  └─ release dealer, create break, deactivate table

checkout-dealer
  └─ atomic check-out + pre_assigned cleanup + FM alert
```

---

## 2. Database Schema

### 2.1 Tables

#### `dealers`
```sql
CREATE TABLE IF NOT EXISTS public.dealers (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  club_id UUID NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  full_name TEXT NOT NULL,
  phone TEXT,
  tier TEXT NOT NULL DEFAULT 'C' CHECK (tier IN ('A', 'B', 'C')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'on_leave')),
  hired_date DATE NOT NULL DEFAULT CURRENT_DATE,
  telegram_user_id BIGINT UNIQUE,         -- Sprint 3
  telegram_username TEXT,                  -- Sprint 3
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INDEX: idx_dealers_club(club_id), idx_dealers_status(status)
TRIGGER: update_dealers_updated_at (BEFORE UPDATE)
RLS: dealer_control + self + super_admin
```

#### `dealer_shifts` (Tour)
```sql
CREATE TABLE IF NOT EXISTS public.dealer_shifts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  club_id UUID NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  tour_name TEXT NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  tour_tier TEXT DEFAULT 'MEDIUM' CHECK (tour_tier IN ('HIGH', 'MEDIUM', 'LOW')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

#### `dealer_attendance`
```sql
CREATE TABLE IF NOT EXISTS public.dealer_attendance (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  dealer_id UUID NOT NULL REFERENCES public.dealers(id) ON DELETE CASCADE,
  shift_id UUID REFERENCES public.dealer_shifts(id) ON DELETE SET NULL,
  shift_date DATE NOT NULL DEFAULT CURRENT_DATE,
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'checked_in', 'checked_out', 'absent', 'overtime')),
  check_in_time TIMESTAMPTZ,
  check_out_time TIMESTAMPTZ,
  overtime_minutes INT NOT NULL DEFAULT 0,
  current_state TEXT DEFAULT 'available'
    CHECK (current_state IN ('available', 'assigned', 'on_break', 'checked_out', 'pre_assigned')),
  worked_minutes_since_last_break INTEGER DEFAULT 0,
  priority_break_flag BOOLEAN DEFAULT FALSE,
  pre_assigned_table_id UUID REFERENCES game_tables(id),  -- Sprint 3.5
  pre_assigned_at TIMESTAMPTZ,                              -- Sprint 3.6
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(dealer_id, shift_id, shift_date)
);
```

#### `game_tables`
```sql
CREATE TABLE IF NOT EXISTS public.game_tables (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  club_id UUID NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  table_name TEXT NOT NULL,
  table_type TEXT NOT NULL DEFAULT 'tournament' CHECK (table_type IN ('tournament')), -- cash/vip removed
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'maintenance')),
  current_blind_level INT NOT NULL DEFAULT 1,
  down_count INT NOT NULL DEFAULT 0,
  game_type TEXT NOT NULL DEFAULT 'NLH' CHECK (game_type IN ('NLH', 'PLO', 'OFC', 'Mixed')),
  shift_id UUID REFERENCES public.dealer_shifts(id) ON DELETE SET NULL,
  tour_tier TEXT NOT NULL DEFAULT 'MEDIUM' CONSTRAINT chk_tour_tier CHECK (tour_tier IN ('HIGH', 'MEDIUM', 'LOW')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT game_tables_club_table_shift_unique UNIQUE(club_id, table_name, shift_id)
);

UNIQUE INDEX: idx_game_tables_unassigned_unique (club_id, table_name) WHERE shift_id IS NULL
```

#### `dealer_assignments` (Journal trung tâm)
```sql
CREATE TABLE IF NOT EXISTS public.dealer_assignments (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  attendance_id UUID NOT NULL REFERENCES public.dealer_attendance(id) ON DELETE CASCADE,
  table_id UUID NOT NULL REFERENCES public.game_tables(id) ON DELETE CASCADE,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  released_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'assigned' CHECK (status IN ('assigned', 'on_break', 'completed')),
  version INT NOT NULL DEFAULT 0,
  swing_processed_at TIMESTAMPTZ,
  idempotency_key TEXT UNIQUE,
  swing_due_at TIMESTAMPTZ,                    -- Sprint 3 (trigger tính)
  pre_announce_due_at TIMESTAMPTZ,             -- Sprint 3
  pre_announced BOOLEAN NOT NULL DEFAULT false, -- Sprint 3
  pre_assigned_attendance_id UUID REFERENCES dealer_attendance(id), -- Sprint 3.5
  pre_assigned_at TIMESTAMPTZ,                  -- Sprint 3.5
  swing_fallback_reason TEXT,                   -- Sprint 3.6
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INDEXES:
  idx_dealer_assignments_table(table_id)
  idx_dealer_assignments_status(status)
  idx_dealer_assignments_attendance(attendance_id)
  idx_dealer_assignments_swing(swing_processed_at) WHERE swing_processed_at IS NULL
  idx_assignments_swing_due(swing_due_at) WHERE status='assigned' AND swing_processed_at IS NULL
  idx_assignments_pre_announce_due(pre_announce_due_at) WHERE status='assigned' AND pre_announced=false
  idx_assignments_pre_assign_pending(swing_due_at) WHERE status='assigned' AND pre_assigned_attendance_id IS NULL AND swing_processed_at IS NULL
  idx_assignments_pre_assign_ready(swing_due_at) WHERE status='assigned' AND pre_assigned_attendance_id IS NOT NULL AND swing_processed_at IS NULL
  idx_unique_active_assignment(table_id) WHERE status='assigned'  -- Phase 1

TRIGGER: trg_dealer_assignments_version (BEFORE UPDATE, bump version)
TRIGGER: trg_dealer_assignment_due_at (BEFORE INSERT/UPDATE OF assigned_at, calc swing_due_at)
```

#### `dealer_breaks`
```sql
CREATE TABLE IF NOT EXISTS public.dealer_breaks (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  assignment_id UUID NOT NULL REFERENCES public.dealer_assignments(id) ON DELETE CASCADE,
  break_start TIMESTAMPTZ NOT NULL DEFAULT now(),
  break_end TIMESTAMPTZ,
  expected_duration_minutes INT NOT NULL DEFAULT 20,
  reason TEXT,                                    -- Bug 2
  is_auto_triggered BOOLEAN,                      -- enforceBreakBalance
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INDEXES:
  idx_dealer_breaks_assignment(assignment_id)
  idx_dealer_breaks_assignment_end(assignment_id, break_end DESC NULLS LAST)  -- Phase 1
  idx_dealer_breaks_break_end(break_end DESC NULLS LAST)                     -- Sprint 3.6
```

#### `swing_config`
```sql
CREATE TABLE IF NOT EXISTS public.swing_config (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  club_id UUID NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  table_type TEXT NOT NULL CHECK (table_type IN ('tournament', 'cash', 'vip')),
  swing_duration_minutes INT NOT NULL DEFAULT 45,
  break_duration_minutes INT NOT NULL DEFAULT 20,
  warn_at_minutes INT NOT NULL DEFAULT 5,
  crit_at_minutes INT NOT NULL DEFAULT 1,
  tournament_mode TEXT NOT NULL DEFAULT 'time' CHECK (tournament_mode IN ('time', 'level')),
  break_return_policy TEXT NOT NULL DEFAULT 'fifo' CHECK (break_return_policy IN ('fifo', 'same_table', 'best_available')),
  pre_announce_minutes INTEGER NOT NULL DEFAULT 10,        -- Sprint 3
  minimum_break_duration_minutes INTEGER NOT NULL DEFAULT 10,  -- Phase 2
  UNIQUE(club_id, table_type)
);
```

#### `swing_audit_logs`
```sql
CREATE TABLE IF NOT EXISTS public.swing_audit_logs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  club_id UUID NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  shift_id UUID REFERENCES public.dealer_shifts(id) ON DELETE SET NULL,
  assignment_id UUID REFERENCES public.dealer_assignments(id) ON DELETE SET NULL,
  old_dealer_id UUID REFERENCES public.dealers(id) ON DELETE SET NULL,
  new_dealer_id UUID REFERENCES public.dealers(id) ON DELETE SET NULL,
  table_id UUID REFERENCES public.game_tables(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  details JSONB,
  triggered_by TEXT NOT NULL DEFAULT 'system',
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INDEXES: idx_swing_audit_logs_club(club_id), idx_swing_audit_logs_created(created_at DESC), idx_swing_audit_logs_action(action)
INDEX (Phase 3): idx_audit_late_checkin(old_dealer_id, created_at DESC) WHERE action='late_checkin'
```

#### Bảng phụ trợ khác
- `club_settings`: telegram_chat_id, floor_manager_chat_id (Phase 1), auto_swing_enabled (Sprint 3)
- `club_dealer_controls`: user_id, club_id (phân quyền dealer_control)
- `dealer_skills`: dealer_id, game_type (skill matching)
- `dealer_pay_rates`: club_id, tier, base_rate, overtime_rate
- `shift_break_policies`: club_id, shift_type, min/max work, target break duration
- `swing_metrics`: club_id, date, total/swings, success/fail, avg_processing_time_ms
- `dealer_attendance_log`: lịch sử thay đổi status attendance
- `special_dates`: club_id, date, multiplier (dự đoán nhu cầu dealer)
- `dealer_incidents`: sự cố dealer

### 2.2 Views

#### `dealer_shift_metrics` (Phase 3 — fixed)
```sql
CREATE OR REPLACE VIEW public.dealer_shift_metrics AS
SELECT
  da.id AS attendance_id, da.dealer_id, da.shift_id, d.club_id,
  COALESCE(SUM(
    EXTRACT(EPOCH FROM (COALESCE(dassign.released_at, NOW()) - dassign.assigned_at)) / 60
  ), 0)::INTEGER AS total_worked_minutes,
  COALESCE(SUM(
    EXTRACT(EPOCH FROM (COALESCE(db.break_end, NOW()) - db.break_start)) / 60
  ), 0)::INTEGER AS total_break_minutes,
  MAX(db.break_end) AS last_break_end,
  COUNT(DISTINCT dassign.id)::INTEGER AS total_assignments,
  COUNT(CASE WHEN gt.tour_tier = 'HIGH' THEN 1 END)::INTEGER AS high_table_assignments,
  COUNT(CASE WHEN gt.tour_tier = 'MEDIUM' THEN 1 END)::INTEGER AS medium_table_assignments,
  COUNT(CASE WHEN gt.tour_tier = 'LOW' THEN 1 END)::INTEGER AS low_table_assignments,
  EXTRACT(EPOCH FROM (NOW() - COALESCE(MAX(db.break_end), da.check_in_time, NOW()))) / 60 AS minutes_since_rest,
  da.current_state, da.priority_break_flag, da.worked_minutes_since_last_break
FROM public.dealer_attendance da
JOIN public.dealers d ON d.id = da.dealer_id
LEFT JOIN public.dealer_assignments dassign ON dassign.attendance_id = da.id
LEFT JOIN public.game_tables gt ON gt.id = dassign.table_id     -- JOIN added in Phase 3
LEFT JOIN public.dealer_breaks db ON db.assignment_id = dassign.id
WHERE da.status = 'checked_in'
GROUP BY da.id, da.dealer_id, da.shift_id, d.club_id, da.current_state, da.priority_break_flag, da.worked_minutes_since_last_break;
```

---

## 3. Migrations

### 3.1 Foundation — `20260522000001_dealer_swing_manager.sql`
- Role `dealer_control`, table `club_dealer_controls`
- Helper functions: `is_club_dealer_control()`, `dealer_control_club_ids()`
- Table `club_settings` (telegram_chat_id)
- Tables: `dealers`, `dealer_shifts`, `dealer_attendance`, `game_tables`, `dealer_assignments`, `dealer_breaks`, `dealer_skills`, `swing_config`, `audit_logs`, `dealer_incidents`
- Helper RPCs: `get_dealer_worked_times()`, `get_dealer_last_tables()`, `get_shift_payroll_summary()`
- Version bump trigger on `dealer_assignments`
- Seed swing_config defaults (cash=45m, tournament=30m, vip=45m)

### 3.2 Fix Worked Time — `20260523000002_fix_worked_time_break_deduction.sql`
- Sửa `get_dealer_worked_times()`: total = (check_out - check_in) - SUM(break durations)

### 3.3 Break Policy & State — `20260524000001_swing_break_policy_and_state.sql`
- Table `shift_break_policies`
- `tour_tier` vào `dealer_shifts`
- State machine columns: `current_state`, `worked_minutes_since_last_break`, `priority_break_flag`
- Table `swing_audit_logs`, `swing_metrics`
- VIEW `dealer_shift_metrics` (original version, later fixed)

### 3.4 Cron & Fixes — `20260525000001_schedule_enforce_break_balance.sql`
- pg_cron schedule: enforceBreakBalance mỗi 15 phút

### 3.5 Bug Fixes 1-6 — `20260526000001_fix_bugs_1_5_6.sql`
- Bug 1: Table-tour constraint (shift_id, unique index)
- Bug 2: `reason` column on `dealer_breaks`
- Bug 3: `dealer_attendance_log` table + trigger
- Bug 4: `select_dealer_for_update()` RPC (row-level lock)
- Bug 5: Fix `get_shift_payroll_summary` — deduct break time
- Bug 6: `special_dates` table + `predict_dealer_demand()` RPC

### 3.6 Pool Tables — `20260527000001_pool_100_tables.sql`
- Tạo 100 bàn inactive cho mỗi club, trigger `initialize_club_tables` cho club mới

### 3.7 Remove cash/vip — `20260527000002_remove_cash_vip_table_types.sql`
- Chuyển hết table_type = 'tournament'

### 3.8 Cleanup — `20260528000001_cleanup_swing_config_and_duplicates.sql`
- Xóa swing_config cash & vip rows
- Clean duplicate game_tables
- Fix trigger `initialize_club_tables` — thêm ON CONFLICT

### 3.9 perform_swing RPC — `20260528000002_perform_swing_rpc.sql`
- RPC `perform_swing()`: CAS lock + release + break + assign + audit trong 1 transaction

### 3.10 Swing Enhancements — `20260529000001_swing_enhancements.sql`
- `game_type` column on `game_tables`
- `dealer_pay_rates` table (thay CASE)
- Update `get_shift_payroll_summary` — đọc từ `dealer_pay_rates`
- `complete_dealer_break` RPC (original, later rewritten)

### 3.11 Auto-swing toggle — `20260530000001_auto_swing_enabled.sql`
- `auto_swing_enabled` column on `club_settings`

### 3.12 Sprint 3 Schema — `20260530000003_sprint3_schema.sql`
- `tour_tier` vào `game_tables`
- `pre_announce_minutes` vào `swing_config`
- Cột mới: `swing_due_at`, `pre_announce_due_at`, `pre_announced`
- Telegram columns: `telegram_user_id`, `telegram_username`
- Trigger `trg_calc_swing_due_at` (original, self-join bug later fixed)
- Indexes: `idx_assignments_swing_due`, `idx_assignments_pre_announce_due`
- Backfill existing assignments

### 3.13 pg_cron auto swing — `20260530000004_pg_cron_auto_swing.sql`
- Schedule `process-swing` mỗi phút

### 3.14 Pre-assign — `20260530000005_pre_assign_swing.sql`
- State `pre_assigned` added to CHECK constraint
- `pre_assigned_table_id` on `dealer_attendance`
- `pre_assigned_attendance_id`, `pre_assigned_at` on `dealer_assignments`
- Indexes: `idx_assignments_pre_assign_pending`, `idx_assignments_pre_assign_ready`, `idx_game_tables_status_active`
- RPC `execute_pre_assigned_swing()`

### 3.15 Cleanup pre_assigned — `20260530000006_cleanup_pre_assigned.sql`
- `pre_assigned_at` on `dealer_attendance` (for stale-lock detection)
- Indexes: `idx_dealer_attendance_stale_pre_assigned`, `idx_dealer_attendance_available`
- `swing_fallback_reason` on `dealer_assignments`
- `idx_dealer_breaks_break_end`

### 3.16 Phase 1 — `20260531000001_phase1_critical_fixes.sql`
- Fix trigger `trg_calc_swing_due_at` — JOIN qua `game_tables`, không self-join
- `idx_unique_active_assignment` — partial unique index (1 active assignment per table)
- `floor_manager_chat_id` on `club_settings`
- Recreate indexes: `idx_dealer_attendance_available`, `idx_dealer_attendance_pre_assigned_stale`, `idx_dealer_breaks_assignment_end`

### 3.17 Phase 2 — `20260601000001_phase2_break_duration.sql`
- `minimum_break_duration_minutes` on `swing_config` (default 10)
- Rewrite `complete_dealer_break`: tính actual duration, check min, reset có điều kiện

### 3.18 Phase 3 Table Type — `20260602000001_phase3_table_type_metric.sql`
- Fix VIEW: COUNT without DISTINCT, add `game_tables` JOIN
- Columns: `high_table_assignments`, `medium_table_assignments`, `low_table_assignments`

### 3.19 Phase 3 Late Check-in — `20260602000002_phase3_late_checkin.sql`
- Trigger `trg_log_late_checkin` — log late check-in (>15 phút) vào `swing_audit_logs`
- Dùng `(shift_date + start_time)::TIMESTAMPTZ` (fix night shift bug)
- Index `idx_audit_late_checkin` WHERE action = 'late_checkin'

---

## 4. RPCs (Stored Procedures)

### `perform_swing()`
File: `20260528000002_perform_swing_rpc.sql`
```sql
CREATE OR REPLACE FUNCTION public.perform_swing(
  p_old_assignment_id UUID,   p_old_version INT,
  p_old_attendance_id UUID,   p_new_attendance_id UUID,
  p_table_id UUID,            p_club_id UUID,
  p_shift_id UUID,            p_swing_reason TEXT,
  p_should_break BOOLEAN,     p_break_reason TEXT,
  p_break_duration INT,       p_new_dealer_id UUID,
  p_idempotency_key TEXT,     p_triggered_by TEXT,
  p_table_name TEXT,          p_old_dealer_name TEXT,
  p_new_dealer_name TEXT
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
-- 1. CAS lock: UPDATE dealer_assignments SET released_at, status='completed', version+1
--    WHERE id = p_old_assignment_id AND version = p_old_version AND status='assigned' AND swing_processed_at IS NULL
--    NOT FOUND → 'race_lost'
-- 2. Set old attendance → 'available'
-- 3. If p_should_break: INSERT dealer_breaks + set old attendance → 'on_break'
-- 4. If p_new_dealer_id: INSERT dealer_assignments + set new attendance → 'assigned'
-- 5. Insert swing_audit_logs
-- 6. Return {status: 'swung'|'swung_no_dealer', new_assignment_id, old_dealer_on_break}
$$;
```

### `execute_pre_assigned_swing()`
File: `20260530000005_pre_assign_swing.sql`
```sql
CREATE OR REPLACE FUNCTION public.execute_pre_assigned_swing(
  p_old_assignment_id UUID, p_old_version INTEGER,
  p_club_id UUID,          p_triggered_by TEXT DEFAULT 'cron'
) RETURNS JSONB
LANGUAGE plpgsql
AS $$
-- 1. Lock old assignment (SELECT FOR UPDATE with CAS)
-- 2. Check pre_assigned dealer còn 'pre_assigned' không → nếu không: 'pre_assigned_lost'
-- 3. Release old: status='completed', released_at=NOW(), swing_processed_at=NOW()
-- 4. Reset old dealer → 'available'
-- 5. New assignment cho pre-assigned dealer
-- 6. Activate new dealer → 'assigned', clear pre_assigned fields
-- 7. Audit log
-- 8. Return {status: 'swung'|'swung_no_dealer'|'pre_assigned_lost'|'race_lost'}
$$;
```

### `complete_dealer_break()` (Phase 2)
File: `20260601000001_phase2_break_duration.sql`
```sql
CREATE OR REPLACE FUNCTION public.complete_dealer_break(p_attendance_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
-- 1. SELECT ... FOR UPDATE SKIP LOCKED (lock break record)
-- 2. Tính actual duration (phút)
-- 3. Đọc minimum_break_duration từ swing_config
-- 4. Close break: SET break_end = now()
-- 5. Update attendance:
--    current_state='available', priority_break_flag=false
--    worked_minutes_since_last_break = 0 (nếu actual >= minimum)
--                                  = worked_minutes_since_last_break + actual (nếu < minimum)
-- 6. Return {status, break_id, actual_duration_minutes, minimum_duration, reset_worked}
$$;
```

### `select_dealer_for_update()`
File: `20260526000001_fix_bugs_1_5_6.sql`
```sql
-- Row-level lock với NOWAIT
PERFORM id FROM dealer_attendance WHERE id = p_attendance_id AND current_state = 'available' FOR UPDATE NOWAIT;
-- RETURN FOUND; EXCEPTION WHEN lock_not_available THEN RETURN false;
```

### Helper functions
- `is_club_dealer_control(user_id, club_id)` → BOOLEAN
- `dealer_control_club_ids(user_id)` → SETOF UUID
- `get_dealer_worked_times(shift_date)` → TABLE(dealer_id, total_minutes)
- `get_dealer_last_tables(dealer_ids[])` → TABLE(dealer_id, table_id)
- `get_shift_payroll_summary(club_id, shift_date)` → payroll table
- `predict_dealer_demand(club_id, date)` → suggested_dealers, multiplier, reasoning

---

## 5. Triggers

| Trigger | Bảng | Event | Hành động |
|---------|------|-------|-----------|
| `trg_dealer_assignments_version` | dealer_assignments | BEFORE UPDATE | `version = OLD.version + 1`, `updated_at = now()` |
| `trg_dealer_assignment_due_at` | dealer_assignments | BEFORE INSERT/UPDATE OF assigned_at | Tính `swing_due_at` = assigned_at + swing_duration, `pre_announce_due_at` = swing_due_at - pre_announce_minutes |
| `update_dealers_updated_at` | dealers | BEFORE UPDATE | `updated_at = now()` |
| `trg_attendance_log` | dealer_attendance | AFTER UPDATE OF status | Insert vào `dealer_attendance_log` |
| `trg_initialize_club_tables` | clubs | AFTER INSERT | Tạo 100 bàn pool mặc định |
| `trg_log_late_checkin` (Phase 3) | dealer_attendance | AFTER INSERT OR UPDATE OF status | Log >15 phút late vào `swing_audit_logs` |

### Trigger `trg_calc_swing_due_at` (Phase 1 fix)
```sql
CREATE OR REPLACE FUNCTION trg_calc_swing_due_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_duration INT;
  v_pre_announce INT;
BEGIN
  SELECT sc.swing_duration_minutes, sc.pre_announce_minutes
  INTO v_duration, v_pre_announce
  FROM game_tables gt
  JOIN swing_config sc ON sc.club_id = gt.club_id AND sc.table_type = gt.table_type
  WHERE gt.id = NEW.table_id
  LIMIT 1;

  NEW.swing_due_at := NEW.assigned_at + (COALESCE(v_duration, 45) || ' minutes')::INTERVAL;
  NEW.pre_announce_due_at := NEW.swing_due_at - (COALESCE(v_pre_announce, 10) || ' minutes')::INTERVAL;
  RETURN NEW;
END;
$$;
```

### Trigger `trg_log_late_checkin` (Phase 3)
```sql
-- Log late check-in (>15 phút) into swing_audit_logs
-- Dùng (shift_date + start_time)::TIMESTAMPTZ (fix night shift bug)
-- INSERT INTO swing_audit_logs(club_id, action='late_checkin', old_dealer_id, details, triggered_by='system')
```

---

## 6. Shared Utilities

### 6.1 `_shared/dealer-utils.ts` (422 lines)

File: `supabase/functions/_shared/dealer-utils.ts`

**Exports:**
- `corsHeaders` — CORS headers object
- `jsonResponse(data, status, extraHeaders)` — JSON response helper
- `getTableIdsForClub(admin, clubId)` → string[] — active table IDs
- `evaluateBreakNeed(admin, dealerId, shiftId, clubId, attendanceId, defaultBreakDuration)` → `{should_break, reason, urgency}`
  - Đọc `shift_break_policies` cho max/min work thresholds
  - Nếu `workedMinutes >= maxWork`: `{should_break: true, reason: "mandatory", urgency: "immediate"}`
  - Nếu `workedMinutes >= minWork`: kiểm tra break balance với các dealer khác
- `pickNextDealer(admin, clubId, shiftId, tableType, tourTier, swingDurationMinutes, requiredGameTypes, currentTableId, excludeAttendanceIds?)` → dealer | null
  - **Hard filters:** available, checked_in, same club, pool depletion, tier C excluded from HIGH, fatigue (<15 min to 120 mandatory)
  - **Scoring:** +1000 (new), +200/100/×5 rest step, -(30-phút)×2 near break, +(avg-dealer)×0.3 fairness, +(break-avg)×0.4 break balance, tier matching, +(avgHv-dealerHv)×3 high-value balance, **relative HIGH penalty** (Phase 3: dealer > avg+2 → -(excess-2)×10), -50 back-to-back, -(count-2)×15 consecutive, +matchCount×20 skill
  - **Return:** `scored[0] ?? null`
- `fillEmptyTables(admin, clubId, shiftId)` → assignments[]
  - Query active tables without active assignments
  - Sort HIGH→MEDIUM→LOW
  - Loop: pickNextDealer() → INSERT + UPDATE current_state
  - Pool depletion via `assignedAttendanceIds`

### 6.2 `_shared/telegram.ts` (320 lines)

File: `supabase/functions/_shared/telegram.ts`

**Format helpers:**
- `mention(dealer)` → `@username` or `full_name`
- `formatSwingMessage({tableName, tourName, outgoingDealer, incomingDealer, minutesLeft})` — 📋 Bàn X: @out ra, @in vào
- `formatPreAnnounceMessage({tableName, tourName, outgoingDealer, minutesLeft})` — ⏰ Bàn X: @out còn ~Y phút
- `formatBreakMessage({dealer, durationMinutes, startTime})` — ☕ @d đang nghỉ (Y phút)
- `formatBreakEndMessage({dealer, tableName})` — ✅ @d đã nghỉ xong
- `formatCloseTableMessage({tableName, tourName, lastDealer, workedMinutes, reason})` — 🔴 Đóng bàn X
- `formatMassAssignMessage(assignments[])` — 📋 Mass Assign (N bàn): \n  • Bàn X → @d
- `formatTierWarningMessage({tableName, tourTier, fallbackDealer})` — ⚠️ Bàn X: gán tạm @d
- `formatBreakAlertMessage({dealer, workedMinutes, clubName})` — ⚠️ Cảnh báo break: @d đã làm X phút
- `formatPreAssignMessage({tableName, tourTier, incomingDealer, minutesLeft})` — 🔔 Bàn X [TIER]: @d chuẩn bị
- `formatAutoFillMessage(assignments[])` — 🆕 Tự động gán dealer
- `formatPreAssignFallbackMessage({tableName, oldDealer, reason})` — ⚠️ Bàn X: dealer dự kiến {reason}
- `formatBatchSwingMessage(swings[], tourName?)` — 📋 N swings: \n  • Bàn X: @out ra, @in vào
- `formatCheckoutAlertMessage({dealerName, preAssignedTable})` — 🚨 Check-out đột ngột!

**Notify helpers:**
- `sendTelegramNotification(botToken, chatId, text, options?)` — retry 3× + exponential backoff
- `getClubTelegramChatId(admin, clubId)` → chat_id | null
- `notifyFloorManagerDM(botToken, admin, clubId, text)` — DM floor manager
- `notifyDealerDM(botToken, dealer, text)` — DM dealer (nếu có telegram_user_id)
- `notifyIncomingDealer(botToken, dealer, tableName, minutesLeft, chatId?)` — DM → fallback group

---

## 7. Edge Functions

### 7.1 `process-swing/index.ts` (518 lines)
**Deployed: v20**

File: `supabase/functions/process-swing/index.ts`

**Entry point**: `Deno.serve(async (req) => {...})`

**Body params**: `club_id`, `shift_id`, `manual_trigger`, `dry_run`, `force_all`, `required_game_types`

**Flow:**
1. Auth check (JWT decode)
2. Check auto_swing_enabled (nếu không manual/force)
3. **Pass 1**: Cleanup stale pre_assigned (> 15 phút) → clock sync piggyback → fillEmptyTables()
4. **Pass 2**: Query pre-assign window (swing_due_at 4-8 phút tới) → pickNextDealer → CAS lock pre_assigned_attendance_id → Telegram group + DM
5. **Pass 3**: Query due assignments (swing_due_at <= now+5 phút hoặc force_all):
   - Pre-assigned path: execute_pre_assigned_swing RPC → fallback nếu pre_assigned_lost
   - Legacy path: evaluateBreakNeed → pickNextDealer → perform_swing RPC
   - Batch Telegram (formatBatchSwingMessage, 1 msg/cycle per club)
   - FM DM alert nếu swung_no_dealer
   - Realtime broadcast
6. Update swing_metrics (daily aggregates)

### 7.2 `mass-assign/index.ts` (82 lines)
**Deployed: v8**

File: `supabase/functions/mass-assign/index.ts`

Fill tất cả bàn trống → dùng `fillEmptyTables()` shared → audit log → Telegram formatMassAssignMessage

### 7.3 `close-table/index.ts` (182 lines)
**Deployed: v6**

File: `supabase/functions/close-table/index.ts`

1. Verify dealer_control permission
2. Release pre_assigned dealer cho table này
3. Find active assignment → release + create break
4. Cleanup conflict row với cùng table_name
5. Deactivate table (status='inactive', shift_id=null)
6. Audit logs + Telegram notification

### 7.4 `manage-break/index.ts` (341 lines)
**Deployed: v10**

File: `supabase/functions/manage-break/index.ts`

**Actions**: `start`, `end`, `return_from_break`

- `start`: CAS update assignment status → 'on_break', create break record, Telegram
- `end`: CAS update back → 'assigned', close break record, optional reroute (break_return_policy), Telegram
- `return_from_break`: Call `complete_dealer_break` RPC (Phase 2), Telegram

### 7.5 `enforceBreakBalance/index.ts` (266 lines)
**Deployed: v7**

File: `supabase/functions/enforceBreakBalance/index.ts`

Cron mỗi 15 phút. Duyệt tất cả clubs:
- Available dealer > maxWorkThreshold: tạo break assignment + break record + force break
- Assigned dealer > maxWorkThreshold: set priority_break_flag + Telegram alert group + DM
- DM dealer (notifyDealerDM) với thông báo force break

### 7.6 `telegram-webhook/index.ts` (261 lines)
**Deployed: v3**

File: `supabase/functions/telegram-webhook/index.ts`

Commands:
- `/start` — Welcome message
- `/help` — Hướng dẫn
- `/link <dealer_code>` — Link dealer với Telegram (UUID hoặc phone)
- `/linkfloor <club_id>` — Link floor manager chat
- `/status` — Xem trạng thái hiện tại (bàn, thời gian còn lại)
- Unknown: gợi ý /help

### 7.7 `checkout-dealer/index.ts` (162 lines)
**Deployed: v3**

File: `supabase/functions/checkout-dealer/index.ts`

1. Get attendance info + auth check
2. If current_state == 'pre_assigned':
   - Release dealer_attendance (current_state → 'available', clear pre_assigned fields)
   - Clear pre_assigned_attendance_id on assignments
3. Check-out chính (status → 'checked_out', current_state → 'checked_out')
4. FM DM alert nếu đang pre_assigned
5. Group notification
6. Audit log

---

## 8. Frontend

### 8.1 Types & Hooks — `src/hooks/useDealerSwing.ts` (328 lines)

**Interfaces**: `Dealer`, `DealerAttendance`, `GameTable`, `DealerAssignment`, `SwingConfig`, `SwingAuditLog`, `SwingMetrics`, `ShiftBreakPolicy`, `SpecialDate`

**Hooks:**
| Hook | Query | Polling |
|------|-------|---------|
| `useCheckedInDealers(clubIds, shiftId?)` | dealer_attendance (checked_in today) | — |
| `useActiveTables(clubIds)` | game_tables (active) | — |
| `useAvailableTables(clubIds)` | game_tables (inactive, no shift_id) | — |
| `useActiveAssignments(clubIds, shiftId?)` | dealer_assignments (assigned/on_break) | 30s |
| `useSwingConfigs(clubIds)` | swing_config | — |
| `useSwingMetrics(clubIds)` | swing_metrics (today) | — |
| `useBreakPolicies(clubIds)` | shift_break_policies | — |
| `useSpecialDates(clubIds)` | special_dates | — |
| `useAuditLogs(clubIds, limit)` | audit_logs | — |

### 8.2 Main Component — `src/components/cashier/DealerSwingTab.tsx` (1766 lines)

**Layout**: 3-column responsive grid
- **Left (25%)**: RosterPanel — danh sách dealer theo trạng thái (Sẵn sàng/Đang bàn/Đang nghỉ), check-in/out buttons
- **Center (50%)**: TableGrid — bản đồ bàn với timer countdown, assign/break/close buttons
- **Right (25%)**: CommandCenter — auto-swing toggle, action buttons, break balance widget, audit log feed

**Sub-components:**
- `SwingPanel` — main orchestrator với tất cả state, dialogs, edge function calls
- `RosterPanel` — dealer list grouped by state, FatigueDot indicator
- `TableGrid` — filtered table cards, TimerCell countdown
- `CommandCenter` — actions + metrics + audit log
- `TimerCell` — 1s interval countdown, color-coded (red=crit, amber=warn, normal)
- `TierBadge` — A=yellow, B=silver, C=amber
- `TableTypeBadge` — tournament=blue
- `FatigueDot` — worked indicator (red≥90, amber≥60, green)
- `StatusPill` — Sẵn sàng/Đang bàn/Đang nghỉ
- `SwingConfigDialog` — swing/break duration, threshold, pre-announce config

**Dialogs:**
- Assignment modal (suggestions + manual assign)
- Check-in dialog (with re-check-in support)
- Check-out dialog (calls checkout-dealer edge function)
- Pool-based table creation dialog
- Telegram config dialog
- Swing config dialog
- Payroll preview dialog
- Create tour dialog
- Special dates dialog
- Close table confirmation

**Edge functions called:**
- `process-swing` — autoSwingAll, forceSwingAll
- `mass-assign` — massAssign
- `assign-dealer` — openAssignModal, confirmAssign
- `manage-break` — sendToBreak, endBreak
- `close-table` — closeTable
- `checkout-dealer` — doCheckout
- `telegram-swing-notifier` — sendTelegram, testTelegram

### 8.3 Page — `src/pages/CashierDashboard.tsx` (1044 lines)

Tabbed dashboard: Overview → Staking → Members → Reports → **Dealer Swing**
- Cột nav bên trái, chỉ hiện "Dealer Swing" khi user có dealer_control club
- Pass `clubIds` = dealerControlClubIds (hoặc clubIds nếu admin)

---

## 9. E2E Tests

### 9.1 `scripts/test-e2e-swing.ts` (272 lines)

Entry point: `deno run -A test-e2e-swing.ts <suite>`

**Suites:**
1. **Trigger + Unique Constraint**: Verify swing_due_at != NULL, reject duplicate active assignment (23505)
2. **Checkout Cleanup**: Set dealer pre_assigned → call checkout-dealer → verify cleanup
3. **Telegram Batch + FM Alert**: Webhook test → invoke process-swing → poll Telegram for messages

### 9.2 Test helpers

**`test-context.ts`** — TestContext class:
- `createFixture(shiftId?)` — tạo dealer + bàn + attendance + config
- `cleanupFixture()` — xóa test data
- `destroy()` — cleanup resources

**`test-data.ts`** — Factory functions:
- `createDealer(admin, clubId)` → dealer
- `createGameTable(admin, clubId, shiftId?)` → table
- `createAttendance(admin, dealerId, shiftId?)` → attendance
- `ensureSwingConfig(admin, clubId)` → config
- `cleanupTestData(admin, dealerId, tableId?)` — xóa attendance + dealer + table

**`test-utils.ts`** — Assertion helpers: `assert`, `assertNotNull`, `assertEqual`, `assertErrorCode`

**`telegram-simulator.ts`** — Telegram helpers:
- `sendTestWebhook(botToken, functionUrl, secretToken, payload)` → {ok, error}
- `getLastTelegramMessage(botToken, chatId, since)` → message text
- `waitForTelegramMessage(botToken, chatId, timeoutMs)` → message text (polling)

---

## 10. Cron Jobs & Config

### pg_cron schedules

**process-swing** (mỗi phút):
```sql
SELECT cron.schedule('process-swing-auto', '* * * * *',
  $$SELECT net.http_post(
    url := 'https://orlesggcjamwuknxwcpk.supabase.co/functions/v1/process-swing',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'Authorization', 'Bearer <anon_key>'),
    body := '{}'::jsonb
  ) AS request_id;$$
);
```

**enforceBreakBalance** (mỗi 15 phút):
```sql
SELECT cron.schedule('enforce-break-balance', '*/15 * * * *',
  $$SELECT net.http_post(
    url := 'https://orlesggcjamwuknxwcpk.supabase.co/functions/v1/enforceBreakBalance',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'Authorization', 'Bearer <service_role_key>'),
    body := '{}'::jsonb
  ) AS request_id;$$
);
```

### Environment Variables (required by edge functions)
- `SUPABASE_URL` — `https://orlesggcjamwuknxwcpk.supabase.co`
- `SUPABASE_SERVICE_ROLE_KEY` — service role JWT
- `SUPABASE_ANON_KEY` — anon key
- `TELEGRAM_BOT_TOKEN` — `8966181611:AAH0A_3WpRaZW6JD2Ss-EcpKrOy6b4cPIAY`
- `TELEGRAM_WEBHOOK_SECRET` — `e15cad04aa2942d194e05bfab77eafc7`

### Deployed Edge Function Versions
| Function | Version |
|----------|---------|
| process-swing | v20 |
| mass-assign | v8 |
| close-table | v6 |
| manage-break | v10 |
| enforceBreakBalance | v7 |
| telegram-webhook | v3 |
| checkout-dealer | v3 |

---

## 11. Vận Hành & Scoring

### 11.1 Logic Chấm Điểm Chọn Dealer (`pickNextDealer`)

#### Bộ Lọc Cứng (Hard Filters)
1. `current_state = 'available'` — dealer sẵn sàng
2. `status = 'checked_in'` — đã check-in
3. `dealers.club_id = clubId` — cùng club
4. **Pool depletion**: không chọn dealer đã được chọn trong cycle này
5. **HIGH tour → loại Dealer C** (không đủ trình độ)
6. **Fatigue hard-exclude**: thời gian đến mandatory break (120 phút) < 15 phút
7. Skill match (nếu requiredGameTypes có)

#### Bảng Chấm Điểm (Scoring)
| Yếu tố | Điểm | Ý nghĩa |
|--------|------|---------|
| **Dealer mới** (0 assignments + không back-to-back) | +1000 | Ưu tiên dealer chưa được gán |
| **Rest bonus** (≥20 phút / ≥10 phút / khác) | +200 / +100 / ×5 | Step function, không linear |
| **Near break** (< 30 phút đến mandatory) | -(30 - minutes) × 2 | Tránh gán cho dealer sắp break |
| **Công bằng workload** | +(avg - dealer) × 0.3 | Dealer làm ít được ưu tiên |
| **Cân bằng break** | +(break - avg) × 0.4 | Dealer nghỉ nhiều được ưu tiên |
| **Tier match HIGH** | A=+30, B=+5 | A ưu tiên bàn HIGH |
| **Tier match MEDIUM** | B=+20, A/C=+5 | B ưu tiên bàn MEDIUM |
| **Tier match LOW** | C=+20, B=+5, A=+2 | C ưu tiên bàn LOW |
| **High-value balance** (chỉ HIGH) | +(avgHv - dealerHv) × 3 | Phân bố đều bàn HIGH |
| **Relative penalty HIGH** (Phase 3) | -(dealerHv - avgHv - 2) × 10 | Phạt dealer > avg+2 HIGH assignments |
| **Back-to-back penalty** | -50 | Tránh dealer ngồi mãi 1 bàn |
| **Consecutive penalty** (≥3) | -(count - 2) × 15 | Không gọi 3+ lần liên tiếp |
| **Skill match bonus** | +matchCount × 20 | Kỹ năng phù hợp |

### 11.2 Flow Gửi Telegram

| Sự kiện | Chat | Nội dung | Format |
|---------|------|----------|--------|
| Pre-assign (T-6) | Group | 🔔 Bàn {name}: @dealer chuẩn bị ra bàn sau ~{n} phút | `formatPreAssignMessage` |
| Pre-assign (T-6) | DM dealer | 🔔 Chuẩn bị: Bàn {name} sau ~{n} phút | `notifyIncomingDealer` |
| Pre-announce (no dealer) | Group | ⏰ Bàn {name}: @out còn ~{n} phút. Floor chuẩn bị! | `formatPreAnnounceMessage` |
| Pass 3 batch swing | Group | 📋 N swings: table → out ra, in vào (còn X phút) | `formatBatchSwingMessage` |
| swung_no_dealer | FM DM | 🚨 Bàn {name}: TRỐNG — không có dealer thay! | `notifyFloorManagerDM` |
| Pre-assign fallback | Group | ⚠️ Bàn {name}: dealer dự kiến không còn available | `formatPreAssignFallbackMessage` |
| Pass 1 auto-fill | Group | 🆕 Tự động gán dealer (N bàn) | `formatAutoFillMessage` |
| Check-out pre_assigned | FM DM | 🚨 Check-out đột ngột! {name} (đang pre_assigned cho bàn {name}) | `formatCheckoutAlertMessage` |
| Force break | DM dealer | ☕ Bạn đã làm {n} phút. Hệ thống đang cho bạn nghỉ bắt buộc. | `notifyDealerDM` |
| Priority break flag | Group + DM | ⚠️ Cảnh báo break: {name} đã làm {n} phút | `formatBreakAlertMessage` |

### 11.3 Late Check-in (Phase 3)

Trigger trên `dealer_attendance` AFTER INSERT OR UPDATE OF status:
- So sánh `check_in_time` với `(shift_date + start_time)::TIMESTAMPTZ`
- Nếu > 15 phút → INSERT vào `swing_audit_logs` với action `'late_checkin'`
- Dùng `shift_date + start_time` (không `start_time::TIMESTAMPTZ`) để fix night shift bug

### 11.4 Break Duration Policy (Phase 2)

- `minimum_break_duration_minutes` trong `swing_config` (default 10)
- Khi kết thúc break (`complete_dealer_break` RPC):
  - Tính actual break duration
  - Nếu actual >= minimum → reset `worked_minutes_since_last_break = 0`
  - Nếu actual < minimum → cộng dồn: `worked_minutes_since_last_break + actual`

---

## 12. Lịch sử quyết định quan trọng

1. **Pre-announcement** không ghi tên dealer thay (chỉ "cần chuẩn bị")
2. **`pre_assigned`** state khóa dealer từ T-6 đến T-0 (tránh race condition)
3. **CAS lock** dùng `version` column + UPDATE WHERE conditions
4. **`dealer_attendance!attendance_id!inner`** để disambiguate PostgREST JOINs
5. **Fatigue hard-exclude** (không soft penalty)
6. **Rest bonus step function** (≥20→+200, ≥10→+100, else→×5) thay vì linear
7. **Minimum break** 10 phút; break ngắn hơn không reset worked time
8. **Batch Telegram digest** cho Pass 3 (1 msg/cycle), real-time cho pre-announce/pre-assign
9. **`notifyDealerDM()`** helper cho tất cả dealer DMs
10. **Clock sync**: piggyback `updated_at` từ stale cleanup query (thay vì RPC riêng)
11. **Table_type metric**: COUNT assignment rows (không DISTINCT tables) + relative penalty
12. **Late check-in**: `(shift_date + start_time)::TIMESTAMPTZ` (fix night shift bug)
13. **3-Pass order**: Pass 1 (auto-fill + cleanup) → Pass 2 (pre-assign) → Pass 3 (execute)
14. **Dealer C hard-excluded** từ HIGH tour (không đủ trình độ)
15. **Pool depletion**: `excludeAttendanceIds` set để tránh dealer trùng trong 1 cycle
