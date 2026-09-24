\set ON_ERROR_STOP on

INSERT INTO public.profiles(user_id,display_name) VALUES
  (:'player_id'::uuid,'Người chơi Edge TEST'),
  (:'owner_id'::uuid,'Thu ngân Edge TEST')
ON CONFLICT (user_id) DO UPDATE SET display_name=EXCLUDED.display_name;

INSERT INTO public.clubs(id,owner_id,name,region,status) VALUES
  ('a2000000-0000-4000-8000-000000000001',:'owner_id'::uuid,
   'Cashier Edge TEST','HCM','approved');

INSERT INTO public.club_cashiers(club_id,user_id,granted_by) VALUES
  ('a2000000-0000-4000-8000-000000000001',:'owner_id'::uuid,:'owner_id'::uuid);

INSERT INTO public.tournaments
  (id,club_id,name,status,live_status,start_time,buy_in,rake_amount,service_fee_amount,
   free_rake_enabled,free_rake_slots,free_rake_used)
VALUES
  ('a3000000-0000-4000-8000-000000000001','a2000000-0000-4000-8000-000000000001',
   'Cashier Edge TEST Tour','registering','registering',now()+interval '1 day',
   6000000,600000,0,false,0,0);

INSERT INTO public.cashier_tour_settings(club_id,enabled) VALUES
  ('a2000000-0000-4000-8000-000000000001',true);

INSERT INTO public.platform_bank_accounts
  (id,club_id,bank_name,account_number,account_holder,is_active)
VALUES
  ('a4000000-0000-4000-8000-000000000001','a2000000-0000-4000-8000-000000000001',
   'TEST BANK','999100001','CASHIER EDGE TEST',true);

SELECT vault.create_secret(
  'cashier-edge-fake-token','cashier_edge_sepay_token','isolated Cashier Edge TEST only');
INSERT INTO public.club_payment_config
  (club_id,master_account_number,api_token_vault_key,is_active,updated_by)
VALUES
  ('a2000000-0000-4000-8000-000000000001','999100001',
   'cashier_edge_sepay_token',true,:'owner_id'::uuid);

INSERT INTO public.sepay_system_settings(id,system_actor_id,auto_confirm_enabled)
VALUES (true,:'owner_id'::uuid,true)
ON CONFLICT (id) DO UPDATE SET
  system_actor_id=EXCLUDED.system_actor_id,
  auto_confirm_enabled=EXCLUDED.auto_confirm_enabled;

INSERT INTO public.game_tables
  (id,club_id,table_name,table_type,status,table_number)
VALUES
  ('a7000000-0000-4000-8000-000000000001','a2000000-0000-4000-8000-000000000001',
   'Cashier Edge TEST Table','tournament','active',1);
INSERT INTO public.tournament_tables
  (id,tournament_id,table_name,table_id,table_number,max_seats,status)
VALUES
  ('a8000000-0000-4000-8000-000000000001','a3000000-0000-4000-8000-000000000001',
   'Cashier Edge TEST Table','a7000000-0000-4000-8000-000000000001',1,9,'active');
