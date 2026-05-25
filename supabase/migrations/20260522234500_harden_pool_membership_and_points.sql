-- Harden pool membership creation and server-controlled scoring columns.

DROP POLICY IF EXISTS "User joins pool" ON public.pool_members;

CREATE OR REPLACE FUNCTION public.join_pool_by_invite_code(_invite_code TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _pool_id UUID;
  _user_id UUID := auth.uid();
BEGIN
  IF _user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '28000';
  END IF;

  SELECT id INTO _pool_id
  FROM public.pools
  WHERE upper(invite_code) = upper(trim(_invite_code))
  LIMIT 1;

  IF _pool_id IS NULL THEN
    RAISE EXCEPTION 'Codigo de convite invalido' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.pool_members (pool_id, user_id)
  VALUES (_pool_id, _user_id)
  ON CONFLICT (pool_id, user_id) DO NOTHING;

  RETURN _pool_id;
END;
$$;

REVOKE ALL ON FUNCTION public.join_pool_by_invite_code(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.join_pool_by_invite_code(TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _is_first BOOLEAN;
  _is_admin_email BOOLEAN;
BEGIN
  INSERT INTO public.profiles (id, display_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1)));

  SELECT NOT EXISTS(SELECT 1 FROM public.user_roles WHERE role = 'admin') INTO _is_first;
  SELECT EXISTS(SELECT 1 FROM public.admin_emails WHERE lower(email) = lower(NEW.email)) INTO _is_admin_email;

  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'user');
  IF _is_first OR _is_admin_email THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'admin') ON CONFLICT DO NOTHING;
  END IF;

  RETURN NEW;
END; $function$;

CREATE OR REPLACE FUNCTION public.prevent_participant_point_tampering()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' AND NEW.points IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'Pontos sao calculados pelo servidor' USING ERRCODE = '42501';
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.points IS DISTINCT FROM OLD.points THEN
    RAISE EXCEPTION 'Pontos sao calculados pelo servidor' USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.prevent_participant_point_tampering() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS prevent_predictions_points_insert ON public.predictions;
DROP TRIGGER IF EXISTS prevent_predictions_points_update ON public.predictions;
CREATE TRIGGER prevent_predictions_points_insert
  BEFORE INSERT ON public.predictions
  FOR EACH ROW EXECUTE FUNCTION public.prevent_participant_point_tampering();
CREATE TRIGGER prevent_predictions_points_update
  BEFORE UPDATE OF points ON public.predictions
  FOR EACH ROW EXECUTE FUNCTION public.prevent_participant_point_tampering();

DROP TRIGGER IF EXISTS prevent_bracket_predictions_points_insert ON public.bracket_predictions;
DROP TRIGGER IF EXISTS prevent_bracket_predictions_points_update ON public.bracket_predictions;
CREATE TRIGGER prevent_bracket_predictions_points_insert
  BEFORE INSERT ON public.bracket_predictions
  FOR EACH ROW EXECUTE FUNCTION public.prevent_participant_point_tampering();
CREATE TRIGGER prevent_bracket_predictions_points_update
  BEFORE UPDATE OF points ON public.bracket_predictions
  FOR EACH ROW EXECUTE FUNCTION public.prevent_participant_point_tampering();

DROP TRIGGER IF EXISTS prevent_champion_predictions_points_insert ON public.champion_predictions;
DROP TRIGGER IF EXISTS prevent_champion_predictions_points_update ON public.champion_predictions;
CREATE TRIGGER prevent_champion_predictions_points_insert
  BEFORE INSERT ON public.champion_predictions
  FOR EACH ROW EXECUTE FUNCTION public.prevent_participant_point_tampering();
CREATE TRIGGER prevent_champion_predictions_points_update
  BEFORE UPDATE OF points ON public.champion_predictions
  FOR EACH ROW EXECUTE FUNCTION public.prevent_participant_point_tampering();
