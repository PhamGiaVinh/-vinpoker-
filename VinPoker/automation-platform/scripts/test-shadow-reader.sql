\set ON_ERROR_STOP on

-- Disposable local TEST only. The login receives SELECT on this fixed synthetic view and nothing
-- on canonical base tables. The password is supplied through psql variable digest_password.
CREATE SCHEMA IF NOT EXISTS vinpoker_test;
REVOKE ALL ON SCHEMA vinpoker_test FROM PUBLIC;

CREATE OR REPLACE VIEW vinpoker_test.owner_digest_shadow_source
WITH (security_barrier = true)
AS
SELECT
  c.id AS club_id,
  c.owner_id AS owner_id,
  c.name AS display_code,
  (SELECT count(*) FROM public.tournament_registrations r WHERE r.club_id = c.id) AS registrations,
  (SELECT count(DISTINCT r.player_id) FROM public.tournament_registrations r WHERE r.club_id = c.id AND r.status = 'confirmed') AS attendance,
  (SELECT count(*) FROM public.tournament_registrations r WHERE r.club_id = c.id AND r.status = 'confirmed') AS entries,
  (SELECT count(*) FROM public.dealers d WHERE d.club_id = c.id AND d.deleted_at IS NULL) AS staff,
  (SELECT coalesce(sum(t.rake_amount), 0) FROM public.tournament_registrations r JOIN public.tournaments t ON t.id = r.tournament_id WHERE r.club_id = c.id AND r.status = 'confirmed' AND NOT r.used_free_rake) AS rake_retained_vnd,
  (SELECT coalesce(sum(o.subtotal_vnd), 0) FROM public.fnb_orders o WHERE o.club_id = c.id AND o.status IN ('paid', 'shipped') AND NOT o.is_comp) AS fnb_net_revenue_vnd,
  (SELECT coalesce(sum(cr.prize_total), 0) FROM public.tournament_close_report cr WHERE cr.club_id = c.id)
    - (SELECT coalesce(sum(p.prize_amount), 0) FROM public.tournament_prize_payments p WHERE p.club_id = c.id AND p.status = 'paid') AS pending_liabilities_vnd,
  (SELECT coalesce(sum(dp.net_pay_after_tax_vnd), 0) FROM public.dealer_payroll dp JOIN public.payroll_periods pp ON pp.id = dp.period_id WHERE dp.club_id = c.id AND pp.status = 'draft' AND dp.status = 'pending') AS payroll_provisional_vnd
FROM public.clubs c
WHERE c.id IN (
  '10000000-0000-4000-8000-000000000001'::uuid,
  '10000000-0000-4000-8000-000000000002'::uuid
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vinpoker_digest_shadow_reader') THEN
    CREATE ROLE vinpoker_digest_shadow_reader LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
END
$$;

ALTER ROLE vinpoker_digest_shadow_reader PASSWORD :'digest_password';
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM vinpoker_digest_shadow_reader;
GRANT CONNECT ON DATABASE postgres TO vinpoker_digest_shadow_reader;
GRANT USAGE ON SCHEMA vinpoker_test TO vinpoker_digest_shadow_reader;
GRANT SELECT ON vinpoker_test.owner_digest_shadow_source TO vinpoker_digest_shadow_reader;
