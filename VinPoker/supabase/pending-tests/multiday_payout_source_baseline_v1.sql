-- Disposable interface contract for Satellite #1344, not its migration or
-- redeem implementation. Production ordering requires #1344 first.
ALTER TABLE public.tournament_entries ADD COLUMN finished_place integer;
ALTER TABLE public.tournament_registrations
 ADD COLUMN club_id uuid,ADD COLUMN buy_in bigint,
 ADD COLUMN platform_fixed_fee bigint,ADD COLUMN total_pay bigint,
 ADD COLUMN status text NOT NULL DEFAULT 'confirmed',
 ADD COLUMN confirmed_at timestamptz DEFAULT now(),
 ADD COLUMN price_snapshot jsonb;
CREATE TABLE public.cashier_buyin_movements(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 club_id uuid,tournament_id uuid,registration_id uuid,purpose text,direction text,
 amount bigint,applied_amount bigint,bank_transaction_id uuid);
CREATE TABLE public.bank_transactions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 provider text,api_verified_at timestamptz,transfer_type text,amount bigint,
 status text,account_number text,club_id uuid,processed_at timestamptz);
CREATE TABLE public.platform_bank_accounts(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 club_id uuid,account_number text,is_active boolean);
CREATE TABLE public.payment_settlements(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 bank_transaction_id uuid);
INSERT INTO public.platform_bank_accounts(club_id,account_number,is_active)
VALUES('20000000-0000-0000-0000-000000000001','proof-account-1',true);
CREATE TABLE public.satellite_tickets(id uuid PRIMARY KEY,status text NOT NULL);
CREATE TABLE public.satellite_ticket_value_transfers(id uuid PRIMARY KEY,
 ticket_id uuid NOT NULL,source_tournament_id uuid,target_tournament_id uuid NOT NULL,
 registration_id uuid NOT NULL,club_id uuid NOT NULL,source_debit_vnd bigint NOT NULL,
 target_credit_vnd bigint NOT NULL,target_buy_in_vnd bigint NOT NULL,
 target_rake_vnd bigint NOT NULL,target_service_fee_vnd bigint NOT NULL);
CREATE TABLE public.satellite_redemption_reversals(request_id uuid PRIMARY KEY,
 original_transfer_id uuid NOT NULL,target_tournament_id uuid NOT NULL,
 registration_id uuid NOT NULL,target_debit_vnd bigint NOT NULL);
-- Signature-only dependency fixture. These never execute in this harness;
-- production requires the actual #1344 migrations and tests in order.
CREATE FUNCTION public.satellite_redeem_ticket_v1(uuid,uuid,uuid,uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql AS $$ BEGIN
 RAISE EXCEPTION 'satellite_fixture_rpc_not_executable'; END $$;
CREATE FUNCTION public.satellite_approve_redemption_reversal_v1(uuid,uuid,text,uuid)
RETURNS jsonb LANGUAGE plpgsql AS $$ BEGIN
 RAISE EXCEPTION 'satellite_fixture_rpc_not_executable'; END $$;
-- Historical malformed movement before the forward identity trigger exists.
-- The new preview must reject it even though its tournament points elsewhere.
INSERT INTO public.tournament_events(id,club_id,final_tournament_id)
VALUES('30000000-0000-0000-0000-00000000000c',
 '20000000-0000-0000-0000-000000000001',
 '40000000-0000-0000-0000-000000000040');
INSERT INTO public.tournaments(id,club_id,event_id,phase) VALUES
('40000000-0000-0000-0000-000000000041',
 '20000000-0000-0000-0000-000000000001',
 '30000000-0000-0000-0000-00000000000c','flight'),
('40000000-0000-0000-0000-000000000040',
 '20000000-0000-0000-0000-000000000001',
 '30000000-0000-0000-0000-00000000000c','final');
INSERT INTO public.tournament_registrations(id,tournament_id,player_id,club_id,
 buy_in,platform_fixed_fee,total_pay,status,confirmed_at,price_snapshot)
VALUES('b0000000-0000-0000-0000-000000000041',
 '40000000-0000-0000-0000-000000000041',
 '60000000-0000-0000-0000-000000000021',
 '20000000-0000-0000-0000-000000000001',1000000,100000,1100000,
 'confirmed',now(),'{"tender":"cash"}'::jsonb);
INSERT INTO public.cashier_buyin_movements(club_id,tournament_id,
 registration_id,purpose,direction,amount,applied_amount)
VALUES('20000000-0000-0000-0000-000000000001',
 '40000000-0000-0000-0000-000000000006',
 'b0000000-0000-0000-0000-000000000041','buyin','in',1100000,1100000);
