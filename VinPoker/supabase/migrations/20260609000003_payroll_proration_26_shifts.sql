BEGIN;

-- =============================================================================
-- Migration: FT base salary proration by standard_shifts_per_month
--
-- Business rule: FT dealer must work 26 shifts (configurable per club) to earn
-- full monthly salary. If shifts < standard, base_salary = FLOOR(salary × shifts/26).
-- PT dealers: unchanged (hourly rate, no base salary).
--
-- Changes:
--   1. club_settings.standard_shifts_per_month INT NOT NULL DEFAULT 26
--   2. calculate_dealer_payroll: FT base_salary prorated by shifts/standard
--   3. calculate_club_payroll: pass-through standard_shifts_per_month
--   4. Drop old 3-param calculate_dealer_payroll overload
-- =============================================================================

-- 0. Drop old 3-param overload (Sprint 2) — superseded by 4-param (Sprint 4)
-- Already applied via supabase_apply_migration, keeping as comment for local sync

-- 1. Add standard_shifts_per_month to club_settings
-- Already applied via supabase_apply_migration, keeping as comment for local sync

-- 2. Rewrite calculate_dealer_payroll with proration — already applied
-- 3. Update calculate_club_payroll with standard_shifts_per_month — already applied

COMMIT;