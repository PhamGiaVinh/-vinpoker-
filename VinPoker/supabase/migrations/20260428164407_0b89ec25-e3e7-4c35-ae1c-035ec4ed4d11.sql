-- 1. Enum
CREATE TYPE public.backing_review_status AS ENUM ('off','pending','approved','rejected');

-- 2. New columns
ALTER TABLE public.player_stats
  ADD COLUMN backing_status public.backing_review_status NOT NULL DEFAULT 'off',
  ADD COLUMN backing_reviewed_at timestamptz,
  ADD COLUMN backing_reviewed_by uuid,
  ADD COLUMN backing_review_note text;

-- 3. Trigger function: auto-manage backing_status when player toggles or edits content
CREATE OR REPLACE FUNCTION public.trg_backing_status_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  is_admin boolean := public.has_role(auth.uid(), 'super_admin');
BEGIN
  -- Super admin can set any backing_status freely
  IF is_admin AND NEW.backing_status IS DISTINCT FROM OLD.backing_status THEN
    -- accept the explicit change, also stamp reviewer if approving/rejecting
    IF NEW.backing_status IN ('approved','rejected') THEN
      NEW.backing_reviewed_at := now();
      NEW.backing_reviewed_by := auth.uid();
    END IF;
    RETURN NEW;
  END IF;

  -- Player toggled looking_for_backing OFF -> ON
  IF OLD.looking_for_backing = false AND NEW.looking_for_backing = true THEN
    NEW.backing_status := 'pending';
    NEW.backing_reviewed_at := NULL;
    NEW.backing_reviewed_by := NULL;
    NEW.backing_review_note := NULL;
    RETURN NEW;
  END IF;

  -- Player toggled looking_for_backing ON -> OFF
  IF OLD.looking_for_backing = true AND NEW.looking_for_backing = false THEN
    NEW.backing_status := 'off';
    RETURN NEW;
  END IF;

  -- Player edited content while approved -> reset to pending
  IF NEW.looking_for_backing = true
     AND OLD.backing_status = 'approved'
     AND (
       COALESCE(NEW.backing_description,'') IS DISTINCT FROM COALESCE(OLD.backing_description,'')
       OR COALESCE(NEW.backing_percentage_available, -1) IS DISTINCT FROM COALESCE(OLD.backing_percentage_available, -1)
     ) THEN
    NEW.backing_status := 'pending';
    NEW.backing_reviewed_at := NULL;
    NEW.backing_reviewed_by := NULL;
    NEW.backing_review_note := NULL;
    RETURN NEW;
  END IF;

  -- Prevent non-admin from changing backing_status directly
  IF NOT is_admin AND NEW.backing_status IS DISTINCT FROM OLD.backing_status THEN
    NEW.backing_status := OLD.backing_status;
    NEW.backing_reviewed_at := OLD.backing_reviewed_at;
    NEW.backing_reviewed_by := OLD.backing_reviewed_by;
    NEW.backing_review_note := OLD.backing_review_note;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_player_stats_backing_guard
BEFORE UPDATE ON public.player_stats
FOR EACH ROW EXECUTE FUNCTION public.trg_backing_status_guard();

-- 4. Trigger on INSERT: if user inserts looking_for_backing=true, mark pending
CREATE OR REPLACE FUNCTION public.trg_backing_status_insert_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.looking_for_backing = true AND NEW.backing_status = 'off' THEN
    NEW.backing_status := 'pending';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_player_stats_backing_insert_guard
BEFORE INSERT ON public.player_stats
FOR EACH ROW EXECUTE FUNCTION public.trg_backing_status_insert_guard();

-- 5. Backfill existing records currently looking for backing -> pending review
UPDATE public.player_stats
SET backing_status = 'pending'
WHERE looking_for_backing = true AND backing_status = 'off';

-- 6. Index for admin queue
CREATE INDEX IF NOT EXISTS idx_player_stats_backing_status ON public.player_stats(backing_status);