-- supabase/migrations/20260605_diagnostic_logs.sql
-- Create diagnostic_logs table for storing edge function diagnostic data
-- Used for Phase 1 Pass 3 query issue investigation

CREATE TABLE IF NOT EXISTS diagnostic_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  club_id UUID REFERENCES clubs(id),
  diagnostic_type TEXT NOT NULL,
  result JSONB NOT NULL,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_diagnostic_logs_timestamp
ON diagnostic_logs(timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_diagnostic_logs_type
ON diagnostic_logs(diagnostic_type, timestamp DESC);

COMMENT ON TABLE diagnostic_logs IS
  'Stores diagnostic data from edge functions for debugging.
   Used temporarily for troubleshooting, can be purged manually after fixes confirmed.';

GRANT INSERT, SELECT ON diagnostic_logs TO service_role;
