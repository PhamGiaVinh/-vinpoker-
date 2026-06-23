-- ============================================================================
-- ROLLBACK — MD-2 qualifiers (20261026000000_tournament_event_qualifiers)
-- ============================================================================
-- Drops the advance RPC + the qualifiers audit table. SAFE: the table holds only
-- advancement records (who moved from a flight to the final). Dropping it does NOT
-- remove any tournament/flight/final row, nor the carried chip counts already
-- written into the final's tournament_chip_counts (those persist independently).
-- ============================================================================

DROP FUNCTION IF EXISTS public.seat_day2_qualifiers(uuid, text);
DROP FUNCTION IF EXISTS public.advance_flight_qualifiers(uuid, uuid[]);
DROP TABLE IF EXISTS public.tournament_event_qualifiers;
-- NOTE: dropping these does NOT un-seat any Day-2 players already drawn into a final
-- (their tournament_entries / tournament_seats persist independently, like any seating).
