# World Cup Bolao Template

A reusable World Cup prediction-pool app inspired by Brazilian `bolao` pools. Users can sign up, join a pool, predict match scores, build knockout brackets, pick a champion, and track a live ranking.

This public template is intentionally independent from Lovable. It uses standard Vite, TanStack Start, React, Supabase, and optional Cloudflare Workers deployment.

## Features

- Email/password auth with Supabase Auth
- Optional Google/Apple OAuth through Supabase providers
- Group-stage score predictions
- Knockout bracket and champion predictions
- Ranking with configurable scoring rules
- Admin screens for matches, qualifiers, payments, scoring, and sync
- Supabase RLS policies and Edge Functions
- Optional football-data.org match sync

## Tech Stack

- TanStack Start + TanStack Router
- React 19 + TypeScript
- Tailwind CSS v4 + Radix/Shadcn-style components
- Supabase Auth, Postgres, Realtime, and Edge Functions
- Vite 7
- Optional Cloudflare Worker runtime

## Quick Start

```bash
npm install
cp .env.example .env
npm run dev
```

Open `http://localhost:5173`.

You must create a Supabase project and fill in `.env` before auth/data features work.

## Environment Variables

Use `.env.example` as the source of truth. Important groups:

- `VITE_SUPABASE_*`: browser-safe Supabase URL and publishable key
- `SUPABASE_*`: server/function variables, including service role key
- `FOOTBALL_API_KEY`: optional, only for match sync
- `VITE_PAYMENT_*`: optional public copy for the payment tab
- `VITE_APP_URL` and `VITE_APP_OG_IMAGE_URL`: public metadata URLs

Never commit `.env`.

## Supabase Setup

1. Create a new Supabase project.
2. Apply migrations from `supabase/migrations`.
3. Configure Auth redirect URLs for your local and production domains.
4. Sign up as the first user. The first user becomes admin by default.
5. Create the first pool using the SQL example in `supabase/seeds/seed.example.sql`.
6. Deploy Edge Functions if you want sync/scoring buttons to call hosted functions.

Detailed setup: [docs/SETUP_SUPABASE.md](docs/SETUP_SUPABASE.md).

## Deployment

- Any Vite-compatible host can serve the app if it supports TanStack Start SSR.
- The included `wrangler.jsonc` is configured for a Cloudflare-style worker entry at `src/server.ts`.
- You can also adapt the app to other Node/edge targets supported by TanStack Start.

Cloudflare notes: [docs/DEPLOY_CLOUDFLARE.md](docs/DEPLOY_CLOUDFLARE.md).

## Scoring

The app includes scoring for exact scores, winner/draw outcomes, knockout-stage team hits, third-place picks, finalist picks, and champion picks. See [docs/SCORING_RULES.md](docs/SCORING_RULES.md).

## Public Template Safety

This template removes private deployment data from the original private app:

- No committed `.env`
- No real payment QR code, CPF, or recipient
- No real admin email list
- No hard-coded private pool ID or invite code
- No Lovable project metadata or Lovable packages
- No destructive one-off cleanup migrations

## Scripts

```bash
npm run dev
npm run build
npm run preview
npm run lint
npm run format
```

There is currently no automated test suite.

## License

MIT. See [LICENSE](LICENSE).
