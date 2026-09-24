\set ON_ERROR_STOP on

-- Disposable, network-isolated real-Auth Cashier browser fixture only.
INSERT INTO public.tournaments
  (id,club_id,name,status,live_status,start_time,buy_in,rake_amount,service_fee_amount,
   free_rake_enabled,free_rake_slots,free_rake_used)
VALUES
  ('a3000000-0000-4000-8000-000000000002','a2000000-0000-4000-8000-000000000001',
   'Cashier Edge TEST Tour B','registering','registering',now()+interval '1 day',
   6000000,600000,0,false,0,0);

SELECT (public.cashier_create_app_registration_v1(
  'a3000000-0000-4000-8000-000000000002',:'player_id'::uuid)->>'registration_id') AS registration_id \gset

INSERT INTO public.cashier_till_shifts(id,club_id,opening_cash,opened_by)
VALUES ('a5000000-0000-4000-8000-000000000001',
  'a2000000-0000-4000-8000-000000000001',0,:'owner_id'::uuid);

INSERT INTO public.cashier_buyin_movements
  (club_id,tournament_id,registration_id,shift_id,direction,method,purpose,
   amount,applied_amount,actor_id,idempotency_key)
VALUES ('a2000000-0000-4000-8000-000000000001',
  'a3000000-0000-4000-8000-000000000002',:'registration_id'::uuid,
  'a5000000-0000-4000-8000-000000000001','in','cash','buyin',
  6600000,6600000,:'owner_id'::uuid,'isolated:tour-b:paid');
UPDATE public.tournament_registrations SET cashier_paid_at=now()
  WHERE id=:'registration_id'::uuid;

SELECT jsonb_build_object('registration_id',r.id,'reference_code',r.reference_code)
FROM public.tournament_registrations r WHERE r.id=:'registration_id'::uuid;
