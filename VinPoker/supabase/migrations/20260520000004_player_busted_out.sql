-- Player Busted Out + Package Purchases + migration fixes

-- ====================================================================
-- 1. Add club_id to tournament_packages (was missing from 00001)
-- ====================================================================
ALTER TABLE public.tournament_packages
  ADD COLUMN IF NOT EXISTS club_id UUID REFERENCES public.clubs(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_tournament_packages_club ON public.tournament_packages(club_id);

-- ====================================================================
-- 2. Add purchase_limit_per_user to tournament_packages
-- ====================================================================
ALTER TABLE public.tournament_packages
  ADD COLUMN IF NOT EXISTS purchase_limit_per_user INTEGER NOT NULL DEFAULT 1;

-- ====================================================================
-- 3. Package Purchases table (tracks actual buys by users)
-- ====================================================================
CREATE TABLE IF NOT EXISTS public.package_purchases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id UUID NOT NULL REFERENCES public.tournament_packages(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(user_id) ON DELETE CASCADE,
  amount NUMERIC(12,0) NOT NULL CHECK (amount > 0),
  currency TEXT NOT NULL DEFAULT 'VND',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'cancelled', 'refunded')),
  paid_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(package_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_package_purchases_user ON public.package_purchases(user_id);
CREATE INDEX IF NOT EXISTS idx_package_purchases_package ON public.package_purchases(package_id);

-- RLS
ALTER TABLE public.package_purchases ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pp_read_own" ON public.package_purchases
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "pp_read_admin" ON public.package_purchases
  FOR SELECT USING (auth.uid() IN (SELECT user_id FROM public.user_roles WHERE role = 'super_admin'));
CREATE POLICY "pp_insert_own" ON public.package_purchases
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- ====================================================================
-- 4. Player busted-out columns on staking_deals
-- ====================================================================
ALTER TABLE public.staking_deals
  ADD COLUMN IF NOT EXISTS player_busted_out BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS player_busted_out_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_staking_deals_busted ON public.staking_deals(player_busted_out)
  WHERE player_busted_out = true;

-- ====================================================================
-- 5. Add notification_type enum values
-- ====================================================================
DO $$ BEGIN
  ALTER TYPE public.notification_type ADD VALUE IF NOT EXISTS 'package_purchase_paid';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TYPE public.notification_type ADD VALUE IF NOT EXISTS 'player_busted_out';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TYPE public.notification_type ADD VALUE IF NOT EXISTS 'profile_updated';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ====================================================================
-- 6. Trigger: on player_busted_out=true → auto set early_closed + notify backers
-- ====================================================================
CREATE OR REPLACE FUNCTION public.fn_deal_busted_notify()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _event_name text;
  _player_name text;
  _backer RECORD;
BEGIN
  IF NEW.player_busted_out = OLD.player_busted_out THEN
    RETURN NEW;
  END IF;

  IF NOT NEW.player_busted_out THEN
    RETURN NEW;
  END IF;

  NEW.player_busted_out_at := NOW();
  NEW.early_closed := true;

  SELECT COALESCE(NEW.custom_event_name, 'Sự kiện không xác định') INTO _event_name;

  SELECT display_name INTO _player_name FROM public.profiles WHERE user_id = NEW.player_id;

  FOR _backer IN
    SELECT DISTINCT sp.backer_id
    FROM public.staking_purchases sp
    WHERE sp.deal_id = NEW.id AND sp.status = 'funded'
  LOOP
    INSERT INTO public.notifications (user_id, type, title, body, data)
    VALUES (
      _backer.backer_id,
      'player_busted_out'::public.notification_type,
      'Người chơi đã bị loại',
      'Người chơi ' || COALESCE(_player_name, 'không xác định') || ' đã bị loại khỏi giải ' || _event_name || '. Phiếu staking sẽ tự động đóng.',
      jsonb_build_object(
        'deal_id', NEW.id,
        'player_id', NEW.player_id,
        'event_name', _event_name
      )
    );
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_deal_busted_notify ON public.staking_deals;
CREATE TRIGGER trg_deal_busted_notify
  BEFORE UPDATE OF player_busted_out ON public.staking_deals
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_deal_busted_notify();
