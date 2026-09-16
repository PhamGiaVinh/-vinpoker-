-- Synthetic PostgreSQL 17 baseline for Cashier V1 contract tests only.
-- Never connect this fixture to the linked Supabase project.
\i tests/opsFloorCashier/disposableDb.fixture.sql

ALTER TABLE auth.users ADD COLUMN aud text;
ALTER TABLE auth.users ADD COLUMN role text;
ALTER TABLE auth.users ADD COLUMN email text;
ALTER TABLE auth.users ADD COLUMN created_at timestamptz DEFAULT now();
ALTER TABLE auth.users ADD COLUMN updated_at timestamptz DEFAULT now();
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
$$;
CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('request.jwt.claim.role',true),'')
$$;
-- Live Floor authority also includes the club owner; the shared Ops fixture
-- models only explicit Floor grants, so align this isolated contract here.
CREATE OR REPLACE FUNCTION public.is_club_floor(p_user uuid,p_club uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.club_floors f WHERE f.club_id=p_club AND f.user_id=p_user)
    OR EXISTS (SELECT 1 FROM public.clubs c WHERE c.id=p_club AND c.owner_id=p_user)
    OR public.has_role(p_user,'super_admin'::public.app_role)
$$;

ALTER TABLE public.clubs ADD COLUMN name text;
ALTER TABLE public.clubs ADD COLUMN region text;
ALTER TABLE public.clubs ADD COLUMN status text;
ALTER TABLE public.club_cashiers ADD COLUMN granted_by uuid;
ALTER TABLE public.tournaments ADD COLUMN free_rake_enabled boolean DEFAULT false;
ALTER TABLE public.tournaments ADD COLUMN free_rake_slots integer DEFAULT 0;
ALTER TABLE public.tournaments ADD COLUMN free_rake_used integer DEFAULT 0;
ALTER TABLE public.tournaments ALTER COLUMN starting_stack SET DEFAULT 30000;
ALTER TABLE public.tournaments DROP CONSTRAINT tournaments_status_check;
ALTER TABLE public.tournaments ADD CONSTRAINT tournaments_status_check
  CHECK (status IN ('active','registering','completed','cancelled'));
ALTER TABLE public.tournament_registrations ADD COLUMN used_free_rake boolean DEFAULT false;
ALTER TABLE public.tournament_registrations ADD COLUMN transfer_proof_image_url text;
ALTER TABLE public.tournament_registrations ADD COLUMN transfer_proof_submitted boolean DEFAULT false;
ALTER TABLE public.tournament_registrations ADD COLUMN source_entry_id uuid;
ALTER TABLE public.tournament_registrations ADD COLUMN cancelled_at timestamptz;
ALTER TABLE public.tournament_registrations ADD COLUMN cancelled_by uuid;
ALTER TABLE public.tournament_registrations ADD COLUMN cancellation_reason text;
ALTER TABLE public.tournament_registrations ADD COLUMN updated_at timestamptz DEFAULT now();
ALTER TABLE public.tournament_entries ADD COLUMN busted_at timestamptz;
ALTER TABLE public.tournament_entries ALTER COLUMN source SET DEFAULT 'online';
ALTER TABLE public.seat_draw_receipts ADD COLUMN issued_at timestamptz DEFAULT now();
ALTER TABLE public.seat_draw_receipts ADD COLUMN cancelled_at timestamptz;

CREATE TABLE public.profiles (user_id uuid PRIMARY KEY, display_name text, phone text);
INSERT INTO public.profiles(user_id,display_name) VALUES
  ('91000000-0000-4000-8000-000000000004','Người chơi TEST');
