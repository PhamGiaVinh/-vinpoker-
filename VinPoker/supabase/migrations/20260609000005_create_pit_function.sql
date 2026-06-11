BEGIN;

-- =============================================================================
-- Migration: create_pit_vn() — Vietnamese Progressive Personal Income Tax
-- Standard: Thông tư 111/2013/TT-BTC (still in effect 2024-2026)
-- Monthly brackets:
--   Bậc 1 :     0 –   5,000,000  →  5%
--   Bậc 2 :  5M  –  10,000,000  → 10%
--   Bậc 3 : 10M  –  18,000,000  → 15%
--   Bậc 4 : 18M  –  32,000,000  → 20%
--   Bậc 5 : 32M  –  52,000,000  → 25%
--   Bậc 6 : 52M  –  80,000,000  → 30%
--   Bậc 7 : > 80M              → 35%
--
-- Implementation notes:
--   - Integer arithmetic: (amount * rate_num / rate_denom) avoids float errors
--   - Returns BIGINT (whole VND, no decimals)
--   - FLOOR rounding: conservative, favours employee
--   - IMMUTABLE: safe for query optimisation (LEAKPROOF requires superuser, not available on Supabase)
--   - Safe to re-run (CREATE OR REPLACE)
-- =============================================================================

CREATE OR REPLACE FUNCTION calculate_pit_vn(
  p_taxable_income NUMERIC
)
RETURNS BIGINT
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_remaining NUMERIC;
  v_pit      NUMERIC := 0;
  v_tax_part NUMERIC;
BEGIN
  IF p_taxable_income IS NULL OR p_taxable_income <= 0 THEN
    RETURN 0;
  END IF;

  v_remaining := p_taxable_income;

  -- Bậc 1: 0 – 5,000,000 @ 5%   (span = 5M)
  v_tax_part  := LEAST(v_remaining, 5000000);
  v_pit       := v_pit + (v_tax_part * 5) / 100;
  v_remaining := GREATEST(v_remaining - 5000000, 0);

  -- Bậc 2: 5M – 10M @ 10%       (span = 5M)
  v_tax_part  := LEAST(v_remaining, 5000000);
  v_pit       := v_pit + (v_tax_part * 10) / 100;
  v_remaining := GREATEST(v_remaining - 5000000, 0);

  -- Bậc 3: 10M – 18M @ 15%      (span = 8M)
  v_tax_part  := LEAST(v_remaining, 8000000);
  v_pit       := v_pit + (v_tax_part * 15) / 100;
  v_remaining := GREATEST(v_remaining - 8000000, 0);

  -- Bậc 4: 18M – 32M @ 20%      (span = 14M)
  v_tax_part  := LEAST(v_remaining, 14000000);
  v_pit       := v_pit + (v_tax_part * 20) / 100;
  v_remaining := GREATEST(v_remaining - 14000000, 0);

  -- Bậc 5: 32M – 52M @ 25%      (span = 20M)
  v_tax_part  := LEAST(v_remaining, 20000000);
  v_pit       := v_pit + (v_tax_part * 25) / 100;
  v_remaining := GREATEST(v_remaining - 20000000, 0);

  -- Bậc 6: 52M – 80M @ 30%      (span = 28M)
  v_tax_part  := LEAST(v_remaining, 28000000);
  v_pit       := v_pit + (v_tax_part * 30) / 100;
  v_remaining := GREATEST(v_remaining - 28000000, 0);

  -- Bậc 7: > 80M @ 35%
  v_pit       := v_pit + (v_remaining * 35) / 100;

  RETURN FLOOR(v_pit)::BIGINT;
END;
$$;

-- ---------------------------------------------------------------------------
-- Smoke tests — run manually to verify; do NOT remove comments.
-- ---------------------------------------------------------------------------
-- SELECT calculate_pit_vn(0);           -- expected: 0
-- SELECT calculate_pit_vn(-1000000);    -- expected: 0
-- SELECT calculate_pit_vn(4000000);     -- expected: 200000
-- SELECT calculate_pit_vn(5000000);     -- expected: 250000
-- SELECT calculate_pit_vn(10000000);    -- expected: 750000
-- SELECT calculate_pit_vn(18000000);    -- expected: 1950000
-- SELECT calculate_pit_vn(32000000);    -- expected: 4750000
-- SELECT calculate_pit_vn(52000000);    -- expected: 9750000
-- SELECT calculate_pit_vn(80000000);    -- expected: 18150000
-- SELECT calculate_pit_vn(100000000);   -- expected: 25150000
-- SELECT calculate_pit_vn(5000001);     -- expected: 250000  (boundary + 1 dong)
-- ---------------------------------------------------------------------------
-- Canary: FT gross ~9-10M, taxable < 0 → pit = 0  ✓
-- Canary: PT gross ~8-11M, taxable < 0 → pit = 0  ✓
-- ---------------------------------------------------------------------------

COMMIT;