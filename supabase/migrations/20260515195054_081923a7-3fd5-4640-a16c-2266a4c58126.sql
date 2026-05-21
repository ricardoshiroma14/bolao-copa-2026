-- New bracket "wrong slot" bonuses + third place stage
ALTER TABLE public.pools
  ADD COLUMN IF NOT EXISTS bonus_round_of_16_wrong integer NOT NULL DEFAULT 15,
  ADD COLUMN IF NOT EXISTS bonus_quarter_wrong     integer NOT NULL DEFAULT 20,
  ADD COLUMN IF NOT EXISTS bonus_semi_wrong        integer NOT NULL DEFAULT 35,
  ADD COLUMN IF NOT EXISTS bonus_third_place       integer NOT NULL DEFAULT 55,
  ADD COLUMN IF NOT EXISTS bonus_third_place_wrong integer NOT NULL DEFAULT 45,
  ADD COLUMN IF NOT EXISTS bonus_final_wrong       integer NOT NULL DEFAULT 50;

-- Update defaults for existing exact-slot bonuses to match official scoring
ALTER TABLE public.pools
  ALTER COLUMN bonus_round_of_16 SET DEFAULT 20,
  ALTER COLUMN bonus_quarter     SET DEFAULT 30,
  ALTER COLUMN bonus_semi        SET DEFAULT 45,
  ALTER COLUMN bonus_final       SET DEFAULT 70,
  ALTER COLUMN bonus_champion    SET DEFAULT 50;