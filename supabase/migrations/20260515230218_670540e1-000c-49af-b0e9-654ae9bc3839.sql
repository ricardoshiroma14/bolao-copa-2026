
DO $$
DECLARE
  g TEXT;
  team_ids UUID[];
  match_ids UUID[];
  pairs INT[][] := ARRAY[ARRAY[1,2], ARRAY[3,4], ARRAY[1,3], ARRAY[2,4], ARRAY[1,4], ARRAY[2,3]];
  i INT;
BEGIN
  FOR g IN SELECT DISTINCT group_name FROM public.teams WHERE group_name IS NOT NULL ORDER BY 1 LOOP
    SELECT array_agg(id ORDER BY code) INTO team_ids FROM public.teams WHERE group_name = g;
    SELECT array_agg(id ORDER BY kickoff_at) INTO match_ids FROM public.matches WHERE stage='group' AND group_name = g;
    IF array_length(team_ids,1) <> 4 OR array_length(match_ids,1) <> 6 THEN
      RAISE EXCEPTION 'Group % has wrong counts: teams=%, matches=%', g, array_length(team_ids,1), array_length(match_ids,1);
    END IF;
    FOR i IN 1..6 LOOP
      UPDATE public.matches
        SET home_team_id = team_ids[pairs[i][1]],
            away_team_id = team_ids[pairs[i][2]],
            home_score = NULL, away_score = NULL,
            status = 'scheduled'
        WHERE id = match_ids[i];
    END LOOP;
  END LOOP;
END $$;

-- Limpa palpites órfãos/antigos da fase de grupos (apenas 3 registros existiam, e os pares mudaram)
DELETE FROM public.predictions
  WHERE match_id IN (SELECT id FROM public.matches WHERE stage='group');
