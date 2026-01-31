# tickets/T-001-repo-scaffold.md

## Goal
Scaffold the monorepo with Next.js (Vercel), Cloudflare Worker (queue consumer), shared types, linting, and local dev scripts.

## In scope
- Monorepo using pnpm workspaces
- `apps/web` (Next.js, TS, Tailwind) — deployed on Vercel
- `apps/worker` (Cloudflare Worker, TS) — queue consumer only
- `packages/shared` shared types and utilities
- ESLint, Prettier, TS strict
- `.env.example` files with required vars:
  - Supabase URL and keys
  - Upstash Redis URL and token
  - Cloudflare account ID and R2 credentials
  - Gemini API key
  - DocRaptor API key
  - Postmark API token
- Vercel project setup notes in README
- Root `README.md` with dev commands

## Out of scope
- Auth, DB, business logic, UI beyond basic shell

## Acceptance criteria
- [x] `pnpm install` succeeds
- [x] `pnpm dev:web` starts Next.js on Vercel dev server
- [x] `pnpm dev:worker` starts Worker locally via wrangler
- [x] `pnpm lint` and `pnpm typecheck` pass
- [x] README includes: install, dev, build, deploy, env setup

## Notes
- Prefer minimal dependencies
- Use `wrangler` for Worker local dev
- Next.js API routes handle all API calls except queue consumer

## Completed
- 2026-01-25: Initial scaffold complete