CREATE TABLE public.club_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), club_id uuid, player_user_id uuid,
  full_name text, phone text, member_card_id text, updated_at timestamptz DEFAULT now()
);
CREATE TABLE public.bank_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), provider text, api_verified_at timestamptz,
  provider_txn_id text, raw_payload jsonb,
  transfer_type text, amount bigint, status text, account_number text, content text,
  txn_ref text, club_id uuid, processed_at timestamptz,
  occurred_at timestamptz DEFAULT now(), created_at timestamptz DEFAULT now()
);
CREATE TABLE public.platform_bank_accounts (
  id uuid PRIMARY KEY, club_id uuid, bank_name text, account_number text,
  account_holder text, is_active boolean DEFAULT true
);
CREATE TABLE public.sepay_system_settings (
  id boolean PRIMARY KEY, system_actor_id uuid, auto_confirm_enabled boolean DEFAULT false
);
CREATE TABLE public.payment_settlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tournament_registration_id uuid,
  bank_transaction_id uuid, outcome text
);
CREATE TABLE public.club_payment_config (club_id uuid PRIMARY KEY, last_pull_status text);
CREATE TABLE public.club_accountants (club_id uuid, user_id uuid);
CREATE TABLE public.user_roles (user_id uuid, role text);
CREATE TABLE public.tournament_close_report (tournament_id uuid PRIMARY KEY);
CREATE TYPE public.notification_type AS ENUM ('registration_confirmed');
CREATE TABLE public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid,
  type public.notification_type, title text, body text, data jsonb
);

CREATE OR REPLACE FUNCTION public.is_tournament_registration_closed(uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
CREATE OR REPLACE FUNCTION public.sepay_parse_reference_code(p_text text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT substring(upper(p_text) from '(VINREG[A-Z0-9]+)')
$$;

-- Isolate the Cashier contract from the existing seating algorithm. The
-- synthetic helper exposes the same public seat result and receipt side effect.
CREATE OR REPLACE FUNCTION public.confirm_registration_and_assign_seat(
  p_registration_id uuid,p_actor_id uuid,p_mode text)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE v_reg public.tournament_registrations%ROWTYPE; v_table uuid;
  v_table_number integer; v_seat uuid; v_receipt text;
BEGIN
  SELECT * INTO v_reg FROM public.tournament_registrations WHERE id=p_registration_id;
  SELECT tt.table_id,tt.table_number INTO v_table,v_table_number
    FROM public.tournament_tables tt WHERE tt.tournament_id=v_reg.tournament_id LIMIT 1;
  IF v_table IS NULL THEN RETURN jsonb_build_object('ok',false,'error','no_table_available'); END IF;
  v_seat:=gen_random_uuid(); v_receipt:='TEST-'||replace(v_reg.id::text,'-','');
  INSERT INTO public.tournament_entries(tournament_id,registration_id,player_id,entry_no,source,status)
    VALUES(v_reg.tournament_id,v_reg.id,v_reg.player_id,1,'online','registered');
  INSERT INTO public.tournament_seats(id,tournament_id,player_id,table_id,seat_number,entry_id)
    SELECT v_seat,v_reg.tournament_id,v_reg.player_id,v_table,1,e.id
    FROM public.tournament_entries e WHERE e.registration_id=v_reg.id LIMIT 1;
  INSERT INTO public.seat_draw_receipts(tournament_id,registration_id,player_id,display_name,
    table_id,table_number,seat_id,seat_number,receipt_code,qr_payload,draw_type,issued_by)
    VALUES(v_reg.tournament_id,v_reg.id,v_reg.player_id,'TEST',v_table,v_table_number,
      v_seat,1,v_receipt,jsonb_build_object('receipt_code',v_receipt),'initial',p_actor_id);
  UPDATE public.tournament_registrations SET status='confirmed',confirmed_at=now(),confirmed_by=p_actor_id
    WHERE id=v_reg.id;
  RETURN jsonb_build_object('ok',true,'table_number',v_table_number,
    'seat_number',1,'receipt_code',v_receipt);
END $$;
CREATE OR REPLACE FUNCTION public.confirm_reentry_and_assign_seat(uuid,uuid,text)
RETURNS jsonb LANGUAGE sql AS $$ SELECT jsonb_build_object('ok',false,'error','no_table_available') $$;
