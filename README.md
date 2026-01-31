# Estimator

AI-powered estimate platform that lets businesses embed a quote widget on their website.

## Tech Stack

- **Frontend & API**: Next.js 14 (App Router) on Vercel
- **Queue Consumer**: Cloudflare Workers
- **Database & Auth**: Supabase (Postgres + Auth)
- **Rate Limiting**: Upstash Redis
- **File Storage**: Cloudflare R2
- **AI**: Gemini 1.5 Flash
- **PDF Generation**: DocRaptor
- **Email**: Postmark
- **Payments**: Stripe

## Project Structure

```
estimator/
├── apps/
│   ├── web/          # Next.js app (Vercel)
│   └── worker/       # Cloudflare Worker (queue consumer)
├── packages/
│   └── shared/       # Shared types and utilities
├── supabase/         # Database migrations and config
├── Docs/             # Project documentation
└── tickets/          # Implementation tickets
```

## Prerequisites

- Node.js >= 20.0.0
- pnpm >= 9.0.0
- Wrangler CLI (for Worker development)
- Supabase CLI (for local database development)

## Supabase Setup

### Option A: Local Development (Recommended)

1. Install the Supabase CLI:
   ```bash
   brew install supabase/tap/supabase
   ```

2. Start local Supabase services:
   ```bash
   supabase start
   ```

3. Apply migrations:
   ```bash
   supabase db reset
   ```

4. Get local credentials (shown after `supabase start`):
   - API URL: `http://127.0.0.1:54321`
   - Anon Key: (displayed in terminal)
   - Service Role Key: (displayed in terminal)

5. Access local services:
   - Studio (DB GUI): http://127.0.0.1:54323
   - Inbucket (Email): http://127.0.0.1:54324

### Option B: Remote Supabase Project

1. Create a project at [supabase.com](https://supabase.com)

2. Get your credentials from Project Settings > API:
   - Project URL
   - Anon (public) key
   - Service role key

3. Link your local project:
   ```bash
   supabase link --project-ref your-project-ref
   ```

4. Push migrations to remote:
   ```bash
   supabase db push
   ```

### Database Migrations

Create a new migration:
```bash
supabase migration new your_migration_name
```

Apply migrations locally:
```bash
supabase db reset  # Resets and applies all migrations + seed
```

Push to remote:
```bash
supabase db push
```

## Getting Started

### 1. Install Dependencies

```bash
pnpm install
```

### 2. Environment Setup

Copy the environment example files:

```bash
# Root env (reference)
cp .env.example .env.local

# Web app
cp apps/web/.env.example apps/web/.env.local

# Worker
cp apps/worker/.dev.vars.example apps/worker/.dev.vars
```

Fill in the required values for each service.

### 3. Development

Start the Next.js development server:

```bash
pnpm dev:web
```

Start the Cloudflare Worker locally:

```bash
pnpm dev:worker
```

## Scripts

| Command | Description |
|---------|-------------|
| `pnpm dev:web` | Start Next.js dev server |
| `pnpm dev:worker` | Start Worker with wrangler |
| `pnpm build` | Build all packages |
| `pnpm build:web` | Build Next.js app |
| `pnpm build:worker` | Build Worker |
| `pnpm lint` | Run ESLint on all packages |
| `pnpm typecheck` | Run TypeScript checks |
| `pnpm format` | Format code with Prettier |
| `pnpm format:check` | Check code formatting |

## Deployment

### Vercel (Web App)

1. Connect the repository to Vercel
2. Set the root directory to `apps/web`
3. Configure environment variables in Vercel dashboard
4. Deploy

### Cloudflare Workers (Queue Consumer)

```bash
cd apps/worker
wrangler deploy
```

Set secrets via Wrangler:

```bash
wrangler secret put SUPABASE_SERVICE_KEY
wrangler secret put UPSTASH_REDIS_TOKEN
wrangler secret put GEMINI_API_KEY
```

## Documentation

- [Architecture](./Docs/01-architecture.md)
- [API Contracts](./Docs/02-api-contracts.md)
- [Data Model](./Docs/03-data-model.md)
- [Frontend](./Docs/04-frontend.md)
- [v1 Scope](./Docs/00-v1-scope.md)

## License

Private - All rights reserved
