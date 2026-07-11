-- ============================================================================
-- Floor: restore_busted_player_to_seat — cho NGƯỜI CHƠI ĐÃ BỊ LOẠI vào lại 1 ghế trống
-- ============================================================================
-- Use case (owner): operator LOẠI NHẦM một người → khôi phục họ về bàn·ghế đang trống.
-- Không có RPC/Edge sẵn nào làm đúng: update_seats{is_active:true} chỉ sửa GHẾ, entry vẫn 'busted'
-- (→ hiện ở cả danh sách đang chơi lẫn busted); move_player_seat chặn 'entry_not_seated'/'no_active_seat';
-- floor_assign_player_to_seat tạo player_id/entry MỚI; reenter_tournament_player là re-buy có tiền.
-- → RPC MỚI này un-bust ĐÚNG entry cũ + claim ghế trống + trả chip cũ, trong 1 giao dịch.
--
-- SEMANTICS (owner-approved):
--   • Cho phép ở MỌI trạng thái, KỂ CẢ đã chốt kết quả → xoá finished_place + bust_order để giải
--     "chưa xong" trở lại. ⚠️ KHÔNG tự sửa payout run đã áp — nếu đã chốt payout, operator phải
--     đóng lại / tính lại payout sau khi khôi phục.
--   • Chip = số chip trên ghế lúc bị loại (fallback tournament_entries.current_stack, rồi 0).
--   • Ghế = 1 ghế TRỐNG do operator chọn (partial unique index chống trùng → 'seat_occupied').
--
-- SECURITY: SECURITY DEFINER; actor = auth.uid() (bind, chống spoof — p_actor_user_id chỉ để đối
--   chiếu); authz = chủ CLB (clubs.owner_id) HOẶC club_cashiers của CLB; anon/PUBLIC bị REVOKE.
-- Mirror move_player_seat (20260807000002): validate bàn đích + claim ghế qua unique_violation.
-- SOURCE-ONLY: chưa apply live — owner apply qua controlled runbook (BEGIN..COMMIT + dry-run).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.restore_busted_player_to_seat(
  p_entry_id uuid,
  p_to_tournament_table_id uuid,
  p_to_seat_number integer,
  p_actor_user_id uuid DEFAULT NULL,
  p_reason text DEFAULT 'floor_restore'
) RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_actor        uuid := auth.uid();
  v_entry        RECORD;
  v_bseat        RECORD;
  v_to_tt        RECORD;
  v_chip         integer;
  v_name         text;
  v_new_seat_id  uuid;
  v_authorized   boolean;
  v_receipt_id   uuid;
  v_receipt_code text;
  v_attempt      integer := 0;
