# Supabase Setup

## 1. Create Project

Create a new Supabase project and copy these values into `.env`:

- Project URL -> `VITE_SUPABASE_URL` and `SUPABASE_URL`
- Publishable/anon key -> `VITE_SUPABASE_PUBLISHABLE_KEY` and `SUPABASE_PUBLISHABLE_KEY`
- Service role key -> `SUPABASE_SERVICE_ROLE_KEY`

The service role key must only be used server-side or in Supabase Edge Functions.

## 2. Apply Migrations

From the Supabase CLI, link your project and apply migrations:

```bash
supabase link --project-ref your-project-ref
supabase db push
```

Alternatively, apply the SQL files in `supabase/migrations` through the Supabase SQL editor in filename order.

## 3. Configure Auth

In Supabase Auth settings:

- Add `http://localhost:5173` as a local site/redirect URL.
- Add your production domain as a site/redirect URL.
- Enable email/password auth.
- Optional: enable Google and Apple OAuth providers. The app uses `supabase.auth.signInWithOAuth` directly.

## 4. Create Admin User

Sign up in the app. The first user receives the `admin` role automatically.

For later admins, insert their email into `public.admin_emails` before they sign up, or assign the `admin` role manually from SQL.

```sql
insert into public.admin_emails(email)
values ('admin@example.com')
on conflict do nothing;
```

## 5. Create First Pool

After the admin user exists, run the example in `supabase/seeds/seed.example.sql`, replacing the email and pool copy.

The app currently redirects signed-in users to the first pool by creation date.

## 6. Deploy Functions

```bash
supabase functions deploy sync-matches
supabase functions deploy score-predictions
supabase functions deploy audit-scoring
supabase functions deploy thesportsdb-fixture-test
supabase secrets set SUPABASE_URL=https://your-project-ref.supabase.co
supabase secrets set SUPABASE_PUBLISHABLE_KEY=your-supabase-publishable-key
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
supabase secrets set THESPORTSDB_API_KEY=your-thesportsdb-api-key
supabase secrets set THESPORTSDB_WORLD_CUP_LEAGUE_ID=4429
supabase secrets set THESPORTSDB_WORLD_CUP_SEASON=2026
supabase secrets set SYNC_CRON_SECRET=your-sync-cron-secret
```

`THESPORTSDB_API_KEY` is optional because `sync-matches` falls back to TheSportsDB's free key `123`. Set `SYNC_CRON_SECRET` only if you call `sync-matches` from a scheduled job.
