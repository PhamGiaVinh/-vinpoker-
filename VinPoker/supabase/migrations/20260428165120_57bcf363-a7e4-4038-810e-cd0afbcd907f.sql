-- Strengthen UPDATE trigger: also catch the case looking_for_backing=true but status still 'off'
CREATE OR REPLACE FUNCTION public.trg_backing_status_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  is_admin boolean := public.has_role(auth.uid(), 'super_admin');
BEGIN
  IF is_admin AND NEW.backing_status IS DISTINCT FROM OLD.backing_status THEN
    IF NEW.backing_status IN ('approved','rejected') THEN
      NEW.backing_reviewed_at := now();
      NEW.backing_reviewed_by := auth.uid();
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.looking_for_backing = false AND NEW.looking_for_backing = true THEN
    NEW.backing_status := 'pending';
    NEW.backing_reviewed_at := NULL;
    NEW.backing_reviewed_by := NULL;
    NEW.backing_review_note := NULL;
    RETURN NEW;
  END IF;

  IF OLD.looking_for_backing = true AND NEW.looking_for_backing = false THEN
    NEW.backing_status := 'off';
    RETURN NEW;
  END IF;

  -- Safety net: if user is currently looking for backing but somehow status is 'off', promote to pending
  IF NEW.looking_for_backing = true AND NEW.backing_status = 'off' AND NOT is_admin THEN
    NEW.backing_status := 'pending';
    RETURN NEW;
  END IF;

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

  IF NOT is_admin AND NEW.backing_status IS DISTINCT FROM OLD.backing_status THEN
    NEW.backing_status := OLD.backing_status;
    NEW.backing_reviewed_at := OLD.backing_reviewed_at;
    NEW.backing_reviewed_by := OLD.backing_reviewed_by;
    NEW.backing_review_note := OLD.backing_review_note;
  END IF;

  RETURN NEW;
END;
$$;

-- Backfill records that are currently looking for backing but stuck at 'off'
UPDATE public.player_stats
SET backing_status = 'pending'
WHERE looking_for_backing = true AND backing_status = 'off';