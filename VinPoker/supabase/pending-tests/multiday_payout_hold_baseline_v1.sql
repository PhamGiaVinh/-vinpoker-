-- Disposable exact-column subset of live prize/run/payment tables.
-- It exercises the package fence, not payout calculation or production data.
CREATE TABLE public.tournament_prizes(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tournament_id uuid NOT NULL REFERENCES public.tournaments(id),
 position integer NOT NULL,amount numeric(12,2) NOT NULL);
CREATE TABLE public.tournament_payout_runs(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tournament_id uuid NOT NULL REFERENCES public.tournaments(id),status text NOT NULL);
CREATE TABLE public.tournament_prize_payments(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tournament_id uuid NOT NULL REFERENCES public.tournaments(id),status text NOT NULL,
 prize_amount numeric(12,2) NOT NULL);
-- Simulate a historical package schedule/payment that exists before the new
-- hold. Neither may be overwritten after a source flight has ended.
INSERT INTO public.tournament_prizes(id,tournament_id,position,amount)
 VALUES('a1000000-0000-0000-0000-000000000001',
  '40000000-0000-0000-0000-000000000008',1,1000000);
INSERT INTO public.tournament_prize_payments(id,tournament_id,status,prize_amount)
 VALUES('a2000000-0000-0000-0000-000000000001',
  '40000000-0000-0000-0000-000000000008','paid',1000000);
