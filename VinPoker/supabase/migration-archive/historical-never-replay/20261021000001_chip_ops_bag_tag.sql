-- Chip Ops — Phase 2D: Bag & Tag (end-of-day per-player bagging + per-player reconciliation + lock gate).
-- DEPENDS ON 1a (20261015000000) + 1b (20261016000000). (Ordered after 2B/2C by timestamp, but does not
-- reference their objects — Bag & Tag reconciles against player stacks, not the per-denom floor inventory.)
--
-- SOURCE-ONLY migration. NOT applied on merge. Apply in a controlled session (Supabase SQL Editor).
-- schema_migrations untouched.
--
-- WHY: at end of a day each remaining player bags THEIR OWN chips into one labelled, sealed bag. The owner's
-- rule: a bag does NOT need a chip-by-chip / per-denomination count — it just needs to hold ENOUGH chips, i.e.
-- the player's stack total. So we record one number per player (the bag total) and check it against that
-- player's stack (tournament_seats.chip_count of their ACTIVE seat). The day reconciles PER PLAYER:
--   expected = player's active-seat stack;  counted = that player's SEALED bag total;  variance = counted − expected.
-- The day LOCKS only when every player who still has chips has a sealed bag matching their stack (all variances 0),
-- OR a TD force-signs with a reason (audited). Multi-day via day_number. Supports unseal (re-bag) + reopen.
--
-- This phase writes NO chip_inventory_ledger rows (bagging is a snapshot, not a floor delta) and reads NO
-- denominations — it is fully decoupled from 2B/2C inventory. Idempotent: CREATE … IF NOT EXISTS,
-- CREATE OR REPLACE FUNCTION, DROP POLICY IF EXISTS.

-- ===========================================================================================
-- 1. Tables
-- ===========================================================================================
CREATE TABLE IF NOT EXISTS public.day_close (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id        uuid NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
  day_number           integer NOT NULL,
  club_id              uuid NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  expected_total_value bigint NOT NULL DEFAULT 0,   -- Σ active-player stacks (chips in play)
  counted_total_value  bigint NOT NULL DEFAULT 0,   -- Σ sealed bag totals
  variance_by_player   jsonb NOT NULL DEFAULT '[]'::jsonb,
  all_zero             boolean NOT NULL DEFAULT false,
  status               text NOT NULL DEFAULT 'open' CHECK (status IN ('open','locked')),
  locked_by            uuid,
  locked_at            timestamptz,
  signed_off           boolean NOT NULL DEFAULT false,
  signoff_by           uuid,
  signoff_reason       text,
  signoff_at           timestamptz,
  version              integer NOT NULL DEFAULT 0,
  created_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT day_close_day_pos CHECK (day_number > 0),
  CONSTRAINT day_close_tourn_day_uniq UNIQUE (tournament_id, day_number)
);
CREATE INDEX IF NOT EXISTS idx_day_close_club ON public.day_close(club_id);

