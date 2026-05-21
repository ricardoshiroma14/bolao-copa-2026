-- Keep the signup trigger generic for template deployments.
-- The first user becomes admin, and future admins can be listed in admin_emails.
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
