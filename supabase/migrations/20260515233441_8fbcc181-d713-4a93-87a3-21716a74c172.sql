-- 1) Atualiza bandeiras (URLs do flagcdn.com) para todas as 53 seleções
UPDATE public.teams SET flag_url = 'https://flagcdn.com/w160/' || sub.cc || '.png'
FROM (VALUES
  ('MEX','mx'),('RSA','za'),('KOR','kr'),('CZE','cz'),
  ('CAN','ca'),('BIH','ba'),('QAT','qa'),('SUI','ch'),
  ('BRA','br'),('MAR','ma'),('HAI','ht'),('SCO','gb-sct'),
  ('USA','us'),('PAR','py'),('AUS','au'),('TUR','tr'),
  ('GER','de'),('CUW','cw'),('CIV','ci'),('ECU','ec'),
  ('NED','nl'),('JPN','jp'),('SWE','se'),('TUN','tn'),
  ('IRN','ir'),('NZL','nz'),('BEL','be'),('EGY','eg'),
  ('ESP','es'),('CPV','cv'),('KSA','sa'),('URU','uy'),
  ('FRA','fr'),('SEN','sn'),('IRQ','iq'),('NOR','no'),
  ('ARG','ar'),('ALG','dz'),('AUT','at'),('JOR','jo'),
  ('POR','pt'),('COD','cd'),('UZB','uz'),('COL','co'),
  ('ENG','gb-eng'),('GHA','gh'),('PAN','pa'),('CRO','hr'),
  ('CMR','cm'),('DEN','dk'),('ITA','it'),('SRB','rs'),('VEN','ve')
) AS sub(code, cc)
WHERE teams.code = sub.code;

