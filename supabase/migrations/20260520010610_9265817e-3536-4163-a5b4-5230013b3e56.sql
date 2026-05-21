
ALTER TABLE public.matches
  ADD COLUMN IF NOT EXISTS winner_team_id uuid,
  ADD COLUMN IF NOT EXISTS home_penalties integer,
  ADD COLUMN IF NOT EXISTS away_penalties integer;
