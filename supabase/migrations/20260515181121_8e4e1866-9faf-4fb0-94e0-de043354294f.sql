
-- Roles
CREATE TYPE public.app_role AS ENUM ('admin', 'user');

CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  role app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role app_role)
RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role) $$;

CREATE POLICY "Users see own roles" ON public.user_roles FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Admins see all roles" ON public.user_roles FOR SELECT USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins manage roles" ON public.user_roles FOR ALL USING (public.has_role(auth.uid(), 'admin'));

-- Profiles
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Profiles readable by authenticated" ON public.profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY "Users update own profile" ON public.profiles FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "Users insert own profile" ON public.profiles FOR INSERT WITH CHECK (auth.uid() = id);

-- Auto-create profile + default user role on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1)));
  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'user');
  RETURN NEW;
END; $$;

CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Teams
CREATE TABLE public.teams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id TEXT UNIQUE,
  name TEXT NOT NULL,
  code TEXT NOT NULL,
  flag_url TEXT,
  group_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.teams ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Teams readable by authenticated" ON public.teams FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins manage teams" ON public.teams FOR ALL USING (public.has_role(auth.uid(), 'admin'));

-- Matches
CREATE TYPE public.match_stage AS ENUM ('group','round_of_32','round_of_16','quarter','semi','third_place','final');
CREATE TYPE public.match_status AS ENUM ('scheduled','live','finished','postponed','cancelled');

CREATE TABLE public.matches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id TEXT UNIQUE,
  stage match_stage NOT NULL DEFAULT 'group',
  group_name TEXT,
  home_team_id UUID REFERENCES public.teams(id) ON DELETE SET NULL,
  away_team_id UUID REFERENCES public.teams(id) ON DELETE SET NULL,
  kickoff_at TIMESTAMPTZ NOT NULL,
  home_score INT,
  away_score INT,
  status match_status NOT NULL DEFAULT 'scheduled',
  venue TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.matches ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Matches readable by authenticated" ON public.matches FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins manage matches" ON public.matches FOR ALL USING (public.has_role(auth.uid(), 'admin'));
CREATE INDEX idx_matches_kickoff ON public.matches(kickoff_at);

-- Pools
CREATE TABLE public.pools (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  owner_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  invite_code TEXT NOT NULL UNIQUE DEFAULT upper(substring(md5(random()::text || clock_timestamp()::text) from 1 for 8)),
  scoring_exact INT NOT NULL DEFAULT 10,
  scoring_diff INT NOT NULL DEFAULT 7,
  scoring_winner INT NOT NULL DEFAULT 5,
  bonus_round_of_16 INT NOT NULL DEFAULT 5,
  bonus_quarter INT NOT NULL DEFAULT 10,
  bonus_semi INT NOT NULL DEFAULT 15,
  bonus_final INT NOT NULL DEFAULT 20,
  bonus_champion INT NOT NULL DEFAULT 30,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.pools ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.pool_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pool_id UUID REFERENCES public.pools(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (pool_id, user_id)
);
ALTER TABLE public.pool_members ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.is_pool_member(_pool_id UUID, _user_id UUID)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS(SELECT 1 FROM public.pool_members WHERE pool_id = _pool_id AND user_id = _user_id)
$$;

CREATE POLICY "Members see their pools" ON public.pools FOR SELECT TO authenticated
  USING (public.is_pool_member(id, auth.uid()) OR owner_id = auth.uid());
CREATE POLICY "Anyone authenticated can create pool" ON public.pools FOR INSERT TO authenticated WITH CHECK (auth.uid() = owner_id);
CREATE POLICY "Owner updates pool" ON public.pools FOR UPDATE USING (auth.uid() = owner_id);
CREATE POLICY "Owner deletes pool" ON public.pools FOR DELETE USING (auth.uid() = owner_id);

CREATE POLICY "Members see pool members" ON public.pool_members FOR SELECT TO authenticated
  USING (public.is_pool_member(pool_id, auth.uid()));
CREATE POLICY "User joins pool" ON public.pool_members FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "User leaves pool" ON public.pool_members FOR DELETE USING (auth.uid() = user_id);

-- Auto-add owner as member
CREATE OR REPLACE FUNCTION public.handle_new_pool()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.pool_members (pool_id, user_id) VALUES (NEW.id, NEW.owner_id);
  RETURN NEW;
END; $$;
CREATE TRIGGER on_pool_created AFTER INSERT ON public.pools
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_pool();

-- Predictions (per match, per user — pool-agnostic so a single palpite counts in all bolões)
CREATE TABLE public.predictions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  match_id UUID REFERENCES public.matches(id) ON DELETE CASCADE NOT NULL,
  home_score INT NOT NULL CHECK (home_score >= 0),
  away_score INT NOT NULL CHECK (away_score >= 0),
  points INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, match_id)
);
ALTER TABLE public.predictions ENABLE ROW LEVEL SECURITY;

