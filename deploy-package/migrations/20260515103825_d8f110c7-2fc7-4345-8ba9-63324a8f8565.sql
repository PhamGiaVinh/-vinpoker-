
-- ============ Attachments on messages ============
ALTER TABLE public.chat_group_messages
  ADD COLUMN IF NOT EXISTS attachment_url text,
  ADD COLUMN IF NOT EXISTS attachment_type text,
  ADD COLUMN IF NOT EXISTS attachment_name text,
  ADD COLUMN IF NOT EXISTS attachment_size integer;

ALTER TABLE public.chat_group_messages
  DROP CONSTRAINT IF EXISTS chat_group_messages_content_check;

ALTER TABLE public.chat_group_messages
  ALTER COLUMN content DROP NOT NULL;

ALTER TABLE public.chat_group_messages
  ADD CONSTRAINT chat_group_messages_content_or_attachment
  CHECK (
    (content IS NOT NULL AND length(btrim(content)) BETWEEN 1 AND 2000)
    OR attachment_url IS NOT NULL
  );

-- ============ Allow members to add other users ============
DROP POLICY IF EXISTS "Self-join public group or creator add" ON public.chat_group_members;

CREATE POLICY "Join public, member-add, or creator-add"
ON public.chat_group_members FOR INSERT TO authenticated
WITH CHECK (
  -- Self-join a public group
  (user_id = auth.uid() AND EXISTS (
    SELECT 1 FROM public.chat_groups g
    WHERE g.id = group_id AND g.deleted_at IS NULL AND g.is_public = true
  ))
  -- Existing member adds someone else
  OR public.is_group_member(auth.uid(), group_id)
  -- Creator adds someone (covers brand new groups too)
  OR public.is_group_creator(auth.uid(), group_id)
);

-- ============ Invites table ============
CREATE TABLE IF NOT EXISTS public.chat_group_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES public.chat_groups(id) ON DELETE CASCADE,
  token text NOT NULL UNIQUE,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  max_uses integer,
  uses integer NOT NULL DEFAULT 0,
  revoked_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_cgi_group ON public.chat_group_invites(group_id);
CREATE INDEX IF NOT EXISTS idx_cgi_token ON public.chat_group_invites(token);

ALTER TABLE public.chat_group_invites ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members read invites of their groups"
ON public.chat_group_invites FOR SELECT TO authenticated
USING (public.is_group_member(auth.uid(), group_id));

CREATE POLICY "Members create invites"
ON public.chat_group_invites FOR INSERT TO authenticated
WITH CHECK (
  created_by = auth.uid()
  AND public.is_group_member(auth.uid(), group_id)
);

CREATE POLICY "Members revoke invites"
ON public.chat_group_invites FOR UPDATE TO authenticated
USING (public.is_group_member(auth.uid(), group_id))
WITH CHECK (public.is_group_member(auth.uid(), group_id));

CREATE POLICY "Members delete invites"
ON public.chat_group_invites FOR DELETE TO authenticated
USING (public.is_group_member(auth.uid(), group_id));

-- ============ RPC: invite preview (anyone, even unauthenticated) ============
CREATE OR REPLACE FUNCTION public.get_invite_preview(_token text)
RETURNS TABLE(
  group_id uuid,
  group_name text,
  avatar_url text,
  is_public boolean,
  member_count integer,
  valid boolean,
  reason text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_inv public.chat_group_invites;
  v_group public.chat_groups;
  v_count integer;
  v_valid boolean := true;
  v_reason text := 'ok';
BEGIN
  SELECT * INTO v_inv FROM public.chat_group_invites WHERE token = _token;
  IF NOT FOUND THEN
    RETURN QUERY SELECT NULL::uuid, NULL::text, NULL::text, NULL::boolean, 0, false, 'not_found';
    RETURN;
  END IF;
  SELECT * INTO v_group FROM public.chat_groups WHERE id = v_inv.group_id;
  IF NOT FOUND OR v_group.deleted_at IS NOT NULL THEN
    RETURN QUERY SELECT v_inv.group_id, NULL::text, NULL::text, NULL::boolean, 0, false, 'group_deleted';
    RETURN;
  END IF;
  IF v_inv.revoked_at IS NOT NULL THEN
    v_valid := false; v_reason := 'revoked';
  ELSIF v_inv.expires_at IS NOT NULL AND v_inv.expires_at < now() THEN
    v_valid := false; v_reason := 'expired';
  ELSIF v_inv.max_uses IS NOT NULL AND v_inv.uses >= v_inv.max_uses THEN
    v_valid := false; v_reason := 'exhausted';
  END IF;
  SELECT count(*)::int INTO v_count FROM public.chat_group_members WHERE chat_group_members.group_id = v_inv.group_id;
  RETURN QUERY SELECT v_group.id, v_group.name, v_group.avatar_url, v_group.is_public, v_count, v_valid, v_reason;
END $$;

GRANT EXECUTE ON FUNCTION public.get_invite_preview(text) TO anon, authenticated;

-- ============ RPC: accept invite ============
CREATE OR REPLACE FUNCTION public.accept_group_invite(_token text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_inv public.chat_group_invites;
  v_group public.chat_groups;
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Bạn cần đăng nhập' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_inv FROM public.chat_group_invites WHERE token = _token FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Link mời không hợp lệ'; END IF;
  IF v_inv.revoked_at IS NOT NULL THEN RAISE EXCEPTION 'Link mời đã bị thu hồi'; END IF;
  IF v_inv.expires_at IS NOT NULL AND v_inv.expires_at < now() THEN RAISE EXCEPTION 'Link mời đã hết hạn'; END IF;
  IF v_inv.max_uses IS NOT NULL AND v_inv.uses >= v_inv.max_uses THEN RAISE EXCEPTION 'Link mời đã hết lượt sử dụng'; END IF;

  SELECT * INTO v_group FROM public.chat_groups WHERE id = v_inv.group_id;
  IF NOT FOUND OR v_group.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'Nhóm không còn tồn tại'; END IF;

  INSERT INTO public.chat_group_members (group_id, user_id)
  VALUES (v_inv.group_id, v_uid)
  ON CONFLICT DO NOTHING;

  UPDATE public.chat_group_invites SET uses = uses + 1 WHERE id = v_inv.id;
  RETURN v_inv.group_id;
END $$;

GRANT EXECUTE ON FUNCTION public.accept_group_invite(text) TO authenticated;

-- ============ Realtime for invites ============
ALTER TABLE public.chat_group_invites REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_group_invites;
