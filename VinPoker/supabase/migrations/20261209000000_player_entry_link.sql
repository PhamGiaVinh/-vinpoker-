-- Player History — Phase 1 / M2: link entries to members (source-only, additive, idempotent).
-- WHY: with the identity anchor from M1 in place, every participation row must point at the member.
-- Online paths carry a real auth user (player_id ∈ profiles) so an AFTER-INSERT trigger links them
-- with ZERO change to the big money RPCs. Walk-ins have no profile, so the offline buy-in RPC gains
-- an optional p_phone and links by phone. All linking is BEST-EFFORT: it never blocks buy-in/seat.
-- Depends on: M1 (normalize_phone, find_or_create_club_member, club_settings.player_history_enabled).

-- 1) The link column + index. Nullable + best-effort. --------------------------------------------
ALTER TABLE public.tournament_entries
  ADD COLUMN IF NOT EXISTS member_id uuid REFERENCES public.club_members(id);
CREATE INDEX IF NOT EXISTS idx_tournament_entries_member ON public.tournament_entries (member_id)
  WHERE member_id IS NOT NULL;

-- 2) Audit sink for identity-link failures — so best-effort never SILENTLY swallows errors (P1-I). -
CREATE TABLE IF NOT EXISTS public.player_history_link_errors (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id    uuid,
  context    text NOT NULL,
  detail     text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.player_history_link_errors ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "admin read player_history_link_errors" ON public.player_history_link_errors;
CREATE POLICY "admin read player_history_link_errors" ON public.player_history_link_errors
  FOR SELECT USING (
    public.is_club_admin(auth.uid(), club_id)
    OR public.is_club_owner(auth.uid(), club_id)
    OR public.has_role(auth.uid(), 'super_admin'::app_role)
  );
-- No INSERT policy: only SECURITY DEFINER functions (which bypass RLS) write here.

-- 3) Cashier lookup — minimal identity fields only, no lifetime money (P1-G). ---------------------
CREATE OR REPLACE FUNCTION public.lookup_member_for_buyin(p_club_id uuid, p_phone text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_canon  text := public.normalize_phone(p_phone);
  v_m      RECORD;
  v_last   timestamptz;
  v_digits text;
BEGIN
  IF v_caller IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unauthorized');
  END IF;
  IF NOT (public.is_club_cashier(v_caller, p_club_id)
       OR public.is_club_admin(v_caller, p_club_id)
       OR public.is_club_owner(v_caller, p_club_id)
       OR public.has_role(v_caller, 'super_admin'::app_role)) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'actor_not_allowed');
  END IF;
  IF v_canon IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'found', false);
  END IF;
  SELECT id, full_name, member_card_id, phone INTO v_m
    FROM public.club_members
    WHERE club_id = p_club_id AND phone_canonical = v_canon
    LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', true, 'found', false);
  END IF;
  SELECT max(created_at) INTO v_last FROM public.tournament_entries WHERE member_id = v_m.id;
  v_digits := regexp_replace(COALESCE(v_m.phone, ''), '[^0-9]', '', 'g');
  RETURN jsonb_build_object(
    'ok', true, 'found', true,
    'member_id', v_m.id,
    'full_name', v_m.full_name,
    'member_card_id', v_m.member_card_id,
    'phone_masked', CASE WHEN length(v_digits) >= 3
                         THEN repeat('*', length(v_digits) - 3) || right(v_digits, 3)
                         ELSE '***' END,
    'last_visit', v_last
  );
