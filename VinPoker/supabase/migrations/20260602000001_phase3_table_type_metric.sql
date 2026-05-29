-- Phase 3 Task 3.2: Fix dealer_shift_metrics - COUNT without DISTINCT, add game_tables JOIN
-- Bug: COUNT(DISTINCT CASE WHEN ds.tour_tier...) counts unique tables, not assignment frequency
-- Fix: COUNT(CASE WHEN gt.tour_tier...) with game_tables JOIN, counts assignment records

DROP VIEW IF EXISTS public.dealer_shift_metrics CASCADE;

CREATE OR REPLACE VIEW public.dealer_shift_metrics AS
SELECT
  da.id AS attendance_id,
  da.dealer_id,
  da.shift_id,
  d.club_id,

  -- Work metrics
  COALESCE(SUM(
    EXTRACT(EPOCH FROM (COALESCE(dassign.released_at, NOW()) - dassign.assigned_at)) / 60
  ), 0)::INTEGER AS total_worked_minutes,

  -- Break metrics
  COALESCE(SUM(
    EXTRACT(EPOCH FROM (COALESCE(db.break_end, NOW()) - db.break_start)) / 60
  ), 0)::INTEGER AS total_break_minutes,

  MAX(db.break_end) AS last_break_end,

  -- Assignment metrics
  COUNT(DISTINCT dassign.id)::INTEGER AS total_assignments,

  -- Table type assignments (count of rows, not distinct tables)
  COUNT(CASE WHEN gt.tour_tier = 'HIGH' THEN 1 END)::INTEGER AS high_table_assignments,
  COUNT(CASE WHEN gt.tour_tier = 'MEDIUM' THEN 1 END)::INTEGER AS medium_table_assignments,
  COUNT(CASE WHEN gt.tour_tier = 'LOW' THEN 1 END)::INTEGER AS low_table_assignments,

  -- Freshness (minutes since last break end, or since check-in if never broke)
  EXTRACT(EPOCH FROM (NOW() - COALESCE(MAX(db.break_end), da.check_in_time, NOW()))) / 60 AS minutes_since_rest,

  -- Current state fields
  da.current_state,
  da.priority_break_flag,
  da.worked_minutes_since_last_break

FROM public.dealer_attendance da
JOIN public.dealers d ON d.id = da.dealer_id
LEFT JOIN public.dealer_assignments dassign ON dassign.attendance_id = da.id
LEFT JOIN public.game_tables gt ON gt.id = dassign.table_id
LEFT JOIN public.dealer_breaks db ON db.assignment_id = dassign.id
LEFT JOIN public.dealer_shifts ds ON ds.id = da.shift_id
WHERE da.status = 'checked_in'
GROUP BY da.id, da.dealer_id, da.shift_id, d.club_id, da.current_state, da.priority_break_flag, da.worked_minutes_since_last_break;
