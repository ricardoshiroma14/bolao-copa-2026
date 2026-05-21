
ALTER TABLE public.pools
  ADD COLUMN IF NOT EXISTS bonus_round_of_32 integer NOT NULL DEFAULT 20,
  ADD COLUMN IF NOT EXISTS bonus_round_of_32_wrong integer NOT NULL DEFAULT 15;

ALTER TABLE public.pools
  ALTER COLUMN bonus_round_of_16 SET DEFAULT 30,
  ALTER COLUMN bonus_round_of_16_wrong SET DEFAULT 20,
  ALTER COLUMN bonus_quarter SET DEFAULT 40,
  ALTER COLUMN bonus_quarter_wrong SET DEFAULT 30,
  ALTER COLUMN bonus_semi SET DEFAULT 50,
  ALTER COLUMN bonus_semi_wrong SET DEFAULT 40,
  ALTER COLUMN bonus_third_place SET DEFAULT 55,
  ALTER COLUMN bonus_third_place_wrong SET DEFAULT 45,
  ALTER COLUMN bonus_final SET DEFAULT 70,
  ALTER COLUMN bonus_final_wrong SET DEFAULT 50;

UPDATE public.pools SET
  bonus_round_of_32 = 20,
  bonus_round_of_32_wrong = 15,
  bonus_round_of_16 = 30,
  bonus_round_of_16_wrong = 20,
  bonus_quarter = 40,
  bonus_quarter_wrong = 30,
  bonus_semi = 50,
  bonus_semi_wrong = 40,
  bonus_third_place = 55,
  bonus_third_place_wrong = 45,
  bonus_final = 70,
  bonus_final_wrong = 50;