END;
$$;
REVOKE ALL ON FUNCTION public.lookup_member_for_buyin(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.lookup_member_for_buyin(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.lookup_member_for_buyin(uuid, text) TO authenticated, service_role;

-- 4) AFTER-INSERT trigger: link ONLINE entries (player_id ∈ profiles) automatically. Gated on the
--    per-club flag = the true server-side kill switch (P1-A). Best-effort; errors are audited.
CREATE OR REPLACE FUNCTION public.link_entry_to_member()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_club    uuid;
  v_enabled boolean;
  v_prof    RECORD;
  v_res     jsonb;
  v_member  uuid;
BEGIN
  IF NEW.member_id IS NOT NULL THEN RETURN NEW; END IF;
  SELECT t.club_id INTO v_club FROM public.tournaments t WHERE t.id = NEW.tournament_id;
  IF v_club IS NULL THEN RETURN NEW; END IF;
  SELECT player_history_enabled INTO v_enabled FROM public.club_settings WHERE club_id = v_club;
  IF NOT COALESCE(v_enabled, false) THEN RETURN NEW; END IF;
  -- Online / known auth user only. Walk-ins (no profile) are linked by the offline RPC via phone.
  SELECT phone, display_name INTO v_prof FROM public.profiles WHERE user_id = NEW.player_id;
  IF NOT FOUND THEN RETURN NEW; END IF;
  BEGIN
    v_res := public.find_or_create_club_member(v_club, v_prof.phone, v_prof.display_name, NEW.player_id);
    v_member := NULLIF(v_res->>'member_id', '')::uuid;
    IF v_member IS NOT NULL THEN
      UPDATE public.tournament_entries SET member_id = v_member WHERE id = NEW.id AND member_id IS NULL;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO public.player_history_link_errors (club_id, context, detail)
    VALUES (v_club, 'link_entry_to_member', left(SQLERRM, 500));
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_link_entry_to_member ON public.tournament_entries;
CREATE TRIGGER trg_link_entry_to_member
  AFTER INSERT ON public.tournament_entries
  FOR EACH ROW EXECUTE FUNCTION public.link_entry_to_member();

-- 5) Offline buy-in: add optional p_phone and link the walk-in. DROP the exact old signature first
--    so PostgREST never sees two overloads (P0-6). Body is byte-faithful to the live version except
--    the new param, the v_member_id decl, and the best-effort link block after the entry is created.
DROP FUNCTION IF EXISTS public.create_offline_buyin_and_seat(uuid, text, bigint, bigint, text);
CREATE OR REPLACE FUNCTION public.create_offline_buyin_and_seat(
  p_tournament_id uuid, p_player_name text, p_buy_in bigint, p_fee bigint,
  p_draw_mode text DEFAULT 'random_balanced'::text, p_phone text DEFAULT NULL
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_actor_user_id UUID := auth.uid(); v_authorized BOOLEAN; v_tour RECORD;
  v_name TEXT := NULLIF(TRIM(p_player_name), ''); v_player_id UUID := gen_random_uuid();
  v_reg_id UUID; v_ref_code TEXT; v_starting_stack INTEGER; v_entry_id UUID; v_seat_id UUID;
  v_seat_number INTEGER; v_table_tour_id UUID; v_table_game_id UUID; v_table_number INTEGER;
  v_max_seats INTEGER; v_receipt_id UUID; v_receipt_code TEXT; v_attempt INTEGER := 0;
  v_member_id UUID;
BEGIN
  IF v_actor_user_id IS NULL THEN RETURN jsonb_build_object('ok',false,'error','unauthorized'); END IF;
  IF v_name IS NULL OR length(v_name) < 2 THEN RETURN jsonb_build_object('ok',false,'error','invalid_player_name'); END IF;
  IF p_buy_in IS NULL OR p_buy_in <= 0 THEN RETURN jsonb_build_object('ok',false,'error','invalid_buy_in'); END IF;
  IF p_fee IS NULL OR p_fee < 0 THEN RETURN jsonb_build_object('ok',false,'error','invalid_fee'); END IF;
  IF p_draw_mode NOT IN ('random_balanced','fill_lowest_table') THEN RETURN jsonb_build_object('ok',false,'error','invalid_draw_mode'); END IF;

  SELECT * INTO v_tour FROM public.tournaments WHERE id = p_tournament_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','tournament_not_found'); END IF;
  IF v_tour.status IN ('completed','cancelled') THEN RETURN jsonb_build_object('ok',false,'error','tournament_not_open','status',v_tour.status); END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.tournaments t
    LEFT JOIN public.clubs c ON c.id = t.club_id
    LEFT JOIN public.club_cashiers cc ON cc.club_id = t.club_id AND cc.user_id = v_actor_user_id
    WHERE t.id = p_tournament_id AND (c.owner_id = v_actor_user_id OR cc.user_id IS NOT NULL)
  ) INTO v_authorized;
  IF NOT v_authorized THEN RETURN jsonb_build_object('ok',false,'error','actor_not_allowed'); END IF;

  v_starting_stack := COALESCE(v_tour.starting_stack, 0);

  IF p_draw_mode = 'fill_lowest_table' THEN
    SELECT tt.id, tt.table_id, tt.table_number, tt.max_seats
    INTO v_table_tour_id, v_table_game_id, v_table_number, v_max_seats
    FROM public.tournament_tables tt
    CROSS JOIN LATERAL (SELECT count(*) AS active_count FROM public.tournament_seats ts WHERE ts.table_id = tt.id AND ts.is_active = true) c
    WHERE tt.tournament_id = p_tournament_id AND tt.status='active' AND tt.table_id IS NOT NULL AND c.active_count < tt.max_seats
    ORDER BY tt.table_number ASC NULLS LAST, c.active_count ASC LIMIT 1;
  ELSE
    SELECT tt.id, tt.table_id, tt.table_number, tt.max_seats
    INTO v_table_tour_id, v_table_game_id, v_table_number, v_max_seats
    FROM public.tournament_tables tt
    CROSS JOIN LATERAL (SELECT count(*) AS active_count FROM public.tournament_seats ts WHERE ts.table_id = tt.id AND ts.is_active = true) c
    WHERE tt.tournament_id = p_tournament_id AND tt.status='active' AND tt.table_id IS NOT NULL AND c.active_count < tt.max_seats
    ORDER BY c.active_count ASC, random() LIMIT 1;
  END IF;
  IF v_table_tour_id IS NULL THEN RETURN jsonb_build_object('ok',false,'error','no_table_available'); END IF;

  SELECT s.n INTO v_seat_number FROM generate_series(1, v_max_seats) AS s(n)
  WHERE NOT EXISTS (SELECT 1 FROM public.tournament_seats ts WHERE ts.table_id = v_table_tour_id AND ts.seat_number = s.n AND ts.is_active = true)
  ORDER BY random() LIMIT 1;
  IF v_seat_number IS NULL THEN RETURN jsonb_build_object('ok',false,'error','no_table_available'); END IF;

  BEGIN
    INSERT INTO public.tournament_seats (tournament_id, player_id, entry_number, table_id, seat_number, chip_count, is_active, player_name, status, assigned_by, assigned_at)
    VALUES (p_tournament_id, v_player_id, 1, v_table_tour_id, v_seat_number, v_starting_stack, true, v_name, 'active', v_actor_user_id, now())
    RETURNING id INTO v_seat_id;
  EXCEPTION WHEN unique_violation THEN RETURN jsonb_build_object('ok',false,'error','seat_occupied'); END;

  LOOP
    v_attempt := v_attempt + 1;
    v_ref_code := format('CASH-%s', upper(substr(replace(gen_random_uuid()::text,'-',''),1,8)));
    BEGIN
      INSERT INTO public.tournament_registrations (tournament_id, player_id, club_id, buy_in, platform_fixed_fee, total_pay, reference_code, status, committed_at, confirmed_at, confirmed_by)
      VALUES (p_tournament_id, v_player_id, v_tour.club_id, p_buy_in, p_fee, p_buy_in + p_fee, v_ref_code, 'confirmed', now(), now(), v_actor_user_id)
      RETURNING id INTO v_reg_id; EXIT;
    EXCEPTION WHEN unique_violation THEN IF v_attempt >= 5 THEN RAISE; END IF; END;
  END LOOP;

  INSERT INTO public.tournament_entries (tournament_id, registration_id, player_id, entry_no, source, status, current_stack, table_id, seat_id, seat_number, seated_at)
  VALUES (p_tournament_id, v_reg_id, v_player_id, 1, 'offline', 'seated', v_starting_stack, v_table_game_id, v_seat_id, v_seat_number, now())
  RETURNING id INTO v_entry_id;
  UPDATE public.tournament_seats SET entry_id = v_entry_id WHERE id = v_seat_id;

  -- Player-history link (best-effort; NEVER blocks the buy-in). Walk-in keyed by phone; gated per club.
  BEGIN
    IF public.normalize_phone(p_phone) IS NOT NULL
       AND EXISTS (SELECT 1 FROM public.club_settings cs WHERE cs.club_id = v_tour.club_id AND cs.player_history_enabled) THEN
      v_member_id := NULLIF(public.find_or_create_club_member(v_tour.club_id, p_phone, v_name, NULL)->>'member_id', '')::uuid;
      IF v_member_id IS NOT NULL THEN
        UPDATE public.tournament_entries SET member_id = v_member_id WHERE id = v_entry_id;
      END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO public.player_history_link_errors (club_id, context, detail)
    VALUES (v_tour.club_id, 'create_offline_buyin_and_seat', left(SQLERRM, 500));
  END;

  v_attempt := 0;
  LOOP
    v_attempt := v_attempt + 1;
    v_receipt_code := format('T%s-S%s-%s', COALESCE(v_table_number::text,'?'), v_seat_number, upper(substr(replace(gen_random_uuid()::text,'-',''),1,6)));
    BEGIN
      INSERT INTO public.seat_draw_receipts (tournament_id, registration_id, entry_id, player_id, display_name, table_id, table_number, seat_id, seat_number, receipt_code, qr_payload, draw_type, status, issued_by)
      VALUES (p_tournament_id, v_reg_id, v_entry_id, v_player_id, v_name, v_table_game_id, v_table_number, v_seat_id, v_seat_number, v_receipt_code,
        jsonb_build_object('v',1,'receipt_code',v_receipt_code,'entry_id',v_entry_id,'tournament_id',p_tournament_id,'player_id',v_player_id,'table_number',v_table_number,'seat_number',v_seat_number,'source','offline'),
        'initial','issued', v_actor_user_id) RETURNING id INTO v_receipt_id; EXIT;
    EXCEPTION WHEN unique_violation THEN IF v_attempt >= 5 THEN RAISE; END IF; END;
  END LOOP;

  INSERT INTO public.seat_assignment_history (tournament_id, entry_id, player_id, to_table_id, to_table_number, to_seat_number, reason, draw_type, actor_user_id, metadata)
  VALUES (p_tournament_id, v_entry_id, v_player_id, v_table_game_id, v_table_number, v_seat_number, 'offline_buyin', 'initial', v_actor_user_id,
    jsonb_build_object('draw_mode',p_draw_mode,'registration_id',v_reg_id,'buy_in',p_buy_in,'fee',p_fee,'source','offline'));

  RETURN jsonb_build_object('ok',true,'registration_id',v_reg_id,'entry_id',v_entry_id,'seat_id',v_seat_id,'receipt_id',v_receipt_id,'receipt_code',v_receipt_code,'reference_code',v_ref_code,'table_id',v_table_game_id,'table_number',v_table_number,'seat_number',v_seat_number,'display_name',v_name,'starting_stack',v_starting_stack);