-- 2) Atualiza kickoff, venue e ordem home/away dos 72 jogos da fase de grupos
-- segundo a tabela oficial da FIFA divulgada em 06/12/2025.
WITH fixtures(grp, code1, code2, kickoff, venue_name) AS (VALUES
  -- Group A
  ('A','MEX','RSA','2026-06-11 19:00+00'::timestamptz,'Estádio Azteca, Cidade do México'),
  ('A','KOR','CZE','2026-06-12 02:00+00'::timestamptz,'Estádio Akron, Guadalajara'),
  ('A','CZE','RSA','2026-06-18 16:00+00'::timestamptz,'Mercedes-Benz Stadium, Atlanta'),
  ('A','MEX','KOR','2026-06-19 01:00+00'::timestamptz,'Estádio Akron, Guadalajara'),
  ('A','CZE','MEX','2026-06-25 01:00+00'::timestamptz,'Estádio Azteca, Cidade do México'),
  ('A','RSA','KOR','2026-06-25 01:00+00'::timestamptz,'Estádio BBVA, Monterrey'),
  -- Group B
  ('B','CAN','BIH','2026-06-12 19:00+00'::timestamptz,'BMO Field, Toronto'),
  ('B','QAT','SUI','2026-06-13 19:00+00'::timestamptz,'Levi''s Stadium, São Francisco'),
  ('B','SUI','BIH','2026-06-18 19:00+00'::timestamptz,'SoFi Stadium, Los Angeles'),
  ('B','CAN','QAT','2026-06-18 22:00+00'::timestamptz,'BC Place, Vancouver'),
  ('B','SUI','CAN','2026-06-24 19:00+00'::timestamptz,'BC Place, Vancouver'),
  ('B','BIH','QAT','2026-06-24 19:00+00'::timestamptz,'Lumen Field, Seattle'),
  -- Group C
  ('C','BRA','MAR','2026-06-13 22:00+00'::timestamptz,'MetLife Stadium, Nova York/Nova Jersey'),
  ('C','HAI','SCO','2026-06-14 01:00+00'::timestamptz,'Gillette Stadium, Boston'),
  ('C','SCO','MAR','2026-06-19 22:00+00'::timestamptz,'Gillette Stadium, Boston'),
  ('C','BRA','HAI','2026-06-20 01:00+00'::timestamptz,'Lincoln Financial Field, Filadélfia'),
  ('C','SCO','BRA','2026-06-24 22:00+00'::timestamptz,'Hard Rock Stadium, Miami'),
  ('C','MAR','HAI','2026-06-24 22:00+00'::timestamptz,'Mercedes-Benz Stadium, Atlanta'),
  -- Group D
  ('D','USA','PAR','2026-06-13 01:00+00'::timestamptz,'SoFi Stadium, Los Angeles'),
  ('D','AUS','TUR','2026-06-13 04:00+00'::timestamptz,'BC Place, Vancouver'),
  ('D','USA','AUS','2026-06-19 19:00+00'::timestamptz,'Lumen Field, Seattle'),
  ('D','TUR','PAR','2026-06-19 04:00+00'::timestamptz,'Levi''s Stadium, São Francisco'),
  ('D','TUR','USA','2026-06-26 02:00+00'::timestamptz,'SoFi Stadium, Los Angeles'),
  ('D','PAR','AUS','2026-06-26 02:00+00'::timestamptz,'Levi''s Stadium, São Francisco'),
  -- Group E
  ('E','GER','CUW','2026-06-14 17:00+00'::timestamptz,'NRG Stadium, Houston'),
  ('E','CIV','ECU','2026-06-14 23:00+00'::timestamptz,'Lincoln Financial Field, Filadélfia'),
  ('E','GER','CIV','2026-06-20 20:00+00'::timestamptz,'BMO Field, Toronto'),
  ('E','ECU','CUW','2026-06-21 00:00+00'::timestamptz,'Arrowhead Stadium, Kansas City'),
  ('E','ECU','GER','2026-06-25 20:00+00'::timestamptz,'MetLife Stadium, Nova York/Nova Jersey'),
  ('E','CUW','CIV','2026-06-25 20:00+00'::timestamptz,'Lincoln Financial Field, Filadélfia'),
  -- Group F
  ('F','NED','JPN','2026-06-14 20:00+00'::timestamptz,'AT&T Stadium, Dallas'),
  ('F','SWE','TUN','2026-06-15 02:00+00'::timestamptz,'Estádio BBVA, Monterrey'),
  ('F','NED','SWE','2026-06-20 17:00+00'::timestamptz,'NRG Stadium, Houston'),
  ('F','TUN','JPN','2026-06-20 04:00+00'::timestamptz,'Estádio BBVA, Monterrey'),
  ('F','JPN','SWE','2026-06-25 23:00+00'::timestamptz,'AT&T Stadium, Dallas'),
  ('F','TUN','NED','2026-06-25 23:00+00'::timestamptz,'Arrowhead Stadium, Kansas City'),
  -- Group G
  ('G','BEL','EGY','2026-06-15 19:00+00'::timestamptz,'Lumen Field, Seattle'),
  ('G','IRN','NZL','2026-06-16 01:00+00'::timestamptz,'SoFi Stadium, Los Angeles'),
  ('G','BEL','IRN','2026-06-21 19:00+00'::timestamptz,'SoFi Stadium, Los Angeles'),
  ('G','NZL','EGY','2026-06-22 01:00+00'::timestamptz,'BC Place, Vancouver'),
  ('G','EGY','IRN','2026-06-27 03:00+00'::timestamptz,'Lumen Field, Seattle'),
  ('G','NZL','BEL','2026-06-27 03:00+00'::timestamptz,'BC Place, Vancouver'),
  -- Group H
  ('H','ESP','CPV','2026-06-15 16:00+00'::timestamptz,'Mercedes-Benz Stadium, Atlanta'),
  ('H','KSA','URU','2026-06-15 22:00+00'::timestamptz,'Hard Rock Stadium, Miami'),
  ('H','ESP','KSA','2026-06-21 16:00+00'::timestamptz,'Mercedes-Benz Stadium, Atlanta'),
  ('H','URU','CPV','2026-06-21 22:00+00'::timestamptz,'Hard Rock Stadium, Miami'),
  ('H','CPV','KSA','2026-06-27 00:00+00'::timestamptz,'NRG Stadium, Houston'),
  ('H','URU','ESP','2026-06-27 00:00+00'::timestamptz,'Estádio Akron, Guadalajara'),
  -- Group I
  ('I','FRA','SEN','2026-06-16 19:00+00'::timestamptz,'MetLife Stadium, Nova York/Nova Jersey'),
  ('I','IRQ','NOR','2026-06-16 22:00+00'::timestamptz,'Gillette Stadium, Boston'),
  ('I','AUT','JOR','2026-06-16 04:00+00'::timestamptz,'Levi''s Stadium, São Francisco'),
  ('I','FRA','IRQ','2026-06-22 21:00+00'::timestamptz,'Lincoln Financial Field, Filadélfia'),
  ('I','NOR','SEN','2026-06-23 00:00+00'::timestamptz,'MetLife Stadium, Nova York/Nova Jersey'),
  ('I','NOR','FRA','2026-06-26 19:00+00'::timestamptz,'Gillette Stadium, Boston'),
  ('I','SEN','IRQ','2026-06-26 19:00+00'::timestamptz,'BMO Field, Toronto'),
  -- Group J
  ('J','ARG','ALG','2026-06-17 01:00+00'::timestamptz,'Arrowhead Stadium, Kansas City'),
  ('J','ARG','AUT','2026-06-22 17:00+00'::timestamptz,'AT&T Stadium, Dallas'),
  ('J','JOR','ALG','2026-06-23 03:00+00'::timestamptz,'Levi''s Stadium, São Francisco'),
  ('J','ALG','AUT','2026-06-28 02:00+00'::timestamptz,'Arrowhead Stadium, Kansas City'),
  ('J','JOR','ARG','2026-06-28 02:00+00'::timestamptz,'AT&T Stadium, Dallas'),
  -- Group K
  ('K','POR','COD','2026-06-17 17:00+00'::timestamptz,'NRG Stadium, Houston'),
  ('K','UZB','COL','2026-06-18 02:00+00'::timestamptz,'Estádio Azteca, Cidade do México'),
  ('K','POR','UZB','2026-06-23 17:00+00'::timestamptz,'NRG Stadium, Houston'),
  ('K','COL','COD','2026-06-24 02:00+00'::timestamptz,'Estádio Akron, Guadalajara'),
  ('K','COL','POR','2026-06-27 23:30+00'::timestamptz,'Hard Rock Stadium, Miami'),
  ('K','COD','UZB','2026-06-27 23:30+00'::timestamptz,'Mercedes-Benz Stadium, Atlanta'),
  -- Group L
  ('L','ENG','CRO','2026-06-17 20:00+00'::timestamptz,'AT&T Stadium, Dallas'),
  ('L','GHA','PAN','2026-06-17 23:00+00'::timestamptz,'BMO Field, Toronto'),
  ('L','ENG','GHA','2026-06-23 20:00+00'::timestamptz,'Gillette Stadium, Boston'),
  ('L','PAN','CRO','2026-06-23 23:00+00'::timestamptz,'BMO Field, Toronto'),
  ('L','PAN','ENG','2026-06-27 21:00+00'::timestamptz,'MetLife Stadium, Nova York/Nova Jersey'),
  ('L','CRO','GHA','2026-06-27 21:00+00'::timestamptz,'Lincoln Financial Field, Filadélfia')
)
UPDATE public.matches m
SET
  home_team_id = t1.id,
  away_team_id = t2.id,
  kickoff_at   = f.kickoff,
  venue        = f.venue_name,
  status       = 'scheduled',
  home_score   = NULL,
  away_score   = NULL
FROM fixtures f
JOIN public.teams t1 ON t1.code = f.code1
JOIN public.teams t2 ON t2.code = f.code2
WHERE m.stage = 'group'
  AND m.group_name = f.grp
  AND (
    (m.home_team_id = t1.id AND m.away_team_id = t2.id)
    OR (m.home_team_id = t2.id AND m.away_team_id = t1.id)
  );

-- 3) Limpa palpites antigos da fase de grupos (pares home/away podem ter sido invertidos)
DELETE FROM public.predictions p
USING public.matches m
WHERE p.match_id = m.id AND m.stage = 'group';