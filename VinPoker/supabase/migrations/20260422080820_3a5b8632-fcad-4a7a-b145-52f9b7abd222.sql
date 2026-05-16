
-- Roles enum + table
CREATE TYPE public.app_role AS ENUM ('player', 'club_admin', 'super_admin');

CREATE TABLE public.user_roles (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$$;

CREATE POLICY "Users can view their own roles"
  ON public.user_roles FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Super admins can view all roles"
  ON public.user_roles FOR SELECT
  USING (public.has_role(auth.uid(), 'super_admin'));

CREATE POLICY "Super admins can manage roles"
  ON public.user_roles FOR ALL
  USING (public.has_role(auth.uid(), 'super_admin'))
  WITH CHECK (public.has_role(auth.uid(), 'super_admin'));

-- Profiles
CREATE TABLE public.profiles (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT,
  phone TEXT,
  region TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Profiles viewable by everyone"
  ON public.profiles FOR SELECT
  USING (true);

CREATE POLICY "Users can insert their own profile"
  ON public.profiles FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own profile"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = user_id);

-- Generic timestamp trigger
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER update_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Auto-create profile + default role on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (user_id, display_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1)));

  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'player');
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Clubs
CREATE TYPE public.club_status AS ENUM ('pending', 'approved', 'rejected');

CREATE TABLE public.clubs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  owner_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  description TEXT,
  address TEXT,
  region TEXT NOT NULL,
  rating NUMERIC(3,2) NOT NULL DEFAULT 0,
  cover_url TEXT,
  schedule TEXT,
  status public.club_status NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.clubs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Approved clubs viewable by everyone"
  ON public.clubs FOR SELECT
  USING (status = 'approved' OR owner_id = auth.uid() OR public.has_role(auth.uid(), 'super_admin'));

CREATE POLICY "Authenticated users can create clubs"
  ON public.clubs FOR INSERT
  WITH CHECK (auth.uid() = owner_id);

CREATE POLICY "Owners can update their club"
  ON public.clubs FOR UPDATE
  USING (auth.uid() = owner_id OR public.has_role(auth.uid(), 'super_admin'));

CREATE POLICY "Super admins can delete clubs"
  ON public.clubs FOR DELETE
  USING (public.has_role(auth.uid(), 'super_admin'));

CREATE TRIGGER update_clubs_updated_at
  BEFORE UPDATE ON public.clubs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Tournaments
CREATE TYPE public.tournament_status AS ENUM ('scheduled', 'live', 'finished', 'cancelled');

CREATE TABLE public.tournaments (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  club_id UUID NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  start_time TIMESTAMPTZ NOT NULL,
  buy_in INTEGER NOT NULL,
  starting_stack INTEGER NOT NULL,
  location TEXT,
  status public.tournament_status NOT NULL DEFAULT 'scheduled',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.tournaments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tournaments viewable for approved clubs"
  ON public.tournaments FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM public.clubs c WHERE c.id = club_id AND c.status = 'approved')
    OR EXISTS (SELECT 1 FROM public.clubs c WHERE c.id = club_id AND c.owner_id = auth.uid())
    OR public.has_role(auth.uid(), 'super_admin')
  );

CREATE POLICY "Club owners can insert tournaments"
  ON public.tournaments FOR INSERT
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.clubs c WHERE c.id = club_id AND c.owner_id = auth.uid())
    OR public.has_role(auth.uid(), 'super_admin')
  );

CREATE POLICY "Club owners can update tournaments"
  ON public.tournaments FOR UPDATE
  USING (
    EXISTS (SELECT 1 FROM public.clubs c WHERE c.id = club_id AND c.owner_id = auth.uid())
    OR public.has_role(auth.uid(), 'super_admin')
  );

CREATE POLICY "Club owners can delete tournaments"
  ON public.tournaments FOR DELETE
  USING (
    EXISTS (SELECT 1 FROM public.clubs c WHERE c.id = club_id AND c.owner_id = auth.uid())
    OR public.has_role(auth.uid(), 'super_admin')
  );

