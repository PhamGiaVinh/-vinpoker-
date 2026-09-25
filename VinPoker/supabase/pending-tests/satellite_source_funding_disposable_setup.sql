-- Synthetic schema adapter for the Cashier disposable PostgreSQL fixture.
-- The production tournaments table already has these columns/status values.
-- Never apply this file to a linked or production database.
\set ON_ERROR_STOP on
ALTER TABLE public.tournaments ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE public.tournaments ADD COLUMN IF NOT EXISTS event_id uuid;
ALTER TABLE public.tournaments ADD COLUMN IF NOT EXISTS registration_closed_at timestamptz;
ALTER TABLE public.tournaments DROP CONSTRAINT IF EXISTS tournaments_status_check;
ALTER TABLE public.tournaments ADD CONSTRAINT tournaments_status_check
  CHECK (status IN ('active','registering','completed','cancelled','scheduled','live'));
