-- Add missing column on pools
ALTER TABLE public.pools
  ADD COLUMN IF NOT EXISTS round_of_32_points_enabled BOOLEAN NOT NULL DEFAULT false;

-- RPC to join a pool by invite code, returning the pool id
CREATE OR REPLACE FUNCTION public.join_pool_by_invite_code(_invite_code text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _pool_id uuid;
  _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;

  SELECT id INTO _pool_id
  FROM public.pools
  WHERE upper(invite_code) = upper(_invite_code)
  LIMIT 1;

  IF _pool_id IS NULL THEN
    RAISE EXCEPTION 'Código de convite inválido';
  END IF;

  INSERT INTO public.pool_members (pool_id, user_id)
  VALUES (_pool_id, _uid)
  ON CONFLICT DO NOTHING;

  RETURN _pool_id;
END;
$$;