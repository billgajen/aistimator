# /docs/00-v1-scope.md

## v1 goal
Ship a compact SaaS that a business can:
1) Sign up and configure pricing, service area, tax, branding, and template toggles.
2) Embed a widget on their website via snippet (and optionally iframe).
3) Receive customer submissions with photos and documents.
4) Generate a professional quote package delivered via hosted quote page (mandatory) and optional PDF.
5) Track basic customer activity: created, viewed, accepted, paid (if payments enabled).

## Tech stack summary
- Next.js on Vercel (frontend + API routes)
- Cloudflare Workers + Queues (async quote processing)
- Upstash Redis (rate limiting)
- Supabase (auth + database)
- Cloudflare R2 (file storage)
- AI vision + wording via the model registry (`packages/shared/src/ai-models.json`, T-135)
- DocRaptor (PDF generation)
- Postmark (email)
- Stripe (payments)

## In scope for v1
### Core surfaces
- Marketing site: signup, login, pricing, help, demo section, legal
- Dashboard: onboarding, config, billing, quotes list, basic analytics
- Hosted quote page: no login, mobile friendly, accept and pay actions

### Widget
- Embed snippet for website
- Intake form with configurable fields
- Photo upload plus document upload
- Basic validation and guidance
- Test mode and preview

### Pricing and configuration
- Services and pricing rules per tenant
- Base fee, minimum charge, add ons, multipliers
- Global tax setting (generic tax name and rate, supports VAT, GST, sales tax)
- Service area restrictions by:
  - postcode or zip allowlist
  - county or state region selection (simple)

### Quote outputs
- Hosted quote page (mandatory)
- PDF generation via DocRaptor API (one template, with toggles)
- One document style (T-189, AD-070): every quote is plain, brief and professional. The four document types
  (instant estimate, formal quote, proposal, SOW) changed only the wording's tone and are no longer offered;
  the stored type is ignored.

### Workflow
- Email customer and business with quote link
- Customer can accept quote
- Optional payment link (Stripe) and record paid status
- **One request, several services** (T-179, the owner's decision, 2026-11-17; AD-061): a customer who asks for
  another of the business's services in their note can add it to the same quote. One combined quote, one total,
  one accept. Each service is priced from its own rules. At most two added services. A request with several
  services counts as ONE quote on the plan. On the website form and the quote link; WhatsApp and the on-site app
  show a combined quote but do not add to one.

### Support (T-197, the owner's decision, 21 Nov 2026)
- **One place for a business to get help**, in the dashboard: a Help item on every page that opens a panel to
  report a problem, report a problem with one estimate, suggest a feature, and see its own reports and requests
  with our replies. Web only; the on-site app is not changed.
- **One queue for the owner**, in the admin area: every report sorted and de-duplicated by the AI, with a draft
  fix ticket; feature requests by votes; the business is told when a problem is fixed or a request has shipped.
- **The AI reads and sorts.** It never changes a price, a setting, a service or a quote, never merges by itself,
  and is sent no customer details. A report is saved before anything else happens to it.
- It is an extra: it must never slow, block or break quoting, the dashboard or sign-in.
- Not in this scope: a public roadmap, votes shown to businesses.

### The help guide and "Ask Qolumns" (T-198, the owner's decision, 21 Nov 2026)
- **A help guide** (`Docs/help`): plain pages of questions and answers, one per area, written from what the
  product does today. Plan facts and "is it live" are filled in from the plan definitions and the site's flags,
  never typed. A unit test holds it complete and true; every ticket that changes what a business sees or can do
  updates it.
- **"Ask Qolumns"**, first in the Help panel: an assistant that answers a business's questions from the guide,
  the business's own state and, on a quote's page, that quote's pricing record. It reads and answers: it never
  changes a price, a setting, a service or a quote, and never sends anything to a customer. When the guide does
  not cover a question it says "I'm not sure about that" and offers to send the question to the team.
- **The owner sees every question** (admin Support, Questions), opening on the ones the assistant could not
  answer or the business said did not help. Questions and answers are kept 90 days.
- "Report a problem with this estimate" is also on the on-site app's quote screen.
- Not in this scope: the assistant doing a step for the business, answering customers, a search of the guide on
  the public site, any language but English.

### Basic analytics
- Quotes created
- Quote viewed
- Quote accepted
- Payment initiated and paid (if enabled)
- Plan usage counter (estimates per month)

### Reliability
- Queue based generation
- Global rate limiting and per tenant throttles
- Retries with backoff on rate limit errors

## Out of scope for v1
- Multi language output
- Full CRM integrations (Zapier, webhooks)
- Advanced proposal builder with rich sections and case studies
- Complex scheduling or dispatch systems
- Multi seat roles and permissions beyond basic admin
- Deep compliance tooling beyond basic policies and disclaimers
- Fully native quoting inside WhatsApp chat as the core channel

## v1 definition of done
- A non technical business can configure, embed, test, go live, and generate quotes.
- The quote page looks professional and is consistent.
- The system is stable under moderate load and protects against abuse.