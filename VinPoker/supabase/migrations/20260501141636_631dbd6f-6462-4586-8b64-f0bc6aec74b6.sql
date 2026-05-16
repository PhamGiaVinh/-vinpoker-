CREATE OR REPLACE FUNCTION public.guard_purchase_self_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Service role / edge function context (no auth.uid) bypasses guard
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;
  IF public.has_role(auth.uid(), 'super_admin') THEN
    RETURN NEW;
  END IF;
  IF NEW.backer_id <> OLD.backer_id THEN
    RAISE EXCEPTION 'Cannot change backer_id';
  END IF;
  IF NEW.deal_id <> OLD.deal_id THEN
    RAISE EXCEPTION 'Cannot change deal_id';
  END IF;
  IF NEW.percent <> OLD.percent OR NEW.amount_vnd <> OLD.amount_vnd OR NEW.markup <> OLD.markup THEN
    RAISE EXCEPTION 'Cannot change financial fields';
  END IF;
  IF NEW.reference_code <> OLD.reference_code THEN
    RAISE EXCEPTION 'Cannot change reference_code';
  END IF;
  IF NEW.status <> OLD.status THEN
    IF NOT (OLD.status = 'committed' AND NEW.status = 'cancelled') THEN
      RAISE EXCEPTION 'Backer can only cancel a committed purchase';
    END IF;
    NEW.cancelled_at := now();
    IF NEW.cancellation_reason IS NULL THEN
      NEW.cancellation_reason := 'backer_cancelled';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;