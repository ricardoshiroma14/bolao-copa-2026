# Cloudflare Deployment

This template includes `wrangler.jsonc` and `src/server.ts` for a Cloudflare-style worker runtime.

## Steps

1. Install dependencies.
2. Configure `.env` for local development.
3. Add production environment variables/secrets in Cloudflare.
4. Build the app.
5. Deploy with Wrangler.

```bash
npm install
npm run build
npx wrangler deploy
```

## Required Production Variables

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`
- `VITE_APP_URL`
- `VITE_APP_OG_IMAGE_URL`
- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

Payment variables are optional and public.
