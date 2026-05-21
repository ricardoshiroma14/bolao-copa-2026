
-- 1) Limpar grupo dos times que não se classificaram
UPDATE public.teams SET group_name = NULL
WHERE code IN ('CMR','DEN','ITA','POL','SRB','VEN','NGA');

-- 2) Inserir times que faltam (com nomes em PT-BR)
INSERT INTO public.teams (name, code, group_name) VALUES
  ('Bósnia e Herzegovina','BIH','B'),
  ('Haiti','HAI','C'),
  ('Curaçao','CUW','E'),
  ('Nova Zelândia','NZL','G'),
  ('Iraque','IRQ','I'),
  ('RD Congo','COD','K'),
  ('Panamá','PAN','L')
ON CONFLICT DO NOTHING;

-- 3) Reatribuir grupos conforme sorteio oficial FIFA
-- Group A
UPDATE public.teams SET group_name='A' WHERE code IN ('MEX','KOR','RSA','CZE');
-- Group B
UPDATE public.teams SET group_name='B' WHERE code IN ('CAN','SUI','QAT','BIH');
-- Group C
UPDATE public.teams SET group_name='C' WHERE code IN ('BRA','MAR','SCO','HAI');
-- Group D
UPDATE public.teams SET group_name='D' WHERE code IN ('USA','AUS','PAR','TUR');
-- Group E
UPDATE public.teams SET group_name='E' WHERE code IN ('GER','ECU','CIV','CUW');
-- Group F
UPDATE public.teams SET group_name='F' WHERE code IN ('NED','JPN','TUN','SWE');
-- Group G
UPDATE public.teams SET group_name='G' WHERE code IN ('BEL','IRN','EGY','NZL');
-- Group H
UPDATE public.teams SET group_name='H' WHERE code IN ('ESP','URU','KSA','CPV');
-- Group I
UPDATE public.teams SET group_name='I' WHERE code IN ('FRA','SEN','NOR','IRQ');
-- Group J
UPDATE public.teams SET group_name='J' WHERE code IN ('ARG','AUT','ALG','JOR');
-- Group K
UPDATE public.teams SET group_name='K' WHERE code IN ('POR','COL','UZB','COD');
-- Group L
UPDATE public.teams SET group_name='L' WHERE code IN ('ENG','CRO','PAN','GHA');

-- 4) Padronizar nome em PT-BR de alguns times
UPDATE public.teams SET name='Tchéquia' WHERE code='CZE';
UPDATE public.teams SET name='Coreia do Sul' WHERE code='KOR';
