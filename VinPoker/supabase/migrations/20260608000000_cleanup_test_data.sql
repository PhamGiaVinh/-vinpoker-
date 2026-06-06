-- =============================================================================
-- Migration: 20260608000000_cleanup_test_data.sql
-- Cleanup test pollution from dealer_attendance and dealer_breaks tables
-- Applied: 2026-06-08 (canary + Saigon Poker Club)
--
-- Test pollution discovered during payroll v2 verification:
--   1. 9 STALE dealer_attendance records (duration 53-125h) with check_out
--      set 3-4 days after check_in. Pattern: 5/30 18:38 or 5/31 00:19
--      check_in, with check_out timestamp shared across all (6/4 01:15:31).
--   2. 32 dealer_breaks records with break_end set 25-1500 min after break_start
--      when expected_duration_minutes was 12-60. Pattern: shared end timestamp
--      (6/1 04:25:03.xxxxxx across Saigon, 6/1 04:25:05.xxxxxx across Hanoi).
--
-- Cleanup actions:
--   A. NULL out pre_assigned_attendance_id references to STALE attendances
--      (9 dealer_assignments updated, allows cascade DELETE)
--   B. DELETE 9 STALE attendances (cascades dealer_assignments + dealer_breaks)
--   C. UPDATE 32 polluted breaks: break_end = break_start + expected_duration
--
-- This preserves history (breaks still exist with corrected end times).
--
-- Pre-cleanup RPC snapshot (Hanoi Royal Poker 5/25-6/7):
--   - 6 dealers with negative total_hours (dl 2, 3, 4, 8, 14, pgv)
--   - 6 dealers with negative base_pay (same set, total negative base = -10.97M VND)
--
-- Post-cleanup RPC snapshot:
--   - All dealers show positive total_hours, regular_hours, ot_hours
--   - All base_pay values positive
--   - Math consistent: total_hours = regular_hours + ot_hours
-- =============================================================================

BEGIN;

-- Step A: NULL pre_assigned_attendance_id references
UPDATE dealer_assignments
SET pre_assigned_attendance_id = NULL
WHERE pre_assigned_attendance_id IN (
  'c4aa2c24-1962-4ca1-8537-70a20993ba95',  -- dl 1 5/30
  '748c12c5-e7f0-4b77-92cc-a6a5fb478731',  -- dl 10 5/30
  '3256ee1a-8a7c-492f-85a1-34cfb6f8c92c',  -- dl 10 5/31
  'a7a5e973-d6ff-4b07-9990-bd148e5fae36',  -- dl 6 5/30
  'a95eaa89-b005-4e9e-9d42-39658d8d94f3',  -- dl 7 5/30
  '5045a3e2-589d-4d4a-92eb-6b83bd4dc6dd',  -- dl 7 5/31
  'bcbaa93a-fd33-4e55-8028-fcc872d2c092',  -- dl 8 5/31
  'd76daa48-4e6a-4208-803d-77fec2401a85',  -- dl 9 5/31
  '7dcb16ca-01af-4919-96c9-41c66b8fe76b'   -- dl 15 5/31 (open 125h)
);

-- Step B: DELETE STALE attendances (cascade: assignments → breaks)
DELETE FROM dealer_attendance
WHERE id IN (
  'c4aa2c24-1962-4ca1-8537-70a20993ba95',
  '748c12c5-e7f0-4b77-92cc-a6a5fb478731',
  '3256ee1a-8a7c-492f-85a1-34cfb6f8c92c',
  'a7a5e973-d6ff-4b07-9990-bd148e5fae36',
  'a95eaa89-b005-4e9e-9d42-39658d8d94f3',
  '5045a3e2-589d-4d4a-92eb-6b83bd4dc6dd',
  'bcbaa93a-fd33-4e55-8028-fcc872d2c092',
  'd76daa48-4e6a-4208-803d-77fec2401a85',
  '7dcb16ca-01af-4919-96c9-41c66b8fe76b'
);

