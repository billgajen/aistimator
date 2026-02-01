# CLAUDE.md

## Project: AI Estimate Platform (Web Embed + Hosted Quote Page)
You are building a SaaS platform that lets businesses embed an estimate widget on their website. Customers submit details plus photos and documents, and receive a professional quote package via a hosted quote page (mandatory) and optional PDF. The business configures pricing rules, service areas, taxes, branding, and templates in a dashboard. WhatsApp is an additional channel later, not a core dependency for v1.

## Non negotiable principles
- The quote is not just a number. It is a commercial document plus workflow.
- Pricing must be deterministic based on the business pricing configuration. AI can extract signals and draft wording, but AI must not set the final price.
- Keep v1 compact. Avoid scope creep.

## Tech stack (must follow)
- Frontend and API: Next.js (React, TypeScript), App Router, Tailwind — deployed on Vercel
- Embed widget: Vanilla JS loader that mounts a lightweight React widget; support iframe mode as an option
- Async jobs: Cloudflare Workers + Cloudflare Queues (queue consumer)
- Rate limiting and per tenant throttling: Upstash Redis
- Storage: Cloudflare R2 (photos, documents, PDFs)
- DB and Auth: Supabase Postgres + Supabase Auth
- Payments: Stripe
- Email: Postmark
- AI: Gemini 1.5 Flash (vision extraction + wording)
- PDF: DocRaptor API (external service)
- WhatsApp (later): WhatsApp Business Platform (Cloud API)

## Scope control
- Always follow `/docs/00-v1-scope.md`.
- If a request is not in scope, add it to a v2 backlog note and do not implement it.

## Working style
- Implement one ticket at a time. Do not implement multiple tickets in one pass.
- Before coding, read the relevant docs in `/docs`.
- Provide a short implementation plan first, then implement, then run checks.

## Code conventions
- TypeScript strict mode. Avoid `any`.
- Prefer small, composable modules. No giant files.
- Follow a clear folder structure and naming.
- No hardcoded secrets. Use env vars and `.env.example`.
- Do not introduce a heavy dependency if a small utility can do.

## Anti-hardcoding principle
- NEVER hardcode business-specific values in the codebase (service names, keywords, prices, scope items)
- All business-configurable values must come from database configuration
- If a fix requires adding specific text like "boiler servicing" or "window cleaning", it's the wrong approach
- The correct approach: make the system respect existing configuration (scope_includes, scope_excludes, etc.)
- AI behavior should be constrained by business configuration, not by hardcoded rules in prompts

## Quality gates
For each ticket:
- Add or update unit tests where practical.
- Ensure `pnpm lint` and `pnpm typecheck` pass.
- Ensure builds run for web and worker packages.
- Update docs if any contracts or behaviour changes.

## Security and privacy basics (v1)
- Multi tenant isolation. Never allow cross tenant access.
- Store uploads privately. Public access only via time limited signed URLs or a controlled quote view page.
- Add basic anti abuse controls: rate limits, honeypot or captcha, upload size limits.
- Log minimal PII. Do not log raw files or full customer messages.

## Deliverables expectations
- Clear, readable code.
- Clear API contracts and typed DTOs.
- Minimal but complete user flows:
  - Widget submission -> quote generation -> hosted quote page -> email notification

## Change Management (IMPORTANT)
- **ALWAYS read `/docs/CHANGELOG.md` before making changes** - it contains:
  - Issues encountered and how they were resolved (to avoid regressions)
  - Architectural decisions and their rationale
  - Known constraints and things intentionally avoided
  - Fix dependencies showing how changes relate to each other
- **ALWAYS update `/docs/CHANGELOG.md` after making changes** - document:
  - What broke, root cause, and resolution
  - Any new architectural decisions
  - New constraints introduced
  - How your fix relates to other fixes
- Before implementing a fix, check if it conflicts with existing decisions or might reintroduce a previously fixed bug