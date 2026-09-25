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
 amount bigint,applied_amount bigint);
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
