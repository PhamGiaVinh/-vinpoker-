-- card_reissue_log — immutable audit log of member-card reissues (a cashier prints a replacement card).
-- SOURCE-ONLY: apply in an owner-gated SQL session. Until applied, CardReissueTab still works for
-- scanning/enrolling/printing (all via the live `club_members` table) — only the audit history + the
-- log INSERT need this table, and the UI degrades gracefully (best-effort log, clear notice) when absent.
--
-- Depends on existing objects: public.clubs(id), public.is_club_cashier(uuid, uuid), public.has_role(...).
-- NOTE: if `has_role`'s role arg is an enum (app_role), change 'super_admin' → 'super_admin'::app_role.

CREATE TABLE IF NOT EXISTS public.card_reissue_log (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id        uuid NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  member_card_id text NOT NULL,                 -- card id at the moment of reissue
  player_user_id uuid,                          -- linked user (nullable — may be unlinked)
  reissue_code   text NOT NULL,                 -- R-YYYYMMDD-XXXX (client-generated)
  reason         text,                          -- lost / damaged / renamed…
  reissued_by    uuid NOT NULL,                 -- auth.uid() of the cashier
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_card_reissue_log_club_created
  ON public.card_reissue_log (club_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_card_reissue_log_member_card
  ON public.card_reissue_log (member_card_id);

ALTER TABLE public.card_reissue_log ENABLE ROW LEVEL SECURITY;

-- Read: cashier of that club, or super_admin.
DROP POLICY IF EXISTS "cashier read reissue log" ON public.card_reissue_log;
CREATE POLICY "cashier read reissue log"
  ON public.card_reissue_log FOR SELECT TO authenticated
  USING (
    public.is_club_cashier(auth.uid(), club_id)
    OR public.has_role(auth.uid(), 'super_admin')
  );

-- Insert: only as self (reissued_by = auth.uid()) and only a cashier of that club (or super_admin).
DROP POLICY IF EXISTS "cashier insert reissue log" ON public.card_reissue_log;
CREATE POLICY "cashier insert reissue log"
  ON public.card_reissue_log FOR INSERT TO authenticated
  WITH CHECK (
    reissued_by = auth.uid()
    AND (
      public.is_club_cashier(auth.uid(), club_id)
      OR public.has_role(auth.uid(), 'super_admin')
    )
  );

-- No UPDATE / DELETE policy → immutable audit log.

REVOKE ALL ON public.card_reissue_log FROM anon;
GRANT SELECT, INSERT ON public.card_reissue_log TO authenticated;
