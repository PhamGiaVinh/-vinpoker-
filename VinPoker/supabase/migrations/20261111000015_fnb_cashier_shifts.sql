-- F&B A3 — per-shift cash reconciliation (chốt ca): SCHEMA. DEPENDS ON 000001 (is_club_fnb /
-- is_club_owner) + 000002 (fnb_orders). SOURCE-ONLY.
--
-- Apply in a controlled session (Supabase SQL Editor / Management API / `supabase db query --linked
-- --file`), owner-gated, AFTER review. NOT `db push` / not `db reset` / not `migration up` / not
-- deploy_db. schema_migrations untouched. types.ts regen is a SEPARATE step. Number 20261111000015
-- verified FREE on origin/main (2026-07-02: F&B series tops at …0014; SePay uses 20261112*+).
--
-- WHY: give the counter cashier a cash-drawer reconciliation. Open a shift at start of work, take
--   F&B orders, then close it by counting the physical cash and recording the variance (khớp/thiếu/
--   thừa) against the system-expected cash. F&B is cash-only at the counter (SePay/VietQR are
--   tournament buy-ins, not F&B).
--
-- DESIGN — TIME-WINDOW attribution (NOT a shift_id stamped on orders):
--   A shift owns every order whose paid_at (sale) / cancelled_at (refund) falls in
--   [opened_at, closed_at]. Recognition is event-time (same basis as the finance RPCs in …0011),
--   and the one-open-shift-per-club unique index makes shift windows non-overlapping, so each paid
--   order maps to exactly one shift by time. Consequence: A3 is PURELY ADDITIVE — it does NOT add a
--   column to fnb_orders and does NOT re-touch fnb_mark_paid / fnb_create_order /
--   fnb_create_comp_order / any finance RPC. This migration adds ONE table + its indexes + RLS.
--   (Known gap, acceptable v1: an order paid while NO shift is open belongs to no shift; the report
--   RPC can surface it. The stamp-shift_id-at-pay variant is the future zero-gap upgrade.)
--
-- FLAG: fnbShifts (default false) — the frontend ships dark in a SEPARATE PR. Flip after apply + UAT.
-- ROLLBACK: see bottom of this file.

-- ===========================================================================================
-- fnb_cashier_shifts — one row per opened cash shift. Mutated exactly twice: INSERT at open,
--   UPDATE (status→closed + frozen expected/counted/variance) at close. NOT append-only.
-- ===========================================================================================
CREATE TABLE IF NOT EXISTS public.fnb_cashier_shifts (
  id                uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  club_id           uuid NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  status            text NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  opened_by         uuid DEFAULT auth.uid(),
  opened_at         timestamptz NOT NULL DEFAULT now(),
  closed_by         uuid,
  closed_at         timestamptz,
  opening_float_vnd bigint NOT NULL DEFAULT 0,   -- tiền quỹ đầu ca (0 if the club doesn't use a float)
  expected_cash_vnd bigint,                       -- Σ paid non-comp subtotal − refunds in window (EXCL float); frozen at close
  counted_cash_vnd  bigint,                       -- physical drawer count entered by the cashier at close
  variance_vnd      bigint,                       -- counted − (opening_float + expected_cash); frozen at close (thiếu<0 / thừa>0)
  note              text,
  client_request_id text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.fnb_cashier_shifts IS
  'A3: F&B counter cash shift. expected_cash_vnd = event-time cash sales − refunds in [opened_at,closed_at] '
  '(comps excluded, subtotal 0); variance_vnd = counted − (opening_float + expected_cash). Time-window '
  'attribution — orders are NOT stamped with a shift_id.';

-- One OPEN shift per club — race-safe at the DB level (mirror of uq_fnb_stocktake_one_open, …0009).
CREATE UNIQUE INDEX IF NOT EXISTS uq_fnb_cashier_shift_one_open
  ON public.fnb_cashier_shifts (club_id) WHERE status = 'open';

-- Idempotency for fnb_open_shift (per club + client_request_id).
CREATE UNIQUE INDEX IF NOT EXISTS uq_fnb_cashier_shift_crid
  ON public.fnb_cashier_shifts (club_id, client_request_id) WHERE client_request_id IS NOT NULL;

-- Browse / history.
CREATE INDEX IF NOT EXISTS idx_fnb_cashier_shifts_club
  ON public.fnb_cashier_shifts (club_id, status, opened_at DESC);

-- RLS: SELECT-only for F&B staff / owner of the club; writes go ONLY through the SECURITY DEFINER
-- RPCs in …0016 (no client write policy). Same posture as the other fnb_* tables (…0002).
ALTER TABLE public.fnb_cashier_shifts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.fnb_cashier_shifts FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.fnb_cashier_shifts TO authenticated;

DROP POLICY IF EXISTS fnb_cashier_shifts_select ON public.fnb_cashier_shifts;
CREATE POLICY fnb_cashier_shifts_select ON public.fnb_cashier_shifts
  FOR SELECT TO authenticated
  USING (public.is_club_fnb(auth.uid(), club_id) OR public.is_club_owner(auth.uid(), club_id));

-- ===========================================================================================
-- ROLLBACK (undo this migration):
--   DROP TABLE IF EXISTS public.fnb_cashier_shifts;   -- drops its indexes + policy with it
-- ===========================================================================================
