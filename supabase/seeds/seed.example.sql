-- Example seed for a first pool.
-- Replace admin@example.com with the email used by your first/admin user.

insert into public.pools (name, description, owner_id)
select
  'Friends World Cup Bolao',
  'Demo prediction pool created from the public template.',
  id
from auth.users
where lower(email) = lower('admin@example.com')
limit 1
returning id, invite_code;
