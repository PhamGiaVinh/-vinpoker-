
CREATE TABLE IF NOT EXISTS public.support_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  category text NOT NULL CHECK (category IN ('technical','financial','account','other')),
  subject text,
  content text NOT NULL,
  ticket_ref text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','in_progress','resolved')),
  assigned_to uuid,
  resolution_note text,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.support_tickets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "User creates own ticket"
  ON public.support_tickets FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "User views own or admin all"
  ON public.support_tickets FOR SELECT
  USING (user_id = auth.uid() OR has_role(auth.uid(), 'super_admin'::app_role));

CREATE POLICY "Admin manages tickets"
  ON public.support_tickets FOR UPDATE
  USING (has_role(auth.uid(), 'super_admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'super_admin'::app_role));

CREATE POLICY "Admin deletes tickets"
  ON public.support_tickets FOR DELETE
  USING (has_role(auth.uid(), 'super_admin'::app_role));

CREATE TRIGGER trg_support_tickets_updated
  BEFORE UPDATE ON public.support_tickets
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX IF NOT EXISTS idx_support_tickets_user ON public.support_tickets(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_support_tickets_status ON public.support_tickets(status, created_at DESC);

-- Seed support_user_id = first super_admin
INSERT INTO public.app_settings (key, value)
SELECT 'support_user_id', to_jsonb(ur.user_id::text)
FROM public.user_roles ur
WHERE ur.role = 'super_admin'
ORDER BY ur.user_id
LIMIT 1
ON CONFLICT (key) DO NOTHING;
