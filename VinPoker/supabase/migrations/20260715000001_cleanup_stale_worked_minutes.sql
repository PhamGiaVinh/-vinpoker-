-- One-time cleanup: reset stale worked_minutes_since_last_break accumulated by old cron job.
-- Migration 20260713000001 only resets on NEW transitions; this fixes existing rows.

UPDATE dealer_attendance
SET worked_minutes_since_last_break = 0
WHERE current_state NOT IN ('assigned', 'pre_assigned');
