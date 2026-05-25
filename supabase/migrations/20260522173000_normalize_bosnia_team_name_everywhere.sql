-- Ensure legacy Bosnia name variants are normalized everywhere
UPDATE public.teams
SET name = 'Bósnia'
WHERE code = 'BIH'
   OR name IN ('Bosnia and Herzegovina', 'Bosnia & Herzegovina')
   OR name ILIKE 'bosnia%herzegovina%';