-- Step C: UPDATE 32 polluted breaks (Hanoi 23, Saigon 8) where actual elapsed
-- time > 60 min but expected_duration_minutes <= 60. Reset break_end to be
-- consistent with the expected duration (what the data SHOULD have been).
-- Includes breaks linked to STALE attendances that may have escaped the cascade.
UPDATE dealer_breaks
SET break_end = break_start + (COALESCE(expected_duration_minutes, 20) || ' minutes')::INTERVAL
WHERE id::text IN (
  -- Hanoi (22 records, surviving the cascade)
  '3d0ffb07-e2e0-4d70-a841-761ea489b844',  -- dl 10 6/1 (86 min, expect 20)
  '29da01fe-fe98-4759-93d8-9bd39d3a4131',  -- dl 10 6/2 (295 min, expect 15)
  '638693c4-b41b-4210-b7c1-ffafe5ccf59d',  -- dl 10 6/3 (2188 min, expect 30)
  'cbec375d-1da6-4192-a6ff-83cdec882a18',  -- dl 14 6/3 (1274 min, expect 20)
  'f7aa17f1-d000-4907-90a0-ce4c894e5202',  -- dl 2 5/30 (1968 min, expect 20)
  '6516839b-8bcd-47d0-9370-81107f10eb74',  -- dl 2 5/31 (1681 min, expect 15)
  '1762c884-8b1b-45d2-b8fa-a355cd93277d',  -- dl 3 5/30 (1711 min, expect 20)
  '9cb99e51-8d6e-4fea-8d72-8f91f0ac49ef',  -- dl 3 5/31 (1669 min, expect 20)
  'b4ec303b-0487-4757-9cf9-2ff52ab72a0f',  -- dl 4 5/31 (1681 min, expect 15)
  '11ca4848-ffc3-4a91-914d-ae517072d491',  -- dl 4 5/31 (368 min, expect 20)
  '6b168b5b-2c5b-46ee-8ca0-addc3ac89267',  -- dl 7 6/2 (138 min, expect 15)
  '76c9d90a-aa0f-4452-afc7-b7788eece79e',  -- dl 8 6/3 (2187 min, expect 30)
  'fd4a78a2-6bc8-4a43-b07b-1ab7936611b2',  -- dl 8 6/4 (907 min, expect 20)
  '452ecd5a-b46d-4b74-bcd0-0da63cfaac8b',  -- dl 9 5/31 (1573 min, expect 20)
  '7972f2d8-1d16-4d75-b121-22209649f019',  -- dl 9 6/1 (85 min, expect 20)
  '73de744e-b6f7-4378-8248-a6c57de085b2',  -- pgv 5/30 (1979 min, expect 20)
  'a091bcb0-d8c2-4047-afa8-6551fee12dac',  -- pgv 5/30 (1711 min, expect 20)
  'bbac8e2c-00f3-4ae6-80bd-cca598d074fb',  -- pgv 5/31 (1669 min, expect 20)
  '4dab2d97-a8de-40f0-8fb7-65d6fd61d99c',  -- dl 12 6/1 (240 min, expect 60)
  '212d1cb0-1d9c-4d00-ba7b-9c5f050725ad',  -- dl 2 6/1 (241 min, expect 59)
  '689be943-16af-40b8-8d66-b79c2df7dc37',  -- dl 2 6/1 (241 min, expect 59)
  '1ce0ff80-624f-4edd-9deb-172aa0de45f1',  -- dl 4 6/1 (241 min, expect 59)
  'c7190d9b-cf9c-45bd-a2a0-96850a929a11',  -- pgv 6/1 (240 min, expect 60)
  -- Saigon (8 records)
  'fd60f36d-b832-4eb5-9df3-dd1a2e9bc1ad',  -- Bui Van G 5/31 (1505 min, expect 20)
  '1a8aadba-eed6-4b42-b3b7-636ce5541ad2',  -- Hoang Van E 5/31 (1505 min, expect 20)
  'dabc07df-eabe-49a4-b218-8b392ebb0e4d',  -- Le Van C 5/30 (2038 min, expect 20)
  'f13208cb-bc93-4f39-afe8-e72df9a8633c',  -- Ngo Thi F 5/31 (355 min, expect 60)
  '082c7e23-cf87-4ca5-8375-459cc5a25517',  -- Nguyen Van A 5/30 (2038 min, expect 20)
  '32cf8b81-c015-40c3-ae83-8abc265eb840',  -- Pham Thi D 5/31 (1505 min, expect 20)
  '89d0365d-da78-4f09-98bb-f9f716bcab0d',  -- Tran Thi B 5/30 (2038 min, expect 20)
  'e6bb3b4b-6e9b-4e0e-8c98-348a26faf685'   -- Vu Van I 5/31 (1505 min, expect 20)
);

COMMIT;
