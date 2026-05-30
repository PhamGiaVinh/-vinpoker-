-- ============ TABLES ============
CREATE TABLE public.chat_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 2 AND 60),
  avatar_url text,
  created_by uuid NOT NULL,
  is_public boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE INDEX idx_chat_groups_public ON public.chat_groups(is_public) WHERE deleted_at IS NULL;
CREATE INDEX idx_chat_groups_updated ON public.chat_groups(updated_at DESC) WHERE deleted_at IS NULL;

CREATE TABLE public.chat_group_members (
  group_id uuid NOT NULL REFERENCES public.chat_groups(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  joined_at timestamptz NOT NULL DEFAULT now(),
  last_read_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, user_id)
);
CREATE INDEX idx_cgm_user ON public.chat_group_members(user_id);

CREATE TABLE public.chat_group_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES public.chat_groups(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL,
  content text NOT NULL CHECK (length(btrim(content)) BETWEEN 1 AND 2000),
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE INDEX idx_cgmsg_group_time ON public.chat_group_messages(group_id, created_at DESC);

-- ============ HELPERS ============
CREATE OR REPLACE FUNCTION public.is_group_member(_user_id uuid, _group_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.chat_group_members
    WHERE group_id = _group_id AND user_id = _user_id
  )
$$;

CREATE OR REPLACE FUNCTION public.is_group_creator(_user_id uuid, _group_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.chat_groups
    WHERE id = _group_id AND created_by = _user_id AND deleted_at IS NULL
  )
$$;

-- ============ TRIGGERS ============
CREATE OR REPLACE FUNCTION public.trg_chat_group_add_creator()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.chat_group_members (group_id, user_id)
  VALUES (NEW.id, NEW.created_by)
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END $$;

CREATE TRIGGER chat_group_add_creator
AFTER INSERT ON public.chat_groups
FOR EACH ROW EXECUTE FUNCTION public.trg_chat_group_add_creator();

CREATE OR REPLACE FUNCTION public.trg_chat_group_bump()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.chat_groups SET updated_at = now() WHERE id = NEW.group_id;
  RETURN NEW;
END $$;

CREATE TRIGGER chat_group_bump_on_msg
AFTER INSERT ON public.chat_group_messages
FOR EACH ROW EXECUTE FUNCTION public.trg_chat_group_bump();

CREATE OR REPLACE FUNCTION public.trg_chat_group_soft_delete()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL THEN
    UPDATE public.chat_group_messages
       SET deleted_at = now()
     WHERE group_id = NEW.id AND deleted_at IS NULL;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER chat_group_soft_delete_cascade
AFTER UPDATE ON public.chat_groups
FOR EACH ROW EXECUTE FUNCTION public.trg_chat_group_soft_delete();

-- ============ RLS ============
ALTER TABLE public.chat_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_group_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_group_messages ENABLE ROW LEVEL SECURITY;

-- chat_groups
CREATE POLICY "View public or member groups"
ON public.chat_groups FOR SELECT TO authenticated
USING (
  deleted_at IS NULL
  AND (is_public = true OR public.is_group_member(auth.uid(), id))
);

CREATE POLICY "Authenticated can create groups"
ON public.chat_groups FOR INSERT TO authenticated
WITH CHECK (created_by = auth.uid());

CREATE POLICY "Creator can update group"
ON public.chat_groups FOR UPDATE TO authenticated
USING (created_by = auth.uid())
WITH CHECK (created_by = auth.uid());

CREATE POLICY "Creator can delete group"
ON public.chat_groups FOR DELETE TO authenticated
USING (created_by = auth.uid());

-- chat_group_members
CREATE POLICY "Members view membership of their groups"
ON public.chat_group_members FOR SELECT TO authenticated
USING (public.is_group_member(auth.uid(), group_id));

CREATE POLICY "Self-join public group or creator add"
ON public.chat_group_members FOR INSERT TO authenticated
WITH CHECK (
  (user_id = auth.uid() AND EXISTS (
    SELECT 1 FROM public.chat_groups g
    WHERE g.id = group_id AND g.deleted_at IS NULL AND g.is_public = true
  ))
  OR public.is_group_creator(auth.uid(), group_id)
);

CREATE POLICY "Self update last_read"
ON public.chat_group_members FOR UPDATE TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

CREATE POLICY "Self leave or creator kick"
ON public.chat_group_members FOR DELETE TO authenticated
USING (user_id = auth.uid() OR public.is_group_creator(auth.uid(), group_id));

-- chat_group_messages
CREATE POLICY "Members read messages"
ON public.chat_group_messages FOR SELECT TO authenticated
USING (public.is_group_member(auth.uid(), group_id));

CREATE POLICY "Members send messages"
ON public.chat_group_messages FOR INSERT TO authenticated
WITH CHECK (
  sender_id = auth.uid()
  AND public.is_group_member(auth.uid(), group_id)
);

CREATE POLICY "Sender or creator soft-delete"
ON public.chat_group_messages FOR UPDATE TO authenticated
USING (sender_id = auth.uid() OR public.is_group_creator(auth.uid(), group_id))
WITH CHECK (sender_id = auth.uid() OR public.is_group_creator(auth.uid(), group_id));

-- ============ REALTIME ============
ALTER TABLE public.chat_group_messages REPLICA IDENTITY FULL;
ALTER TABLE public.chat_group_members REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_group_messages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_group_members;
ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_groups;