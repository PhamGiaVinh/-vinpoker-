-- Player History — Phase 1 / M3: results (source-only, additive, idempotent).
-- WHY: "out 9th: 5.500.000" must attach to the right player, only once the field is final, and must
-- survive re-entry and late registration. So we capture a race-safe provisional bust_order at bust,
-- and compute the OFFICIAL finished_place only at finalize (called at close/payout). Prize is NOT
-- stored — get_member_history derives it from the official tournament_prizes on read (D1), so a payout
-- regenerate/manual-edit can never leave a stale prize behind.
-- Depends on: M1 (club_settings.player_history_enabled, role helpers), M2 (tournament_entries.member_id).
-- NOTE: this is self-contained and does NOT require the unapplied 20261121000000 floor-bust migration —
-- the bust_order trigger below fires on ANY status->'busted' transition (floor client UPDATE or tracker).

-- 1) Provisional, race-safe elimination order --------------------------------------------------
ALTER TABLE public.tournaments        ADD COLUMN IF NOT EXISTS bust_seq   integer NOT NULL DEFAULT 0;
ALTER TABLE public.tournament_entries ADD COLUMN IF NOT EXISTS bust_order integer;

-- BEFORE UPDATE trigger: on the transition into 'busted', stamp a dense per-tournament order.
-- The UPDATE ... RETURNING on the tournaments row serializes concurrent busts (P0-3a). Gated on the
-- per-club flag so it stays fully inert for clubs that have not opted in (D4).
CREATE OR REPLACE FUNCTION public.capture_bust_order()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_club uuid; v_enabled boolean; v_seq integer;
BEGIN
  IF NEW.status = 'busted' AND COALESCE(OLD.status, '') <> 'busted' AND NEW.bust_order IS NULL THEN
    SELECT t.club_id INTO v_club FROM public.tournaments t WHERE t.id = NEW.tournament_id;
    SELECT player_history_enabled INTO v_enabled FROM public.club_settings WHERE club_id = v_club;
    IF COALESCE(v_enabled, false) THEN
      UPDATE public.tournaments SET bust_seq = bust_seq + 1 WHERE id = NEW.tournament_id RETURNING bust_seq INTO v_seq;
      NEW.bust_order := v_seq;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_capture_bust_order ON public.tournament_entries;
CREATE TRIGGER trg_capture_bust_order
  BEFORE UPDATE ON public.tournament_entries
  FOR EACH ROW EXECUTE FUNCTION public.capture_bust_order();