-- Lock predictions after kickoff via trigger
CREATE OR REPLACE FUNCTION public.enforce_prediction_lock()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _kickoff TIMESTAMPTZ;
BEGIN
  SELECT kickoff_at INTO _kickoff FROM public.matches WHERE id = NEW.match_id;
  IF _kickoff IS NULL THEN RAISE EXCEPTION 'Jogo não encontrado'; END IF;
  -- Allow scoring updates by service role (no auth.uid())
  IF auth.uid() IS NOT NULL AND _kickoff <= now() THEN
    RAISE EXCEPTION 'Palpites bloqueados: o jogo já começou';
  END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER lock_predictions_insert BEFORE INSERT ON public.predictions
  FOR EACH ROW EXECUTE FUNCTION public.enforce_prediction_lock();
CREATE TRIGGER lock_predictions_update BEFORE UPDATE OF home_score, away_score ON public.predictions
  FOR EACH ROW EXECUTE FUNCTION public.enforce_prediction_lock();

CREATE POLICY "Users see own predictions" ON public.predictions FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Members see pool predictions after kickoff" ON public.predictions FOR SELECT TO authenticated USING (
  EXISTS (
    SELECT 1 FROM public.matches m
    WHERE m.id = predictions.match_id AND m.kickoff_at <= now()
  )
);
CREATE POLICY "Users insert own predictions" ON public.predictions FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own predictions" ON public.predictions FOR UPDATE USING (auth.uid() = user_id);

-- Bracket predictions
CREATE TABLE public.bracket_predictions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  pool_id UUID REFERENCES public.pools(id) ON DELETE CASCADE NOT NULL,
  stage match_stage NOT NULL,
  slot INT NOT NULL,
  team_id UUID REFERENCES public.teams(id) ON DELETE SET NULL,
  points INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, pool_id, stage, slot)
);
ALTER TABLE public.bracket_predictions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members see bracket of their pool" ON public.bracket_predictions FOR SELECT TO authenticated
  USING (public.is_pool_member(pool_id, auth.uid()));
CREATE POLICY "Users manage own bracket" ON public.bracket_predictions FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Champion predictions
CREATE TABLE public.champion_predictions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  pool_id UUID REFERENCES public.pools(id) ON DELETE CASCADE NOT NULL,
  team_id UUID REFERENCES public.teams(id) ON DELETE SET NULL NOT NULL,
  points INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, pool_id)
);
ALTER TABLE public.champion_predictions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members see champions of their pool" ON public.champion_predictions FOR SELECT TO authenticated
  USING (public.is_pool_member(pool_id, auth.uid()));
CREATE POLICY "Users manage own champion" ON public.champion_predictions FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Updated_at triggers
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE TRIGGER trg_profiles_updated BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_matches_updated BEFORE UPDATE ON public.matches FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_predictions_updated BEFORE UPDATE ON public.predictions FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_bracket_updated BEFORE UPDATE ON public.bracket_predictions FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_champion_updated BEFORE UPDATE ON public.champion_predictions FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
