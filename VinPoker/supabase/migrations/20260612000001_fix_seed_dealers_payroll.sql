-- =============================================================================
-- Fix dealer pay: all dealers are part_time with flat 50k/h rate
-- Tier is for table assignment ranking only, NOT for pay differentiation
-- =============================================================================

-- All dealers get the same rate regardless of tier
UPDATE public.dealers SET
  employment_type = 'part_time',
  hourly_rate_vnd = 50000,
  base_rate_vnd = NULL,
  updated_at = now()
WHERE employment_type IS NULL
   OR employment_type != 'part_time'
   OR hourly_rate_vnd IS NULL
   OR hourly_rate_vnd != 50000;