BEGIN
  IF v_actor IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unauthorized');
  END IF;
  IF p_actor_user_id IS NOT NULL AND p_actor_user_id <> v_actor THEN
    RETURN jsonb_build_object('ok', false, 'error', 'actor_mismatch');
  END IF;

  SELECT * INTO v_entry FROM public.tournament_entries WHERE id = p_entry_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'entry_not_found');
  END IF;
  IF v_entry.status <> 'busted' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'entry_not_busted', 'status', v_entry.status);
  END IF;

  -- Authz: chủ CLB hoặc cashier của CLB (mirror move_player_seat)
  SELECT EXISTS (
    SELECT 1 FROM public.tournaments t
    LEFT JOIN public.clubs c ON c.id = t.club_id
    LEFT JOIN public.club_cashiers cc ON cc.club_id = t.club_id AND cc.user_id = v_actor
    WHERE t.id = v_entry.tournament_id
      AND (c.owner_id = v_actor OR cc.user_id IS NOT NULL)
  ) INTO v_authorized;
  IF NOT v_authorized THEN
    RETURN jsonb_build_object('ok', false, 'error', 'actor_not_allowed');
  END IF;

  -- Player không được vừa busted vừa có ghế active
  IF EXISTS (
    SELECT 1 FROM public.tournament_seats
    WHERE tournament_id = v_entry.tournament_id AND player_id = v_entry.player_id AND is_active = true
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'already_active');
  END IF;

  -- Ghế bị loại gần nhất (giữ chip + tên); fallback entries
  SELECT * INTO v_bseat FROM public.tournament_seats
  WHERE entry_id = p_entry_id AND is_active = false
  ORDER BY assigned_at DESC NULLS LAST, created_at DESC
  LIMIT 1;
  v_chip := COALESCE(v_bseat.chip_count, v_entry.current_stack, 0);
  v_name := COALESCE(
    v_bseat.player_name,
    (SELECT display_name FROM public.profiles WHERE user_id = v_entry.player_id),
    v_entry.player_id::text
  );

  -- Bàn đích hợp lệ
  SELECT * INTO v_to_tt FROM public.tournament_tables
  WHERE id = p_to_tournament_table_id AND tournament_id = v_entry.tournament_id
    AND status = 'active' AND table_id IS NOT NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_destination_table');
  END IF;
  IF p_to_seat_number < 1 OR p_to_seat_number > v_to_tt.max_seats THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_seat_number', 'max_seats', v_to_tt.max_seats);
  END IF;

  -- Claim ghế trống (partial unique index active-seat / active-player chống trùng)
  BEGIN
    INSERT INTO public.tournament_seats (
      tournament_id, player_id, entry_number, table_id, seat_number,
      chip_count, is_active, player_name, entry_id, status, assigned_by, assigned_at
    ) VALUES (
      v_entry.tournament_id, v_entry.player_id, v_entry.entry_no,
      p_to_tournament_table_id, p_to_seat_number,
      v_chip, true, v_name, p_entry_id, 'active', v_actor, now()
    ) RETURNING id INTO v_new_seat_id;
  EXCEPTION WHEN unique_violation THEN
    RETURN jsonb_build_object('ok', false, 'error', 'seat_occupied');
  END;

  -- Ghế busted cũ → 'moved' (khỏi lẫn; is_active vẫn false)
  IF v_bseat.id IS NOT NULL THEN
    UPDATE public.tournament_seats SET status = 'moved' WHERE id = v_bseat.id;
  END IF;

  -- UN-BUST entry: seated + xoá dấu loại + gắn ghế mới
  UPDATE public.tournament_entries
  SET status = 'seated', busted_at = NULL, bust_order = NULL, finished_place = NULL,
      table_id = v_to_tt.table_id, seat_number = p_to_seat_number,
      seat_id = v_new_seat_id, current_stack = v_chip
  WHERE id = p_entry_id;

  -- players_remaining = số ghế active (source-of-truth), cập nhật ngay
  UPDATE public.tournaments
  SET players_remaining = (
    SELECT COUNT(*) FROM public.tournament_seats
    WHERE tournament_id = v_entry.tournament_id AND is_active = true
  )
  WHERE id = v_entry.tournament_id;

  -- Receipt ghế mới (mirror move)
  LOOP
    v_attempt := v_attempt + 1;
    v_receipt_code := format('T%s-S%s-%s',
      COALESCE(v_to_tt.table_number::text, '?'), p_to_seat_number,
      upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6)));
    BEGIN
      INSERT INTO public.seat_draw_receipts (
        tournament_id, registration_id, entry_id, player_id, display_name,
        table_id, table_number, seat_id, seat_number, receipt_code,
        qr_payload, draw_type, status, issued_by
      ) VALUES (
        v_entry.tournament_id, v_entry.registration_id, p_entry_id,
        v_entry.player_id, v_name, v_to_tt.table_id, v_to_tt.table_number,
        v_new_seat_id, p_to_seat_number, v_receipt_code,
        jsonb_build_object('v', 1, 'receipt_code', v_receipt_code, 'entry_id', p_entry_id,
          'tournament_id', v_entry.tournament_id, 'player_id', v_entry.player_id,
          'table_number', v_to_tt.table_number, 'seat_number', p_to_seat_number, 'restore_reason', p_reason),
        'manual_move', 'issued', v_actor
      ) RETURNING id INTO v_receipt_id;
      EXIT;
    EXCEPTION WHEN unique_violation THEN
      IF v_attempt >= 5 THEN RAISE; END IF;
    END;
  END LOOP;

  -- History
  INSERT INTO public.seat_assignment_history (
    tournament_id, entry_id, player_id,
    from_table_id, from_table_number, from_seat_number,
    to_table_id, to_table_number, to_seat_number,
    reason, draw_type, actor_user_id, metadata
  ) VALUES (
    v_entry.tournament_id, p_entry_id, v_entry.player_id,
    NULL, NULL, v_bseat.seat_number,
    v_to_tt.table_id, v_to_tt.table_number, p_to_seat_number,
    p_reason, 'manual_move', v_actor,
    jsonb_build_object('restored_from_busted', true, 'chip_count', v_chip,
      'to_tournament_table_id', p_to_tournament_table_id)
  );

  RETURN jsonb_build_object(
    'ok', true, 'entry_id', p_entry_id, 'player_name', v_name,
    'to_table_number', v_to_tt.table_number, 'to_seat_number', p_to_seat_number,
    'chip_count', v_chip, 'seat_id', v_new_seat_id, 'receipt_code', v_receipt_code
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.restore_busted_player_to_seat(uuid, uuid, integer, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.restore_busted_player_to_seat(uuid, uuid, integer, uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.restore_busted_player_to_seat(uuid, uuid, integer, uuid, text) TO authenticated;
