BEGIN;
SET LOCAL request.jwt.claim.role='service_role';
DO $test$
DECLARE v_club uuid:='22000000-0000-4000-8000-000000000001';
  v_owner uuid:='22000000-0000-4000-8000-000000000002';
  v_table uuid:='22000000-0000-4000-8000-000000000003';
  v_dealer uuid:='22000000-0000-4000-8000-000000000004';
  v_att uuid:='22000000-0000-4000-8000-000000000005';
  v_assign uuid:='22000000-0000-4000-8000-000000000006';
BEGIN
  BEGIN
    INSERT INTO public.dealer_assignments(id,club_id,table_id,attendance_id,dealer_id,status)
      VALUES(v_assign,v_club,v_table,v_att,v_dealer,'assigned');
    RAISE EXCEPTION 'test: OFF assignment succeeded';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'AUTO_SWING_OFF' THEN RAISE; END IF; END;
  BEGIN
    UPDATE public.dealer_attendance SET current_state='pre_assigned',pre_assigned_table_id=v_table WHERE id=v_att;
    RAISE EXCEPTION 'test: OFF preassignment succeeded';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'AUTO_SWING_OFF' THEN RAISE; END IF; END;
  BEGIN
    INSERT INTO public.dealer_rotation_schedule VALUES(v_assign,v_club,v_table,'predicted',v_att,now());
    RAISE EXCEPTION 'test: OFF rotation succeeded';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'AUTO_SWING_OFF' THEN RAISE; END IF; END;
  PERFORM set_config('request.headers',jsonb_build_object('x-vinpoker-dealer-intent','manual',
    'x-vinpoker-dealer-actor',v_owner)::text,true);
  INSERT INTO public.dealer_assignments(id,club_id,table_id,attendance_id,dealer_id,status)
    VALUES(v_assign,v_club,v_table,v_att,NULL,'assigned');
  -- Unknown actor cannot use the service manual header as a bypass.
  PERFORM set_config('request.headers','{"x-vinpoker-dealer-intent":"manual","x-vinpoker-dealer-actor":"22000000-0000-4000-8000-000000000009"}',true);
  BEGIN
    UPDATE public.dealer_assignments SET dealer_id=v_dealer WHERE id=v_assign;
    RAISE EXCEPTION 'test: unauthorized manual assignment succeeded';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'DEALER_MANUAL_ACQUISITION_FORBIDDEN' THEN RAISE; END IF; END;
  PERFORM set_config('request.headers','{}',true);
  BEGIN
    UPDATE public.dealer_assignments SET dealer_id=v_dealer WHERE id=v_assign;
    RAISE EXCEPTION 'test: OFF filled existing dealer';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'AUTO_SWING_OFF' THEN RAISE; END IF; END;
  -- Cancelling/releasing is not a new acquisition and remains possible OFF.
  UPDATE public.dealer_assignments SET status='released',released_at=now(),pre_assigned_attendance_id=NULL WHERE id=v_assign;
  UPDATE public.dealer_attendance SET current_state='available',pre_assigned_table_id=NULL WHERE id=v_att;
  UPDATE public.club_settings SET auto_swing_enabled=true WHERE club_id=v_club;
  UPDATE public.dealer_assignments SET status='assigned',released_at=NULL,dealer_id=v_dealer WHERE id=v_assign;
  UPDATE public.dealer_attendance SET current_state='assigned' WHERE id=v_att;
END;
$test$;
ROLLBACK;
