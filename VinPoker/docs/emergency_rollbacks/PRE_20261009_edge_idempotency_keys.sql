-- EMERGENCY ROLLBACK — B1.1 edge idempotency foundation (migration 20261009000000)
--
-- 20261009000000 is purely additive: a NEW table (edge_idempotency_keys) + two NEW helper
-- functions (idem_begin, idem_complete). It touches no existing object, table, or data.
-- Pre-apply state: none of these existed. Rollback = drop them. The edge fns (B1.2) call the
-- helpers defensively (try/catch → proceed without idempotency if absent), so dropping these
-- cannot break mass-assign / manage-break.

DROP FUNCTION IF EXISTS public.idem_complete(text, jsonb);
DROP FUNCTION IF EXISTS public.idem_begin(text, text, uuid, uuid, text, integer);
DROP TABLE IF EXISTS public.edge_idempotency_keys;
