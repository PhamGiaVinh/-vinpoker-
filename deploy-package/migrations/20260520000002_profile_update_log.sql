-- Migration: Profile Update Log
-- Creates table, trigger, and RLS for tracking profile changes

-- 1. Add profile_updated to notification_type enum
ALTER TYPE public.notification_type ADD VALUE IF NOT EXISTS 'profile_updated';

-- 2. Create profile_update_log table
CREATE TABLE IF NOT EXISTS public.profile_update_log (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  club_id UUID REFERENCES public.clubs(id) ON DELETE SET NULL,
  changed_fields TEXT[] NOT NULL DEFAULT '{}',
  old_values JSONB NOT NULL DEFAULT '{}',
  new_values JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_profile_update_log_user
  ON public.profile_update_log(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_profile_update_log_club
  ON public.profile_update_log(club_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_profile_update_log_created
  ON public.profile_update_log(created_at DESC);

-- 3. Enable RLS
ALTER TABLE public.profile_update_log ENABLE ROW LEVEL SECURITY;

-- 4. RLS policies
-- Super admin can see all
CREATE POLICY "Super admins can view all profile update logs"
  ON public.profile_update_log FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'super_admin'::public.app_role));

-- Club owner or cashier can see logs for their club
CREATE POLICY "Club staff can view their club's profile update logs"
  ON public.profile_update_log FOR SELECT
  TO authenticated
  USING (
    club_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.clubs c
      WHERE c.id = club_id
      AND (
        c.owner_id = auth.uid()
        OR EXISTS (
          SELECT 1 FROM public.club_cashiers cc
          WHERE cc.club_id = c.id AND cc.user_id = auth.uid()
        )
      )
    )
  );

-- 5. Trigger function
CREATE OR REPLACE FUNCTION public.fn_log_profile_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _changed_fields TEXT[] := '{}';
  _old_values JSONB := '{}';
  _new_values JSONB := '{}';
  _has_change BOOLEAN := false;
  _club_id UUID;
BEGIN
  -- Compare bank info
  IF OLD.bank_name IS DISTINCT FROM NEW.bank_name THEN
    _changed_fields := array_append(_changed_fields, 'bank_name');
    _old_values := jsonb_set(_old_values, '{bank_name}', to_jsonb(OLD.bank_name));
    _new_values := jsonb_set(_new_values, '{bank_name}', to_jsonb(NEW.bank_name));
    _has_change := true;
  END IF;

  IF OLD.bank_account_number IS DISTINCT FROM NEW.bank_account_number THEN
    _changed_fields := array_append(_changed_fields, 'bank_account_number');
    _old_values := jsonb_set(_old_values, '{bank_account_number}', to_jsonb(OLD.bank_account_number));
    _new_values := jsonb_set(_new_values, '{bank_account_number}', to_jsonb(NEW.bank_account_number));
    _has_change := true;
  END IF;

  IF OLD.bank_account_holder IS DISTINCT FROM NEW.bank_account_holder THEN
    _changed_fields := array_append(_changed_fields, 'bank_account_holder');
    _old_values := jsonb_set(_old_values, '{bank_account_holder}', to_jsonb(OLD.bank_account_holder));
    _new_values := jsonb_set(_new_values, '{bank_account_holder}', to_jsonb(NEW.bank_account_holder));
    _has_change := true;
  END IF;

  IF OLD.phone IS DISTINCT FROM NEW.phone THEN
    _changed_fields := array_append(_changed_fields, 'phone');
    _old_values := jsonb_set(_old_values, '{phone}', to_jsonb(OLD.phone));
    _new_values := jsonb_set(_new_values, '{phone}', to_jsonb(NEW.phone));
    _has_change := true;
  END IF;

  IF OLD.display_name IS DISTINCT FROM NEW.display_name THEN
    _changed_fields := array_append(_changed_fields, 'display_name');
    _old_values := jsonb_set(_old_values, '{display_name}', to_jsonb(OLD.display_name));
    _new_values := jsonb_set(_new_values, '{display_name}', to_jsonb(NEW.display_name));
    _has_change := true;
  END IF;

  IF OLD.bio IS DISTINCT FROM NEW.bio THEN
    _changed_fields := array_append(_changed_fields, 'bio');
    _old_values := jsonb_set(_old_values, '{bio}', to_jsonb(OLD.bio));
    _new_values := jsonb_set(_new_values, '{bio}', to_jsonb(NEW.bio));
    _has_change := true;
  END IF;

  IF OLD.avatar_url IS DISTINCT FROM NEW.avatar_url THEN
    _changed_fields := array_append(_changed_fields, 'avatar_url');
    _old_values := jsonb_set(_old_values, '{avatar_url}', to_jsonb(OLD.avatar_url));
    _new_values := jsonb_set(_new_values, '{avatar_url}', to_jsonb(NEW.avatar_url));
    _has_change := true;
  END IF;

  -- No changes to track
  IF NOT _has_change THEN
    RETURN NEW;
  END IF;

  -- Resolve club(s) from club_members and insert one row per club
  FOR _club_id IN
    SELECT DISTINCT cm.club_id FROM public.club_members cm WHERE cm.player_user_id = NEW.user_id
  LOOP
    INSERT INTO public.profile_update_log (user_id, club_id, changed_fields, old_values, new_values)
    VALUES (NEW.user_id, _club_id, _changed_fields, _old_values, _new_values);
  END LOOP;

  -- If no club membership found, insert with NULL club_id
  IF NOT FOUND THEN
    INSERT INTO public.profile_update_log (user_id, club_id, changed_fields, old_values, new_values)
    VALUES (NEW.user_id, NULL, _changed_fields, _old_values, _new_values);
  END IF;

  RETURN NEW;
END;
$$;

-- 6. Create trigger on profiles table
DROP TRIGGER IF EXISTS trg_log_profile_update ON public.profiles;
CREATE TRIGGER trg_log_profile_update
  AFTER UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_log_profile_update();
