-- Disposable restore security contract only. Never applied to production.
-- Source of truth: migration 20270115000003_cashier_tour_money_v1.sql.

REVOKE ALL ON FUNCTION public.cashier_complete_refund_v1(uuid,bigint,bigint,text,text)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.cashier_complete_refund_v1(uuid,bigint,bigint,text,text)
  TO authenticated;