END; $function$;

REVOKE ALL ON FUNCTION public.create_offline_buyin_and_seat(uuid, text, bigint, bigint, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_offline_buyin_and_seat(uuid, text, bigint, bigint, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_offline_buyin_and_seat(uuid, text, bigint, bigint, text, text) TO authenticated, service_role;

-- 6) Offline re-entry: carry the member identity onto the new bullet (best-effort). Same signature,
--    so grants are preserved. Online re-entry is auto-linked by the trigger above (player has profile).
CREATE OR REPLACE FUNCTION public.reenter_tournament_player(p_entry_id uuid, p_buy_in bigint, p_fee bigint, p_draw_mode text DEFAULT 'random_balanced'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_actor_user_id UUID := auth.uid(); v_authorized BOOLEAN; v_src RECORD; v_tour RECORD; v_player_id UUID;
  v_entry_no INTEGER; v_reg_id UUID; v_ref_code TEXT; v_starting_stack INTEGER; v_res JSONB; v_attempt INTEGER := 0;
BEGIN
  IF v_actor_user_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'unauthorized'); END IF;
  IF p_buy_in IS NULL OR p_buy_in <= 0 THEN RETURN jsonb_build_object('ok', false, 'error', 'invalid_buy_in'); END IF;
  IF p_fee IS NULL OR p_fee < 0 THEN RETURN jsonb_build_object('ok', false, 'error', 'invalid_fee'); END IF;
  IF p_draw_mode NOT IN ('random_balanced', 'fill_lowest_table') THEN RETURN jsonb_build_object('ok', false, 'error', 'invalid_draw_mode'); END IF;
  SELECT * INTO v_src FROM public.tournament_entries WHERE id = p_entry_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'entry_not_found'); END IF;
  IF v_src.status <> 'busted' THEN RETURN jsonb_build_object('ok', false, 'error', 'entry_not_reenterable', 'status', v_src.status); END IF;
  v_player_id := v_src.player_id;
  SELECT * INTO v_tour FROM public.tournaments WHERE id = v_src.tournament_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'tournament_not_found'); END IF;
  IF v_tour.status IN ('completed', 'cancelled') THEN RETURN jsonb_build_object('ok', false, 'error', 'tournament_not_open', 'status', v_tour.status); END IF;
  SELECT EXISTS (SELECT 1 FROM public.tournaments t LEFT JOIN public.clubs c ON c.id = t.club_id
    LEFT JOIN public.club_cashiers cc ON cc.club_id = t.club_id AND cc.user_id = v_actor_user_id
    WHERE t.id = v_src.tournament_id AND (c.owner_id = v_actor_user_id OR cc.user_id IS NOT NULL)) INTO v_authorized;
  IF NOT v_authorized THEN RETURN jsonb_build_object('ok', false, 'error', 'actor_not_allowed'); END IF;
  PERFORM 1 FROM public.tournament_seats WHERE tournament_id = v_src.tournament_id AND player_id = v_player_id AND is_active = true;
  IF FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'player_already_active'); END IF;
  PERFORM 1 FROM public.tournament_registrations WHERE source_entry_id = p_entry_id AND status IN ('pending', 'confirmed');
  IF FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'reentry_already_pending'); END IF;
  v_starting_stack := COALESCE(v_tour.starting_stack, 0);
  LOOP
    v_attempt := v_attempt + 1;
    v_ref_code := format('REENTRY-%s', upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)));
    BEGIN
      INSERT INTO public.tournament_registrations (tournament_id, player_id, club_id, buy_in, platform_fixed_fee, total_pay, reference_code, status, committed_at, confirmed_at, confirmed_by, source_entry_id)
      VALUES (v_src.tournament_id, v_player_id, v_tour.club_id, p_buy_in, p_fee, p_buy_in + p_fee, v_ref_code, 'confirmed', now(), now(), v_actor_user_id, p_entry_id) RETURNING id INTO v_reg_id;
      EXIT;
    EXCEPTION WHEN unique_violation THEN IF v_attempt >= 5 THEN RAISE; END IF; END;
  END LOOP;
  v_res := public._assign_reentry_seat(v_src.tournament_id, v_player_id, p_entry_id, v_reg_id, v_actor_user_id, p_draw_mode, v_starting_stack);
  IF NOT COALESCE((v_res->>'ok')::boolean, false) THEN DELETE FROM public.tournament_registrations WHERE id = v_reg_id; RETURN v_res; END IF;

  -- Carry the member identity onto the re-entry bullet (best-effort; walk-in has no profile so the
  -- trigger won't link it). The busted source bullet stays linked; "official finish" is derived at
  -- finalize as the member's LAST entry, so old bullets never show a fake result (see M3).
  BEGIN
    IF v_src.member_id IS NOT NULL AND (v_res ? 'entry_id') THEN
      UPDATE public.tournament_entries SET member_id = v_src.member_id
        WHERE id = (v_res->>'entry_id')::uuid AND member_id IS NULL;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO public.player_history_link_errors (club_id, context, detail)
    VALUES (v_tour.club_id, 'reenter_tournament_player', left(SQLERRM, 500));
  END;

  RETURN v_res || jsonb_build_object('registration_id', v_reg_id, 'reference_code', v_ref_code);
END; $function$;

-- Re-assert grants explicitly (post-audit P2-5): CREATE OR REPLACE preserves existing grants on an
-- unchanged signature, but re-stating them here removes any dependency on unverified live state.
REVOKE ALL ON FUNCTION public.reenter_tournament_player(uuid, bigint, bigint, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reenter_tournament_player(uuid, bigint, bigint, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.reenter_tournament_player(uuid, bigint, bigint, text) TO authenticated, service_role;
