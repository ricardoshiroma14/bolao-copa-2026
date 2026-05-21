
-- Admin auto-promotion list
CREATE TABLE IF NOT EXISTS public.admin_emails (
  email TEXT PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.admin_emails ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read admin_emails" ON public.admin_emails FOR SELECT USING (has_role(auth.uid(),'admin'));
CREATE POLICY "Admins manage admin_emails" ON public.admin_emails FOR ALL USING (has_role(auth.uid(),'admin')) WITH CHECK (has_role(auth.uid(),'admin'));

-- Add admin emails in your own deployment, for example:
-- INSERT INTO public.admin_emails(email) VALUES ('admin@example.com') ON CONFLICT DO NOTHING;

-- Promote existing matching users
INSERT INTO public.user_roles(user_id, role)
SELECT u.id, 'admin'::app_role FROM auth.users u
WHERE lower(u.email) IN (SELECT lower(email) FROM public.admin_emails)
ON CONFLICT DO NOTHING;

-- Update trigger to auto-grant admin on signup if in admin_emails
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

-- Payment confirmation per pool member
ALTER TABLE public.pool_members
  ADD COLUMN IF NOT EXISTS has_paid BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS paid_confirmed_by UUID;

-- Allow pool owner OR admin to update payment status
DROP POLICY IF EXISTS "Owner or admin updates payment" ON public.pool_members;
CREATE POLICY "Owner or admin updates payment"
ON public.pool_members
FOR UPDATE
USING (
  has_role(auth.uid(),'admin')
  OR EXISTS (SELECT 1 FROM public.pools p WHERE p.id = pool_members.pool_id AND p.owner_id = auth.uid())
)
WITH CHECK (
  has_role(auth.uid(),'admin')
  OR EXISTS (SELECT 1 FROM public.pools p WHERE p.id = pool_members.pool_id AND p.owner_id = auth.uid())
);
