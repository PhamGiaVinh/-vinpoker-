-- Add the dedicated club-scoped `floor` role to the app_role enum (mirrors how
-- `media` / `cashier` / `dealer_control` were added). Kept in its OWN migration so
-- the value is committed before any object references it (the club_floors table +
-- helpers in 20261025000001 do NOT use the value — membership is via the table).
--
-- SOURCE-ONLY: apply via the controlled Management-API path (NOT `db push`).
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'floor';