CREATE TABLE IF NOT EXISTS public.chip_bag (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id uuid NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
  club_id       uuid NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  day_number    integer NOT NULL,
  player_id     uuid NOT NULL,
  player_name   text,
  table_id      uuid,
  seat_number   integer,
  bag_code      text,
  stack_value   bigint NOT NULL DEFAULT 0,   -- snapshot of the player's stack when the bag was recorded
  total_value   bigint NOT NULL DEFAULT 0,   -- chips actually bagged (operator-entered; defaults to stack)
  sealed        boolean NOT NULL DEFAULT false,
  created_by    uuid DEFAULT auth.uid(),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chip_bag_day_pos CHECK (day_number > 0),
  CONSTRAINT chip_bag_total_nonneg CHECK (total_value >= 0),
  CONSTRAINT chip_bag_tourn_day_player_uniq UNIQUE (tournament_id, day_number, player_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_chip_bag_code ON public.chip_bag(tournament_id, bag_code) WHERE bag_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_chip_bag_tourn_day ON public.chip_bag(tournament_id, day_number);
CREATE INDEX IF NOT EXISTS idx_chip_bag_club ON public.chip_bag(club_id);

CREATE TABLE IF NOT EXISTS public.chip_ops_signoff_audit (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id       uuid NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  tournament_id uuid REFERENCES public.tournaments(id) ON DELETE CASCADE,
  day_close_id  uuid REFERENCES public.day_close(id) ON DELETE SET NULL,
  action        text NOT NULL CHECK (action IN ('lock','signoff','reopen','unseal')),
  actor         uuid DEFAULT auth.uid(),
  created_at    timestamptz NOT NULL DEFAULT now(),
  details       jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_csa_club ON public.chip_ops_signoff_audit(club_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_csa_day ON public.chip_ops_signoff_audit(day_close_id);

-- ===========================================================================================
-- 2. RLS — SELECT owner OR chip_master; default-deny writes (RPC-only). Append-only audit.
-- ===========================================================================================
ALTER TABLE public.day_close              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chip_bag               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chip_ops_signoff_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.day_close              FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.chip_bag               FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.chip_ops_signoff_audit FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.day_close              TO authenticated;
GRANT SELECT ON public.chip_bag               TO authenticated;
GRANT SELECT ON public.chip_ops_signoff_audit TO authenticated;

DROP POLICY IF EXISTS day_close_select ON public.day_close;
CREATE POLICY day_close_select ON public.day_close FOR SELECT TO authenticated
  USING (club_id IS NOT NULL AND (public.is_club_owner(auth.uid(),club_id) OR public.is_club_chip_master(auth.uid(),club_id)));
DROP POLICY IF EXISTS chip_bag_select ON public.chip_bag;
CREATE POLICY chip_bag_select ON public.chip_bag FOR SELECT TO authenticated
  USING (club_id IS NOT NULL AND (public.is_club_owner(auth.uid(),club_id) OR public.is_club_chip_master(auth.uid(),club_id)));
DROP POLICY IF EXISTS chip_ops_signoff_audit_select ON public.chip_ops_signoff_audit;
CREATE POLICY chip_ops_signoff_audit_select ON public.chip_ops_signoff_audit FOR SELECT TO authenticated
  USING (club_id IS NOT NULL AND (public.is_club_owner(auth.uid(),club_id) OR public.is_club_chip_master(auth.uid(),club_id)));

-- ===========================================================================================
-- 3. Reconciliation helper — per PLAYER: expected (active-seat stack) vs counted (their SEALED bag),
--    FULL OUTER JOIN over active players ∪ sealed bags (so a sealed bag for a no-longer-active player is
--    flagged too). Internal (DEFINER); callers (close_day / get_bag_tag_state) authz-gate first.
-- ===========================================================================================
CREATE OR REPLACE FUNCTION public.chip_ops_day_reconcile(p_tournament_id uuid, p_day_number integer)
RETURNS TABLE(player_id uuid, player_name text, table_name text, seat_number integer,
              expected bigint, counted bigint, variance bigint, sealed boolean, bag_code text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH active_players AS (
    -- one row per player: their ACTIVE seat (defensive pick of the latest entry if >1 active row exists)
    SELECT DISTINCT ON (s.player_id)
      s.player_id, s.player_name, s.table_id, s.seat_number, s.chip_count
    FROM public.tournament_seats s
    WHERE s.tournament_id = p_tournament_id AND s.is_active = true
    ORDER BY s.player_id, s.entry_number DESC NULLS LAST
  ),
  sealed_bags AS (
    SELECT b.player_id, b.player_name, b.table_id, b.seat_number, b.total_value, b.bag_code, b.sealed
    FROM public.chip_bag b
    WHERE b.tournament_id = p_tournament_id AND b.day_number = p_day_number AND b.sealed = true
  )
  SELECT
    COALESCE(ap.player_id, sb.player_id)                                   AS player_id,
    COALESCE(ap.player_name, sb.player_name)                              AS player_name,
    gt.table_name,
    COALESCE(ap.seat_number, sb.seat_number)                             AS seat_number,
    COALESCE(ap.chip_count, 0)::bigint                                    AS expected,
    COALESCE(sb.total_value, 0)::bigint                                   AS counted,
    (COALESCE(sb.total_value, 0) - COALESCE(ap.chip_count, 0))::bigint    AS variance,
    COALESCE(sb.sealed, false)                                           AS sealed,
    sb.bag_code
  FROM active_players ap
  FULL OUTER JOIN sealed_bags sb ON sb.player_id = ap.player_id
  LEFT JOIN public.game_tables gt ON gt.id = COALESCE(ap.table_id, sb.table_id)
  ORDER BY gt.table_name NULLS LAST, COALESCE(ap.seat_number, sb.seat_number) NULLS LAST;
$$;
REVOKE ALL ON FUNCTION public.chip_ops_day_reconcile(uuid,integer) FROM PUBLIC, anon;

-- ===========================================================================================
-- 4. chip_ops_record_bag — upsert a player's bag for a day (one bag / player / day). One total, no denoms.
-- ===========================================================================================
CREATE OR REPLACE FUNCTION public.chip_ops_record_bag(
  p_tournament_id uuid,
  p_day_number    integer,
  p_player_id     uuid,
  p_bag_code      text,
  p_total_value   bigint,
  p_seal          boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_club   uuid;
  v_locked boolean;
  v_bag    uuid;
  v_sealed boolean;
  v_pname  text;
  v_tid    uuid;
  v_seat   integer;
  v_stack  bigint;
  v_total  bigint;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('error','Unauthorized'); END IF;
  IF p_player_id IS NULL THEN RETURN jsonb_build_object('error','INVALID_INPUT','detail','player_id'); END IF;
  IF p_day_number IS NULL OR p_day_number <= 0 THEN RETURN jsonb_build_object('error','INVALID_INPUT','detail','day_number'); END IF;
  IF p_total_value IS NOT NULL AND p_total_value < 0 THEN RETURN jsonb_build_object('error','INVALID_INPUT','detail','total_value'); END IF;

  SELECT t.club_id INTO v_club FROM public.tournaments t WHERE t.id = p_tournament_id AND t.deleted_at IS NULL;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','TOURNAMENT_NOT_FOUND'); END IF;
  IF NOT (public.is_club_owner(v_uid, v_club) OR public.is_club_chip_master(v_uid, v_club)) THEN
    RETURN jsonb_build_object('error','Forbidden');
  END IF;

  SELECT (status = 'locked') INTO v_locked FROM public.day_close
  WHERE tournament_id = p_tournament_id AND day_number = p_day_number;
  IF COALESCE(v_locked, false) THEN RETURN jsonb_build_object('error','DAY_LOCKED'); END IF;

  SELECT id, sealed INTO v_bag, v_sealed FROM public.chip_bag
  WHERE tournament_id = p_tournament_id AND day_number = p_day_number AND player_id = p_player_id;
  IF FOUND AND v_sealed THEN RETURN jsonb_build_object('error','BAG_SEALED'); END IF;

  -- server-derive the player's ACTIVE seat + stack (defensive vs a stray 2nd active row)
  SELECT s.player_name, s.table_id, s.seat_number, s.chip_count INTO v_pname, v_tid, v_seat, v_stack
  FROM public.tournament_seats s
  WHERE s.tournament_id = p_tournament_id AND s.player_id = p_player_id AND s.is_active = true
  ORDER BY s.entry_number DESC NULLS LAST LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','NO_ACTIVE_SEAT'); END IF;

  v_stack := COALESCE(v_stack, 0);
  v_total := COALESCE(p_total_value, v_stack);   -- default the bag total to the player's stack ("đủ")

  BEGIN
    INSERT INTO public.chip_bag (tournament_id, club_id, day_number, player_id, player_name, table_id, seat_number,
      bag_code, stack_value, total_value, sealed, created_by, updated_at)
    VALUES (p_tournament_id, v_club, p_day_number, p_player_id, v_pname, v_tid, v_seat,
      p_bag_code, v_stack, v_total, COALESCE(p_seal,false), v_uid, now())
    ON CONFLICT (tournament_id, day_number, player_id)
    DO UPDATE SET player_name = EXCLUDED.player_name, table_id = EXCLUDED.table_id, seat_number = EXCLUDED.seat_number,
                  bag_code = EXCLUDED.bag_code, stack_value = EXCLUDED.stack_value, total_value = EXCLUDED.total_value,
                  sealed = COALESCE(p_seal,false), updated_at = now()
    RETURNING id INTO v_bag;
  EXCEPTION WHEN unique_violation THEN
    RETURN jsonb_build_object('error','BAG_CODE_TAKEN');   -- bag_code collides with another player's bag
  END;

  RETURN jsonb_build_object('status','ok','chip_bag_id',v_bag,'total_value',v_total,'stack_value',v_stack,
    'exact',(v_total = v_stack),'sufficient',(v_total >= v_stack),'sealed',COALESCE(p_seal,false));
END;
$$;

REVOKE ALL ON FUNCTION public.chip_ops_record_bag(uuid,integer,uuid,text,bigint,boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chip_ops_record_bag(uuid,integer,uuid,text,bigint,boolean) TO authenticated;

-- ===========================================================================================
-- 5. chip_ops_unseal_bag — re-open a sealed bag for re-bagging (day must be open).
-- ===========================================================================================
CREATE OR REPLACE FUNCTION public.chip_ops_unseal_bag(p_bag_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_club   uuid; v_tid uuid; v_day integer; v_code text; v_locked boolean; v_dayid uuid;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('error','Unauthorized'); END IF;
  SELECT b.club_id, b.tournament_id, b.day_number, b.bag_code INTO v_club, v_tid, v_day, v_code
  FROM public.chip_bag b WHERE b.id = p_bag_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','BAG_NOT_FOUND'); END IF;
  IF NOT (public.is_club_owner(v_uid, v_club) OR public.is_club_chip_master(v_uid, v_club)) THEN
    RETURN jsonb_build_object('error','Forbidden');
  END IF;
  SELECT id, (status='locked') INTO v_dayid, v_locked FROM public.day_close
  WHERE tournament_id = v_tid AND day_number = v_day;
  IF COALESCE(v_locked, false) THEN RETURN jsonb_build_object('error','REOPEN_FIRST'); END IF;

  UPDATE public.chip_bag SET sealed = false, updated_at = now() WHERE id = p_bag_id;
  INSERT INTO public.chip_ops_signoff_audit (club_id, tournament_id, day_close_id, action, actor, details)
  VALUES (v_club, v_tid, v_dayid, 'unseal', v_uid, jsonb_build_object('bag_id',p_bag_id,'bag_code',v_code,'day_number',v_day));
  RETURN jsonb_build_object('status','ok','chip_bag_id',p_bag_id,'sealed',false);
END;
$$;

REVOKE ALL ON FUNCTION public.chip_ops_unseal_bag(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chip_ops_unseal_bag(uuid) TO authenticated;

-- ===========================================================================================
-- 6. chip_ops_close_day — the lock gate (all players bagged & matching, or TD force-sign with reason).
-- ===========================================================================================
CREATE OR REPLACE FUNCTION public.chip_ops_close_day(
  p_tournament_id   uuid,
  p_day_number      integer,
  p_old_version     integer DEFAULT 0,
  p_force_signoff   boolean DEFAULT false,
  p_signoff_reason  text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid     uuid := auth.uid();
  v_club    uuid;
  v_dayid   uuid;
  v_status  text;
  v_ver     integer;
  v_texp    bigint;
  v_tcnt    bigint;
  v_var     jsonb;
  v_allzero boolean;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('error','Unauthorized'); END IF;
  SELECT t.club_id INTO v_club FROM public.tournaments t WHERE t.id = p_tournament_id AND t.deleted_at IS NULL;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','TOURNAMENT_NOT_FOUND'); END IF;
  IF NOT (public.is_club_owner(v_uid, v_club) OR public.is_club_chip_master(v_uid, v_club)) THEN
    RETURN jsonb_build_object('error','Forbidden');
  END IF;
  IF p_day_number IS NULL OR p_day_number <= 0 THEN RETURN jsonb_build_object('error','INVALID_INPUT','detail','day_number'); END IF;

  SELECT id, status, version INTO v_dayid, v_status, v_ver FROM public.day_close
  WHERE tournament_id = p_tournament_id AND day_number = p_day_number FOR UPDATE;

  IF FOUND AND v_status = 'locked' THEN
    RETURN jsonb_build_object('status','ok','idempotent',true,'already_locked',true,
      'all_zero',(SELECT all_zero FROM public.day_close WHERE id=v_dayid),
      'variance_by_player',(SELECT variance_by_player FROM public.day_close WHERE id=v_dayid));
  END IF;
  IF FOUND AND v_ver <> p_old_version THEN
    RETURN jsonb_build_object('error','race_lost','actual_version',v_ver);
  END IF;

  -- reconcile per player
  SELECT
    COALESCE(SUM(expected),0)::bigint,
    COALESCE(SUM(counted),0)::bigint,
    COALESCE(jsonb_agg(jsonb_build_object('player_id',player_id,'player_name',player_name,
      'expected',expected,'counted',counted,'variance',variance) ORDER BY variance, player_name),'[]'),
    COALESCE(bool_and(variance = 0), true)
  INTO v_texp, v_tcnt, v_var, v_allzero
  FROM public.chip_ops_day_reconcile(p_tournament_id, p_day_number);

  IF NOT v_allzero AND NOT p_force_signoff THEN
    RETURN jsonb_build_object('error','VARIANCE_NONZERO','variance_by_player',v_var,
      'total_expected_value',v_texp,'total_counted_value',v_tcnt);
  END IF;
  IF NOT v_allzero AND p_force_signoff AND (p_signoff_reason IS NULL OR length(btrim(p_signoff_reason)) = 0) THEN
    RETURN jsonb_build_object('error','SIGNOFF_REASON_REQUIRED');
  END IF;

  IF v_dayid IS NULL THEN
    BEGIN
      INSERT INTO public.day_close (tournament_id, day_number, club_id, expected_total_value, counted_total_value,
        variance_by_player, all_zero, status, locked_by, locked_at, signed_off, signoff_by, signoff_reason, signoff_at, version)
      VALUES (p_tournament_id, p_day_number, v_club, v_texp, v_tcnt, v_var, v_allzero, 'locked', v_uid, now(),
        (NOT v_allzero), CASE WHEN NOT v_allzero THEN v_uid END, CASE WHEN NOT v_allzero THEN p_signoff_reason END,
        CASE WHEN NOT v_allzero THEN now() END, 1)
      RETURNING id INTO v_dayid;
    EXCEPTION WHEN unique_violation THEN
      RETURN jsonb_build_object('error','race_lost');   -- concurrent first-close
    END;
  ELSE
    UPDATE public.day_close
    SET expected_total_value = v_texp, counted_total_value = v_tcnt, variance_by_player = v_var, all_zero = v_allzero,
        status = 'locked', locked_by = v_uid, locked_at = now(),
        signed_off = (NOT v_allzero), signoff_by = CASE WHEN NOT v_allzero THEN v_uid END,
        signoff_reason = CASE WHEN NOT v_allzero THEN p_signoff_reason END, signoff_at = CASE WHEN NOT v_allzero THEN now() END,
        version = v_ver + 1
    WHERE id = v_dayid;
  END IF;

  INSERT INTO public.chip_ops_signoff_audit (club_id, tournament_id, day_close_id, action, actor, details)
  VALUES (v_club, p_tournament_id, v_dayid, 'lock', v_uid, jsonb_build_object('day_number',p_day_number,'all_zero',v_allzero,
    'total_expected_value',v_texp,'total_counted_value',v_tcnt));
  IF NOT v_allzero THEN
    INSERT INTO public.chip_ops_signoff_audit (club_id, tournament_id, day_close_id, action, actor, details)
    VALUES (v_club, p_tournament_id, v_dayid, 'signoff', v_uid, jsonb_build_object('reason',p_signoff_reason,'variance_by_player',v_var));
  END IF;

  RETURN jsonb_build_object('status','ok','locked',true,'all_zero',v_allzero,'signed_off',(NOT v_allzero),
    'total_expected_value',v_texp,'total_counted_value',v_tcnt,'variance_by_player',v_var);
END;
$$;

REVOKE ALL ON FUNCTION public.chip_ops_close_day(uuid,integer,integer,boolean,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chip_ops_close_day(uuid,integer,integer,boolean,text) TO authenticated;

-- ===========================================================================================
-- 7. chip_ops_reopen_day — unlock a locked day (audited).
-- ===========================================================================================
CREATE OR REPLACE FUNCTION public.chip_ops_reopen_day(
  p_tournament_id uuid,
  p_day_number    integer,
  p_old_version   integer DEFAULT 0
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_club uuid; v_dayid uuid; v_status text; v_ver integer;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('error','Unauthorized'); END IF;
  SELECT t.club_id INTO v_club FROM public.tournaments t WHERE t.id = p_tournament_id AND t.deleted_at IS NULL;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','TOURNAMENT_NOT_FOUND'); END IF;
  IF NOT (public.is_club_owner(v_uid, v_club) OR public.is_club_chip_master(v_uid, v_club)) THEN
    RETURN jsonb_build_object('error','Forbidden');
  END IF;
  SELECT id, status, version INTO v_dayid, v_status, v_ver FROM public.day_close
  WHERE tournament_id = p_tournament_id AND day_number = p_day_number FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','DAY_NOT_FOUND'); END IF;
  IF v_status <> 'locked' THEN RETURN jsonb_build_object('status','ok','idempotent',true,'status_now',v_status); END IF;
  IF v_ver <> p_old_version THEN RETURN jsonb_build_object('error','race_lost','actual_version',v_ver); END IF;

  UPDATE public.day_close SET status = 'open', version = v_ver + 1 WHERE id = v_dayid;
  INSERT INTO public.chip_ops_signoff_audit (club_id, tournament_id, day_close_id, action, actor, details)
  VALUES (v_club, p_tournament_id, v_dayid, 'reopen', v_uid, jsonb_build_object('day_number',p_day_number,'prior_status','locked'));
  RETURN jsonb_build_object('status','ok','status_now','open');
END;
$$;

REVOKE ALL ON FUNCTION public.chip_ops_reopen_day(uuid,integer,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chip_ops_reopen_day(uuid,integer,integer) TO authenticated;

-- ===========================================================================================
-- 8. get_bag_tag_state — LIVE per-player reconciliation + bags + active players + day list (owner/chip-master).
-- ===========================================================================================
CREATE OR REPLACE FUNCTION public.get_bag_tag_state(p_tournament_id uuid, p_day_number integer)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_club  uuid;
  v_recon jsonb; v_texp bigint; v_tcnt bigint; v_allzero boolean;
  v_day   jsonb; v_bags jsonb; v_players jsonb; v_days jsonb;
BEGIN
  SELECT t.club_id INTO v_club FROM public.tournaments t WHERE t.id = p_tournament_id AND t.deleted_at IS NULL;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','TOURNAMENT_NOT_FOUND'); END IF;
  IF v_uid IS NULL OR NOT (public.is_club_owner(v_uid, v_club) OR public.is_club_chip_master(v_uid, v_club)) THEN
    RETURN jsonb_build_object('error','Forbidden');
  END IF;

  SELECT
    COALESCE(jsonb_agg(jsonb_build_object('player_id',player_id,'player_name',player_name,'table_name',table_name,
      'seat_number',seat_number,'expected',expected,'counted',counted,'variance',variance,'sealed',sealed,'bag_code',bag_code)
      ORDER BY table_name NULLS LAST, seat_number NULLS LAST),'[]'),
    COALESCE(SUM(expected),0)::bigint, COALESCE(SUM(counted),0)::bigint, COALESCE(bool_and(variance=0),true)
  INTO v_recon, v_texp, v_tcnt, v_allzero
  FROM public.chip_ops_day_reconcile(p_tournament_id, p_day_number);

  SELECT jsonb_build_object('status',COALESCE(status,'open'),'version',COALESCE(version,0),
    'signed_off',COALESCE(signed_off,false),'signoff_reason',signoff_reason,'locked_at',locked_at)
  INTO v_day FROM public.day_close WHERE tournament_id = p_tournament_id AND day_number = p_day_number;
  IF v_day IS NULL THEN v_day := jsonb_build_object('status','open','version',0,'signed_off',false); END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('id',b.id,'player_id',b.player_id,'player_name',b.player_name,
    'table_id',b.table_id,'seat_number',b.seat_number,'bag_code',b.bag_code,'stack_value',b.stack_value,
    'total_value',b.total_value,'sealed',b.sealed) ORDER BY b.seat_number NULLS LAST),'[]'::jsonb)
  INTO v_bags FROM public.chip_bag b WHERE b.tournament_id = p_tournament_id AND b.day_number = p_day_number;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('player_id',s.player_id,'player_name',s.player_name,'table_id',s.table_id,
    'table_name',gt.table_name,'seat_number',s.seat_number,'chip_count',s.chip_count)
    ORDER BY gt.table_name NULLS LAST, s.seat_number NULLS LAST),'[]'::jsonb)
  INTO v_players FROM public.tournament_seats s
  LEFT JOIN public.game_tables gt ON gt.id = s.table_id
  WHERE s.tournament_id = p_tournament_id AND s.is_active = true;

  SELECT COALESCE(jsonb_agg(d ORDER BY d),'[]'::jsonb) INTO v_days
  FROM (SELECT DISTINCT day_number AS d FROM (
          SELECT day_number FROM public.day_close WHERE tournament_id = p_tournament_id
          UNION SELECT day_number FROM public.chip_bag WHERE tournament_id = p_tournament_id
        ) u) q;

  RETURN jsonb_build_object(
    'tournament_id', p_tournament_id, 'day_number', p_day_number, 'day', v_day,
    'reconciliation', jsonb_build_object('players', v_recon, 'total_expected_value', v_texp,
      'total_counted_value', v_tcnt, 'total_variance_value', (v_tcnt - v_texp), 'all_zero', v_allzero),
    'bags', v_bags, 'players', v_players, 'days', v_days
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_bag_tag_state(uuid,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_bag_tag_state(uuid,integer) TO authenticated;

-- ===========================================================================================
-- Controlled-apply TEST PLAN (apply 1a+1b+2B+2C+this; BEGIN; … ROLLBACK). Needs ≥1 active seat with a
-- non-zero chip_count per remaining player. (Stacks are the source of truth — no chip set needed for 2D.)
--
-- BEGIN;
--   -- [T1] record + default total: chip_ops_record_bag('<t>',1,'<p>','BAG-1',NULL,false)
--   --        → total_value == that player's stack; exact=true.  Pass an explicit number to override.
--   -- [T2] bag EVERY remaining player == their stack, seal each, then:
--   --        chip_ops_close_day('<t>',1,0) → {locked:true, all_zero:true}; one 'lock' audit, no 'signoff'.
--   -- [T3] under-bag one player by 1 → close → {"error":"VARIANCE_NONZERO", variance_by_player[that player]=-1}; day open
--   -- [T4] force-sign: chip_ops_close_day('<t>',1,<v>,true,'thiếu 1 chip') → locked+signed_off; 'lock'+'signoff' audit
--   -- [T5] force without reason → {"error":"SIGNOFF_REASON_REQUIRED"}
--   -- [T6] day1 locked; bag day2 == stacks; close_day('<t>',2,0) all_zero independent → 2 day_close rows
--   -- [T7] unseal a bag (day open) → sealed=false + 'unseal' audit; re-bag a different total; reseal
--   -- [T8] reopen_day('<t>',1,<v>) → status open + 'reopen' audit
--   -- [T9] record on a sealed bag → BAG_SEALED; on a locked day → DAY_LOCKED; unseal on locked day → REOPEN_FIRST
--   -- [T10] negative total → INVALID_INPUT; duplicate bag_code (other player) → BAG_CODE_TAKEN; stale version → race_lost
--   -- [T11] over-bag (more than stack) blocks clean close (needs sign-off); unknown player → NO_ACTIVE_SEAT
--   -- [T12] authz (non-owner) → Forbidden on every RPC; RLS: non-owner sees 0 rows.
-- ROLLBACK;
-- ===========================================================================================
--
-- ROLLBACK (undo this migration), dependency order:
--   DROP FUNCTION IF EXISTS public.get_bag_tag_state(uuid,integer);
--   DROP FUNCTION IF EXISTS public.chip_ops_reopen_day(uuid,integer,integer);
--   DROP FUNCTION IF EXISTS public.chip_ops_close_day(uuid,integer,integer,boolean,text);
--   DROP FUNCTION IF EXISTS public.chip_ops_unseal_bag(uuid);
--   DROP FUNCTION IF EXISTS public.chip_ops_record_bag(uuid,integer,uuid,text,bigint,boolean);
--   DROP FUNCTION IF EXISTS public.chip_ops_day_reconcile(uuid,integer);
--   DROP TABLE IF EXISTS public.chip_ops_signoff_audit;
--   DROP TABLE IF EXISTS public.chip_bag;
--   DROP TABLE IF EXISTS public.day_close;
-- ===========================================================================================
