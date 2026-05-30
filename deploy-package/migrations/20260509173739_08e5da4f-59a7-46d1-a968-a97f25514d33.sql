
CREATE OR REPLACE FUNCTION public.is_media_or_admin(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.has_role(_user_id, 'super_admin'::public.app_role)
      OR public.has_role(_user_id, 'media'::public.app_role)
$$;

CREATE POLICY "Media manage news" ON public.news_posts
  FOR ALL USING (public.is_media_or_admin(auth.uid()))
  WITH CHECK (public.is_media_or_admin(auth.uid()));

CREATE POLICY "Media manage series" ON public.tournament_series
  FOR ALL USING (public.is_media_or_admin(auth.uid()))
  WITH CHECK (public.is_media_or_admin(auth.uid()));

CREATE POLICY "Media manage series posts" ON public.series_posts
  FOR ALL USING (public.is_media_or_admin(auth.uid()))
  WITH CHECK (public.is_media_or_admin(auth.uid()));

CREATE POLICY "Media manage international events" ON public.international_events
  FOR ALL USING (public.is_media_or_admin(auth.uid()))
  WITH CHECK (public.is_media_or_admin(auth.uid()));

CREATE POLICY "Media manage app settings" ON public.app_settings
  FOR ALL USING (public.is_media_or_admin(auth.uid()))
  WITH CHECK (public.is_media_or_admin(auth.uid()));

CREATE POLICY "Media update clubs schedules" ON public.clubs
  FOR UPDATE USING (public.has_role(auth.uid(), 'media'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'media'::public.app_role));

-- Support tickets: extend to media
CREATE POLICY "Media views all tickets" ON public.support_tickets
  FOR SELECT USING (public.has_role(auth.uid(), 'media'::public.app_role));
CREATE POLICY "Media manages tickets" ON public.support_tickets
  FOR UPDATE USING (public.has_role(auth.uid(), 'media'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'media'::public.app_role));

-- Support conversation messages
CREATE TABLE IF NOT EXISTS public.support_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES public.support_tickets(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL,
  body text NOT NULL,
  attachment_url text,
  is_internal boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_support_messages_ticket ON public.support_messages(ticket_id, created_at);
ALTER TABLE public.support_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Participants read support messages" ON public.support_messages
  FOR SELECT USING (
    public.is_media_or_admin(auth.uid())
    OR (
      is_internal = false
      AND EXISTS (SELECT 1 FROM public.support_tickets t WHERE t.id = ticket_id AND t.user_id = auth.uid())
    )
  );
CREATE POLICY "Participants send support messages" ON public.support_messages
  FOR INSERT WITH CHECK (
    sender_id = auth.uid()
    AND (
      public.is_media_or_admin(auth.uid())
      OR (is_internal = false AND EXISTS (SELECT 1 FROM public.support_tickets t WHERE t.id = ticket_id AND t.user_id = auth.uid()))
    )
  );

CREATE OR REPLACE FUNCTION public.trg_support_msg_bump()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.support_tickets
  SET updated_at = now(),
      status = CASE WHEN status = 'resolved' THEN 'in_progress' ELSE status END
  WHERE id = NEW.ticket_id;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_support_msg_bump_after_insert ON public.support_messages;
CREATE TRIGGER trg_support_msg_bump_after_insert
  AFTER INSERT ON public.support_messages
  FOR EACH ROW EXECUTE FUNCTION public.trg_support_msg_bump();