-- 2) finalize_tournament_results — set the OFFICIAL finishing place at close. ---------------------
--    Ranks DISTINCT PLAYERS (not bullets) by their LAST bullet's bust_order, so re-entries collapse
--    to one finish and late registrants who outlasted a player push that player's place down (P0-3b/c).
--    finished_place is fully recomputed each call (idempotent + corrects any earlier drift). Prize is
--    NOT written here (derived on read). Superseded bullets are cleared so they never show a result.
CREATE OR REPLACE FUNCTION public.finalize_tournament_results(p_tournament_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_caller         uuid := auth.uid();
  v_club           uuid;
  v_field          integer;
  v_survivors      integer;
  v_set            integer := 0;
  v_any_bust_order boolean;
BEGIN
  IF v_caller IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'unauthorized'); END IF;
  SELECT club_id INTO v_club FROM public.tournaments WHERE id = p_tournament_id;
  IF v_club IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'tournament_not_found'); END IF;
  IF NOT (public.is_club_cashier(v_caller, v_club) OR public.is_club_admin(v_caller, v_club)
       OR public.is_club_owner(v_caller, v_club) OR public.has_role(v_caller, 'super_admin'::app_role)) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'actor_not_allowed');
  END IF;

  -- Guard (post-audit P1): only rank once the field is truly down to a winner. Calling this earlier —
  -- or again later after late-registration/further busts changed the distinct-player count — would
  -- silently SHIFT already-assigned places for earlier-out players (field size moves, dense_rank doesn't).
  -- Refuse instead of doing a partial/shifting pass; the caller retries once the tournament is closed.
  SELECT count(*) INTO v_survivors FROM public.tournament_entries
    WHERE tournament_id = p_tournament_id AND COALESCE(status, '') <> 'busted';
  IF v_survivors > 1 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'tournament_not_finished', 'survivors', v_survivors);
  END IF;

  -- Guard (post-audit P2): finished_place is only meaningful if bust_order was actually captured during
  -- play (club_settings.player_history_enabled was on). Otherwise only the winner could ever be ranked —
  -- a silent, misleading partial result. Refuse explicitly rather than writing a 1-place-only outcome.
  SELECT EXISTS (
    SELECT 1 FROM public.tournament_entries WHERE tournament_id = p_tournament_id AND bust_order IS NOT NULL
  ) INTO v_any_bust_order;
  IF NOT v_any_bust_order THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_bust_order_captured');
  END IF;

  -- (a) Clear any finished_place on superseded bullets (a later bullet exists for the same player).
  UPDATE public.tournament_entries te SET finished_place = NULL
  WHERE te.tournament_id = p_tournament_id
    AND te.finished_place IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.tournament_entries e2
      WHERE e2.tournament_id = te.tournament_id
        AND COALESCE(e2.member_id::text, e2.player_id::text) = COALESCE(te.member_id::text, te.player_id::text)
        AND e2.entry_no > te.entry_no
    );

  -- (b) Official place for each player's LAST (non-superseded) BUSTED bullet.
  WITH last_bullets AS (
    SELECT e.id, e.bust_order,
      row_number() OVER (
        PARTITION BY COALESCE(e.member_id::text, e.player_id::text)
        ORDER BY e.entry_no DESC NULLS LAST, e.created_at DESC
      ) AS rn
    FROM public.tournament_entries e
    WHERE e.tournament_id = p_tournament_id
  ),
  finals AS (SELECT id, bust_order FROM last_bullets WHERE rn = 1),
  fld    AS (SELECT count(*) AS field FROM finals),
  elim   AS (SELECT id, dense_rank() OVER (ORDER BY bust_order ASC) AS er
             FROM finals WHERE bust_order IS NOT NULL)
  UPDATE public.tournament_entries te
    SET finished_place = (SELECT field FROM fld) - el.er + 1
  FROM finals f JOIN elim el ON el.id = f.id
  WHERE te.id = f.id
    AND te.finished_place IS DISTINCT FROM ((SELECT field FROM fld) - el.er + 1);
  GET DIAGNOSTICS v_set = ROW_COUNT;

  SELECT count(*) INTO v_field FROM (
    SELECT DISTINCT COALESCE(member_id::text, player_id::text)
    FROM public.tournament_entries WHERE tournament_id = p_tournament_id
  ) x;

  -- (c) Winner = the single survivor's last bullet -> place 1. v_survivors already checked <= 1 above.
  IF v_survivors <= 1 THEN
    WITH last_bullets AS (
      SELECT e.id, e.bust_order,
        row_number() OVER (
          PARTITION BY COALESCE(e.member_id::text, e.player_id::text)
          ORDER BY e.entry_no DESC NULLS LAST, e.created_at DESC
        ) AS rn
      FROM public.tournament_entries e
      WHERE e.tournament_id = p_tournament_id
    )
    UPDATE public.tournament_entries te SET finished_place = 1
    FROM last_bullets lb
    WHERE te.id = lb.id AND lb.rn = 1 AND lb.bust_order IS NULL
      AND te.finished_place IS DISTINCT FROM 1;
  END IF;

  RETURN jsonb_build_object('ok', true, 'field', v_field, 'places_set', v_set, 'survivors', v_survivors);