CREATE TRIGGER update_tournaments_updated_at
  BEFORE UPDATE ON public.tournaments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_tournaments_start_time ON public.tournaments(start_time);
CREATE INDEX idx_tournaments_club ON public.tournaments(club_id);

-- Stack registrations
CREATE TYPE public.registration_status AS ENUM ('pending', 'confirmed', 'rejected', 'cancelled');

CREATE TABLE public.stack_registrations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tournament_id UUID NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
  status public.registration_status NOT NULL DEFAULT 'pending',
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, tournament_id)
);

ALTER TABLE public.stack_registrations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Players see their own registrations"
  ON public.stack_registrations FOR SELECT
  USING (
    auth.uid() = user_id
    OR EXISTS (
      SELECT 1 FROM public.tournaments t
      JOIN public.clubs c ON c.id = t.club_id
      WHERE t.id = tournament_id AND c.owner_id = auth.uid()
    )
    OR public.has_role(auth.uid(), 'super_admin')
  );

CREATE POLICY "Players insert their own registrations"
  ON public.stack_registrations FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Player cancel or club admin update"
  ON public.stack_registrations FOR UPDATE
  USING (
    auth.uid() = user_id
    OR EXISTS (
      SELECT 1 FROM public.tournaments t
      JOIN public.clubs c ON c.id = t.club_id
      WHERE t.id = tournament_id AND c.owner_id = auth.uid()
    )
    OR public.has_role(auth.uid(), 'super_admin')
  );

CREATE POLICY "Players or admins can delete registrations"
  ON public.stack_registrations FOR DELETE
  USING (
    auth.uid() = user_id
    OR public.has_role(auth.uid(), 'super_admin')
  );

CREATE TRIGGER update_stack_registrations_updated_at
  BEFORE UPDATE ON public.stack_registrations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_registrations_tournament ON public.stack_registrations(tournament_id);
CREATE INDEX idx_registrations_user ON public.stack_registrations(user_id);

-- Seed sample data
INSERT INTO public.clubs (id, name, description, address, region, rating, status, schedule)
VALUES
  ('11111111-1111-1111-1111-111111111111', 'Saigon Poker Club', 'CLB poker hàng đầu Sài Gòn với không gian sang trọng.', '123 Nguyễn Huệ, Q.1', 'TP.HCM', 4.8, 'approved', 'Mở cửa 14:00 - 02:00 hàng ngày'),
  ('22222222-2222-2222-2222-222222222222', 'Hanoi Royal Poker', 'Sảnh thi đấu chuẩn quốc tế tại trung tâm Hà Nội.', '45 Lý Thường Kiệt, Hoàn Kiếm', 'Hà Nội', 4.6, 'approved', 'Mở cửa 15:00 - 01:00'),
  ('33333333-3333-3333-3333-333333333333', 'Da Nang Pearl Poker', 'CLB ven biển, bàn cash & tournament hằng tuần.', '88 Bạch Đằng', 'Đà Nẵng', 4.4, 'approved', 'Mở cửa 16:00 - 24:00');

INSERT INTO public.tournaments (club_id, name, start_time, buy_in, starting_stack, location, description)
VALUES
  ('11111111-1111-1111-1111-111111111111', 'SPC Daily Deepstack', now() + interval '1 day', 1500000, 30000, 'Hall A', 'Daily tournament, late reg 4 levels.'),
  ('11111111-1111-1111-1111-111111111111', 'SPC Weekend Main Event', now() + interval '3 day', 5000000, 50000, 'Hall B', 'Giải chính cuối tuần.'),
  ('22222222-2222-2222-2222-222222222222', 'Hanoi Royal Bounty', now() + interval '2 day', 2000000, 25000, 'Main Floor', 'Bounty 500K mỗi đầu.'),
  ('33333333-3333-3333-3333-333333333333', 'Pearl Sunday Special', now() + interval '4 day', 3000000, 40000, 'VIP Room', 'Giải đặc biệt chủ nhật.');
