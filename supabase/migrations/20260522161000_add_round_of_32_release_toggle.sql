ALTER TABLE public.pools
  ADD COLUMN IF NOT EXISTS round_of_32_points_enabled boolean NOT NULL DEFAULT false;

DROP POLICY IF EXISTS "Admins read pools" ON public.pools;
CREATE POLICY "Admins read pools"
ON public.pools
FOR SELECT
USING (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Admins update pools" ON public.pools;
CREATE POLICY "Admins update pools"
ON public.pools
FOR UPDATE
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));