END;
$$;
REVOKE ALL ON FUNCTION public.finalize_tournament_results(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.finalize_tournament_results(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.finalize_tournament_results(uuid) TO authenticated, service_role;

-- 3) get_member_history — the queryable proof. Owner/admin/super OR the linked player only (P1-G). --
--    Prize derived on read from the official prize table (D1). Rollups separate tournaments vs bullets.
CREATE OR REPLACE FUNCTION public.get_member_history(p_member_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_caller  uuid := auth.uid();
  v_member  RECORD;
  v_entries jsonb;
  v_roll    jsonb;
BEGIN
  IF v_caller IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'unauthorized'); END IF;
  SELECT id, club_id, player_user_id, full_name INTO v_member
    FROM public.club_members WHERE id = p_member_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'member_not_found'); END IF;
  IF NOT (public.is_club_owner(v_caller, v_member.club_id)
       OR public.is_club_admin(v_caller, v_member.club_id)
       OR public.has_role(v_caller, 'super_admin'::app_role)
       OR (v_member.player_user_id IS NOT NULL AND v_caller = v_member.player_user_id)) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'actor_not_allowed');
  END IF;

  SELECT COALESCE(jsonb_agg(r ORDER BY r->>'created_at' DESC), '[]'::jsonb) INTO v_entries FROM (
    SELECT jsonb_build_object(
      'entry_id',        e.id,
      'tournament_id',   e.tournament_id,
      'tournament_name', t.name,
      'event_date',      COALESCE(t.start_time, e.created_at),
      'buy_in',          reg.buy_in,
      'fee',             reg.platform_fixed_fee,
      'total_paid',      reg.total_pay,
      'entry_no',        e.entry_no,
      'status',          e.status,
      'finished_place',  e.finished_place,
      'prize', CASE WHEN e.finished_place IS NULL THEN NULL
                    ELSE (SELECT tp.amount FROM public.tournament_prizes tp
                          WHERE tp.tournament_id = e.tournament_id AND tp.position = e.finished_place) END,
      'result_label', CASE
          WHEN EXISTS (SELECT 1 FROM public.tournament_entries e2
                       WHERE e2.tournament_id = e.tournament_id AND e2.member_id = e.member_id
                         AND e2.entry_no > e.entry_no) THEN 're_entered'
          WHEN e.finished_place IS NOT NULL THEN 'out_' || e.finished_place
          WHEN e.status = 'busted' THEN 'busted_pending'
          ELSE 'active' END,
      'created_at', e.created_at
    ) AS r
    FROM public.tournament_entries e
    LEFT JOIN public.tournaments t ON t.id = e.tournament_id
    LEFT JOIN public.tournament_registrations reg ON reg.id = e.registration_id
    WHERE e.member_id = p_member_id
  ) s;

  SELECT jsonb_build_object(
    'tournaments_played', count(DISTINCT e.tournament_id),
    'entries_count',      count(*),
    'reentries_count',    count(*) FILTER (WHERE COALESCE(e.entry_no, 1) > 1),
    'total_buy_in_pool',  COALESCE(sum(reg.buy_in), 0),
    'total_out_of_pocket',COALESCE(sum(reg.total_pay), 0),
    'official_itm_count', count(*) FILTER (
        WHERE e.finished_place IS NOT NULL
          AND EXISTS (SELECT 1 FROM public.tournament_prizes tp
                      WHERE tp.tournament_id = e.tournament_id AND tp.position = e.finished_place AND tp.amount > 0)),
    'biggest_cash', COALESCE(max((SELECT tp.amount FROM public.tournament_prizes tp
                      WHERE tp.tournament_id = e.tournament_id AND tp.position = e.finished_place)), 0)
  ) INTO v_roll
  FROM public.tournament_entries e
  LEFT JOIN public.tournament_registrations reg ON reg.id = e.registration_id
  WHERE e.member_id = p_member_id;

  RETURN jsonb_build_object('ok', true, 'member_id', p_member_id, 'full_name', v_member.full_name,
    'entries', v_entries, 'rollups', v_roll);
END;
$$;
REVOKE ALL ON FUNCTION public.get_member_history(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_member_history(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_member_history(uuid) TO authenticated, service_role;
