-- Pure Satellite funding arithmetic only; pending source, not production-ready.
-- Inputs are caller-supplied amounts. This function does NOT verify pool
-- contributions, create an overlay, issue tickets, or write a ledger.
-- The caller must present the result as an arithmetic preview, not verified funding.
-- ROLLBACK (before any caller depends on it): revoke access and drop this function.

CREATE SCHEMA IF NOT EXISTS private;

CREATE OR REPLACE FUNCTION private.satellite_funding_preview_math_v1(
  p_confirmed_pool_vnd numeric,
  p_ticket_value_vnd numeric,
  p_guaranteed_ticket_count integer
)
RETURNS TABLE (
  ticket_count integer,
  cash_remainder_vnd numeric,
  shortfall_vnd numeric,
  funding_state text
)
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  v_coverable_tickets numeric;
  v_ticket_count numeric;
  v_required_vnd numeric;
BEGIN
  IF p_confirmed_pool_vnd IS NULL
     OR p_confirmed_pool_vnd < 0
     OR p_confirmed_pool_vnd <> pg_catalog.trunc(p_confirmed_pool_vnd)
     OR p_confirmed_pool_vnd > 9007199254740991
     OR p_ticket_value_vnd IS NULL
     OR p_ticket_value_vnd <= 0
     OR p_ticket_value_vnd <> pg_catalog.trunc(p_ticket_value_vnd)
     OR p_ticket_value_vnd > 9007199254740991
     OR p_guaranteed_ticket_count IS NULL
     OR p_guaranteed_ticket_count < 0
     OR p_guaranteed_ticket_count > 500 THEN
    RAISE EXCEPTION 'satellite_funding_preview_input_invalid'
      USING ERRCODE = '22023';
  END IF;

  v_coverable_tickets := pg_catalog.trunc(p_confirmed_pool_vnd / p_ticket_value_vnd);
  v_ticket_count := greatest(v_coverable_tickets, p_guaranteed_ticket_count::numeric);
  IF v_ticket_count > 500 THEN
    RAISE EXCEPTION 'satellite_funding_preview_ticket_count_invalid'
      USING ERRCODE = '22023';
  END IF;
  ticket_count := v_ticket_count::integer;

  v_required_vnd := ticket_count::numeric * p_ticket_value_vnd;
  cash_remainder_vnd := greatest(p_confirmed_pool_vnd - v_required_vnd, 0);
  shortfall_vnd := greatest(v_required_vnd - p_confirmed_pool_vnd, 0);
  funding_state := CASE WHEN shortfall_vnd > 0
    THEN 'INSUFFICIENT_FUNDS' ELSE 'NO_SHORTFALL' END;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION private.satellite_funding_preview_math_v1(numeric,numeric,integer)
  FROM PUBLIC, anon, authenticated, service_role;
