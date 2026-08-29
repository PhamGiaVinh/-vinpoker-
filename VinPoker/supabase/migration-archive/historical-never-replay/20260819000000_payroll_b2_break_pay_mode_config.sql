-- ═══════════════════════════════════════════════════════════════════════════════
-- PAYROLL B2-PR2: break-pay-mode policy config (SOURCE-ONLY — NOT APPLIED)
--
-- Owner decision (2026-06-13, recorded in docs/payroll/B2_BREAK_PAY_MODE_DECISION.md):
-- payroll supports CONFIGURABLE break-pay modes instead of one hardcoded rule.
--
--   paid_break (DEFAULT)        breaks stay paid; hours = check-in -> check-out;
--                               grace_minutes is display/warning-only, money untouched
--   unpaid_break_with_grace     deduct clamped break minutes BEYOND grace_minutes
--   unpaid_break_full           deduct ALL clamped break minutes
--
-- "Clamped" = intersection of the break with [check_in, check_out] — mandatory
-- because 68% of recorded breaks end after checkout (audit: PR #46,
-- docs/payroll/B2_BREAK_DEDUCTION_AUDIT_POLICY_SPEC.md).
--
-- ZERO BEHAVIOR CHANGE even when applied: additive columns with dealer-friendly
-- defaults; the payroll formula (calculate_dealer_payroll) does NOT read these
-- columns yet. Formula wiring is B2-PR3, separately gated on owner approval and
-- on the still-open Q3 decision (deduct before vs after the regular/OT split).
--
-- ROLLBACK:
--   ALTER TABLE public.shift_break_policies
--     DROP CONSTRAINT IF EXISTS chk_break_pay_mode,
--     DROP CONSTRAINT IF EXISTS chk_break_grace_minutes,
--     DROP COLUMN IF EXISTS break_pay_mode,
--     DROP COLUMN IF EXISTS grace_minutes;
-- ═══════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.shift_break_policies
  ADD COLUMN IF NOT EXISTS break_pay_mode TEXT NOT NULL DEFAULT 'paid_break',
  ADD COLUMN IF NOT EXISTS grace_minutes INTEGER NOT NULL DEFAULT 35;

ALTER TABLE public.shift_break_policies
  DROP CONSTRAINT IF EXISTS chk_break_pay_mode;
ALTER TABLE public.shift_break_policies
  ADD CONSTRAINT chk_break_pay_mode
    CHECK (break_pay_mode IN ('paid_break', 'unpaid_break_with_grace', 'unpaid_break_full'));

ALTER TABLE public.shift_break_policies
  DROP CONSTRAINT IF EXISTS chk_break_grace_minutes;
ALTER TABLE public.shift_break_policies
  ADD CONSTRAINT chk_break_grace_minutes CHECK (grace_minutes >= 0);
