-- Tournament Packages (Early Bird) + Multi-Currency Rates

-- 1. Package status enum
DO $$ BEGIN
  CREATE TYPE public.package_status AS ENUM ('active', 'sold_out', 'expired', 'draft');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2. Tournament packages table
CREATE TABLE IF NOT EXISTS public.tournament_packages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE,
  description TEXT NOT NULL,
  hero_image_url TEXT,
  original_price NUMERIC(12,0) NOT NULL,
  package_price NUMERIC(12,0) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'VND',
  max_slots INTEGER NOT NULL DEFAULT 10,
  slots_remaining INTEGER NOT NULL DEFAULT 10,
  start_date TIMESTAMPTZ NOT NULL,
  end_date TIMESTAMPTZ NOT NULL,
  location TEXT,
  benefits JSONB NOT NULL DEFAULT '[]'::jsonb,
  status public.package_status NOT NULL DEFAULT 'active',
  is_featured BOOLEAN NOT NULL DEFAULT false,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT positive_price CHECK (package_price > 0),
  CONSTRAINT savings_check CHECK (original_price >= package_price),
  CONSTRAINT slots_check CHECK (slots_remaining >= 0 AND slots_remaining <= max_slots)
);

-- 3. Package-tournament junction table
CREATE TABLE IF NOT EXISTS public.package_tournaments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id UUID NOT NULL REFERENCES public.tournament_packages(id) ON DELETE CASCADE,
  tournament_id UUID NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(package_id, tournament_id)
);

-- 4. RLS
ALTER TABLE public.tournament_packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.package_tournaments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "packages_read_all" ON public.tournament_packages;
CREATE POLICY "packages_read_all" ON public.tournament_packages
  FOR SELECT USING (status IN ('active', 'sold_out'));
DROP POLICY IF EXISTS "packages_write_admin" ON public.tournament_packages;
CREATE POLICY "packages_write_admin" ON public.tournament_packages
  FOR ALL USING (auth.uid() IN (SELECT user_id FROM public.user_roles WHERE role = 'super_admin'));

DROP POLICY IF EXISTS "pt_read_all" ON public.package_tournaments;
CREATE POLICY "pt_read_all" ON public.package_tournaments
  FOR SELECT USING (true);
DROP POLICY IF EXISTS "pt_write_admin" ON public.package_tournaments;
CREATE POLICY "pt_write_admin" ON public.package_tournaments
  FOR ALL USING (auth.uid() IN (SELECT user_id FROM public.user_roles WHERE role = 'super_admin'));

-- 5. Seed sample packages
INSERT INTO public.tournament_packages (name, slug, description, hero_image_url, original_price, package_price, max_slots, slots_remaining, start_date, end_date, location, benefits, status, sort_order)
VALUES
  (
    'SUMMER PACKAGE 2026',
    'summer-package-2026',
    'Trọn gói 3 giải đấu hấp dẫn nhất mùa hè với mức giá ưu đãi đặc biệt. Cơ hội tranh tài tại các sự kiện poker lớn nhất Việt Nam.',
    'https://images.unsplash.com/photo-1528323273322-d81442ced56c?w=1200',
    15000000, 9900000, 20, 14,
    NOW() + INTERVAL '7 days', NOW() + INTERVAL '30 days',
    'Hồ Chí Minh, Việt Nam',
    '[{"icon": "hotel", "title": "Khách sạn 3 sao", "desc": "2 đêm nghỉ dưỡng tại khách sạn đạt chuẩn"}, {"icon": "flight", "title": "Vé máy bay", "desc": "Khứ hồi nội địa cho người chơi"}, {"icon": "restaurant", "title": "Ăn uống", "desc": "Buffet tối khai mạc + tiệc trao giải"}, {"icon": "spa", "title": "Spa & Wellness", "desc": "Phiếu massage thư giãn trị giá 500K"}]',
    'active', 1
  ),
  (
    'MAIN EVENT PACKAGE',
    'main-event-package',
    'Gói đặc quyền dành cho Main Event với các quyền lợi VIP. Tham gia giải đấu chính và tận hưởng trải nghiệm đẳng cấp.',
    'https://images.unsplash.com/photo-1607453998774-d533f65dac99?w=1200',
    20000000, 14900000, 10, 3,
    NOW() + INTERVAL '14 days', NOW() + INTERVAL '45 days',
    'Đà Nẵng, Việt Nam',
    '[{"icon": "hotel", "title": "Khách sạn 5 sao", "desc": "3 đêm nghỉ tại resort cao cấp"}, {"icon": "airport_shuttle", "title": "Đưa đón sân bay", "desc": "Xe đưa đón riêng từ sân bay"}, {"icon": "restaurant", "title": "Full-board", "desc": "Ăn sáng, trưa, tối trong suốt giải"}, {"icon": "card_membership", "title": "VIP Lounge", "desc": "Tiếp cận phòng chờ VIP riêng"}]',
    'active', 2
  ),
  (
    'SATELLITE PACKAGE 2026',
    'satellite-package-2026',
    'Gói vệ tinh dành cho người chơi muốn tham gia các giải đấu vòng loại',
    'https://images.unsplash.com/photo-1528323273322-d81442ced56c?w=1200',
    5000000, 3500000, 30, 0,
    NOW() + INTERVAL '2 days', NOW() + INTERVAL '10 days',
    'Hà Nội, Việt Nam',
    '[{"icon": "card_giftcard", "title": "Entry Fee", "desc": "Phí tham gia 3 giải vệ tinh"}, {"icon": "school", "title": "Workshop", "desc": "1 buổi training với pro player"}]',
    'sold_out', 3
  );

-- 6. Seed default exchange rates (admin-configurable)
INSERT INTO public.app_settings (key, value, updated_at)
VALUES (
  'currency_rates',
  '{
    "base_currency": "VND",
    "rates": {
      "VND": 1,
      "CNY": 3420,
      "USD": 25480,
      "KRW": 18.5
    },
    "symbols": {
      "VND": "₫",
      "CNY": "¥",
      "USD": "$",
      "KRW": "₩"
    }
  }'::jsonb,
  NOW()
)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();
