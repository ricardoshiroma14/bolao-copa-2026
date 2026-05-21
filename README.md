# Template de Bolão da Copa do Mundo 2026 / World Cup 2026 Bolao Template

## Português do Brasil

Um template reutilizável para criar um bolão da Copa do Mundo. Participantes podem criar conta, entrar em um bolão, palpitar placares, montar o chaveamento do mata-mata, escolher o campeão e acompanhar o ranking em tempo real.

Este template público não depende do Lovable. Ele usa Vite, TanStack Start, React, Supabase e, opcionalmente, deploy em Cloudflare Workers.

### Recursos

- Autenticação por email/senha com Supabase Auth
- OAuth opcional com Google/Apple via provedores do Supabase
- Palpites de placar para a fase de grupos
- Palpites de chaveamento, terceiro lugar, finalistas e campeão
- Ranking com regras de pontuação configuráveis
- Telas administrativas para jogos, classificadas, pagamentos, pontuação e sincronização
- Políticas RLS, migrations e Edge Functions do Supabase
- Sincronização opcional de jogos via football-data.org

### Stack

- TanStack Start + TanStack Router
- React 19 + TypeScript
- Tailwind CSS v4 + componentes estilo Radix/Shadcn
- Supabase Auth, Postgres, Realtime e Edge Functions
- Vite 7
- Runtime opcional em Cloudflare Workers

### Início rápido

```bash
npm install
cp .env.example .env
npm run dev
```

Abra `http://localhost:5173`.

Você precisa criar um projeto Supabase e preencher o `.env` antes que autenticação e dados funcionem.

### Variáveis de ambiente

Use `.env.example` como referência. Grupos principais:

- `VITE_SUPABASE_*`: URL e chave publicável do Supabase, seguras para o navegador
- `SUPABASE_*`: variáveis de servidor/funções, incluindo a service role key
- `FOOTBALL_API_KEY`: opcional, usada apenas para sincronizar jogos
- `VITE_PAYMENT_*`: textos públicos opcionais para a aba de pagamento
- `VITE_APP_URL` e `VITE_APP_OG_IMAGE_URL`: URLs públicas para metadados

Nunca faça commit do arquivo `.env`.

### Configuração do Supabase

1. Crie um novo projeto no Supabase.
2. Aplique as migrations em `supabase/migrations`.
3. Configure as URLs de redirecionamento do Auth para ambiente local e produção.
4. Crie a primeira conta no app. O primeiro usuário vira admin por padrão.
5. Crie o primeiro bolão usando o exemplo SQL em `supabase/seeds/seed.example.sql`.
6. Faça deploy das Edge Functions se quiser usar botões hospedados de sincronização/pontuação.

Guia detalhado: [docs/SETUP_SUPABASE.md](docs/SETUP_SUPABASE.md).

### Deploy

- Qualquer host compatível com Vite/TanStack Start SSR pode servir o app.
- O arquivo `wrangler.jsonc` já aponta para `src/server.ts`, pensando em runtime estilo Cloudflare Worker.
- Você também pode adaptar o app para outros targets Node/edge suportados pelo TanStack Start.

Notas de Cloudflare: [docs/DEPLOY_CLOUDFLARE.md](docs/DEPLOY_CLOUDFLARE.md).

### Pontuação

O app inclui pontuação para placar exato, vencedor/empate, acertos de equipes no mata-mata, terceiro lugar, finalistas e campeão. Veja [docs/SCORING_RULES.md](docs/SCORING_RULES.md).

### Segurança do template público

Este template remove dados privados do app original:

- Sem `.env` commitado
- Sem QR code de pagamento real, CPF ou favorecido
- Sem lista real de emails admin
- Sem ID de bolão privado ou código de convite hard-coded
- Sem metadados ou pacotes do Lovable
- Sem migrations destrutivas de limpeza pontual

### Scripts

```bash
npm run dev
npm run build
npm run preview
npm run lint
npm run format
```

Ainda não há suíte de testes automatizada.

### Licença

Apache License 2.0. Veja [LICENSE](LICENSE).

---

## English

A reusable template for building a World Cup prediction pool, inspired by Brazilian `bolao` pools. Participants can create an account, join a pool, predict match scores, build knockout brackets, pick the champion, and follow a live ranking.

This public template is intentionally independent from Lovable. It uses Vite, TanStack Start, React, Supabase, and optional Cloudflare Workers deployment.

### Features

- Email/password authentication with Supabase Auth
- Optional Google/Apple OAuth through Supabase providers
- Group-stage score predictions
- Knockout bracket, third-place, finalist, and champion predictions
- Ranking with configurable scoring rules
- Admin screens for matches, qualifiers, payments, scoring, and sync
- Supabase RLS policies, migrations, and Edge Functions
- Optional football-data.org match sync

### Tech Stack

- TanStack Start + TanStack Router
- React 19 + TypeScript
- Tailwind CSS v4 + Radix/Shadcn-style components
- Supabase Auth, Postgres, Realtime, and Edge Functions
- Vite 7
- Optional Cloudflare Worker runtime

### Quick Start

```bash
npm install
cp .env.example .env
npm run dev
```

Open `http://localhost:5173`.

You must create a Supabase project and fill in `.env` before auth/data features work.

### Environment Variables

Use `.env.example` as the source of truth. Main groups:

- `VITE_SUPABASE_*`: browser-safe Supabase URL and publishable key
- `SUPABASE_*`: server/function variables, including the service role key
- `FOOTBALL_API_KEY`: optional, only used for match sync
- `VITE_PAYMENT_*`: optional public copy for the payment tab
- `VITE_APP_URL` and `VITE_APP_OG_IMAGE_URL`: public metadata URLs

Never commit `.env`.

### Supabase Setup

1. Create a new Supabase project.
2. Apply migrations from `supabase/migrations`.
3. Configure Auth redirect URLs for local and production domains.
4. Sign up as the first user. The first user becomes admin by default.
5. Create the first pool using the SQL example in `supabase/seeds/seed.example.sql`.
6. Deploy Edge Functions if you want hosted sync/scoring buttons.

Detailed setup: [docs/SETUP_SUPABASE.md](docs/SETUP_SUPABASE.md).

### Deployment

- Any Vite-compatible host can serve the app if it supports TanStack Start SSR.
- The included `wrangler.jsonc` points to `src/server.ts` for a Cloudflare Worker-style runtime.
- You can also adapt the app to other Node/edge targets supported by TanStack Start.

Cloudflare notes: [docs/DEPLOY_CLOUDFLARE.md](docs/DEPLOY_CLOUDFLARE.md).

### Scoring

The app includes scoring for exact scores, winner/draw outcomes, knockout-stage team hits, third-place picks, finalist picks, and champion picks. See [docs/SCORING_RULES.md](docs/SCORING_RULES.md).

### Public Template Safety

This template removes private deployment data from the original private app:

- No committed `.env`
- No real payment QR code, CPF, or recipient
- No real admin email list
- No hard-coded private pool ID or invite code
- No Lovable project metadata or Lovable packages
- No destructive one-off cleanup migrations

### Scripts

```bash
npm run dev
npm run build
npm run preview
npm run lint
npm run format
```

There is currently no automated test suite.

### License

Apache License 2.0. See [LICENSE](LICENSE).
