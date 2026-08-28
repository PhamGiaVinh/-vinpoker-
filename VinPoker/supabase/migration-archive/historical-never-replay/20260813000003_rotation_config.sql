-- Forward Rotation Scheduler — R5 tier thresholds (configurable per club).
--
-- tournaments.buy_in assumed VND: > tier_a_min_buyin → tier A preferred,
-- >= tier_b_min_buyin → tier B, below → tier C. Adjustable without redeploy.
--
-- NOTE: swing_config.rotation_planner_enabled keeps its FALSE default.
-- It is repurposed as the scheduler switch (true = new Forward Rotation
-- Scheduler, false = legacy Pass 2 path) and is flipped PER CLUB via the
-- Management API only after the Stage 2 functional gates pass.

BEGIN;

ALTER TABLE public.swing_config
  ADD COLUMN IF NOT EXISTS tier_a_min_buyin BIGINT NOT NULL DEFAULT 10000000;

ALTER TABLE public.swing_config
  ADD COLUMN IF NOT EXISTS tier_b_min_buyin BIGINT NOT NULL DEFAULT 3000000;

-- The scheduler switch was never declared in any migration (the edge function
-- read it with a code-side false default). Declare it explicitly, default OFF.
ALTER TABLE public.swing_config
  ADD COLUMN IF NOT EXISTS rotation_planner_enabled BOOLEAN NOT NULL DEFAULT false;

COMMIT;
