/**
 * T-189: the outside companies that handle data for us, in one list.
 *
 * The Terms' data-processing section and the Privacy Policy's "Where data
 * lives" are both written from this, so the two cannot drift apart. Each
 * entry names the setting that proves the service is really used (a name in
 * `apps/web/.env.example`; a unit test holds the two together, in both
 * directions: a service with keys in that file is listed here, or is named in
 * NOT_SUB_PROCESSORS with the reason).
 *
 * Adding a provider to the product means adding it here in the same change.
 */
export interface SubProcessor {
  name: string
  /** What it does for us, in plain words, as the pages print it */
  does: string
  /** A setting in apps/web/.env.example that belongs to this provider */
  setting: string
  /** Set when it handles data only for some businesses: the words that say which */
  onlyFor?: string
}

export const SUB_PROCESSORS: readonly SubProcessor[] = [
  { name: 'Supabase', does: 'the database and sign-in, held in the EU', setting: 'SUPABASE_SERVICE_ROLE_KEY' },
  { name: 'Cloudflare', does: 'storage of photos, documents and PDFs, the processing of each request, and the check that tells people from bots', setting: 'R2_BUCKET_NAME' },
  { name: 'Vercel', does: 'hosting of the website, the dashboard and the quote pages', setting: 'NEXT_PUBLIC_APP_URL' },
  { name: 'Google', does: 'the AI models that read a request’s photos and words', setting: 'GEMINI_API_KEY' },
  { name: 'Postmark', does: 'sending email', setting: 'POSTMARK_API_TOKEN' },
  { name: 'DocRaptor', does: 'making the PDF of a quote', setting: 'DOCRAPTOR_API_KEY' },
  { name: 'Upstash', does: 'counting requests by network address for a few minutes, to stop abuse', setting: 'UPSTASH_REDIS_REST_URL' },
  { name: 'Stripe', does: 'payment for your own subscription, never your customers’ details', setting: 'STRIPE_SECRET_KEY' },
  { name: 'Meta', does: 'WhatsApp messages to and from that number', setting: 'WHATSAPP_APP_SECRET', onlyFor: 'for a business that connects its WhatsApp number' },
]

/**
 * Settings in .env.example that belong to an outside service which is NOT a
 * sub-processor of customers' data, with why. (The prefix of the setting.)
 */
export const NOT_SUB_PROCESSORS: Readonly<Record<string, string>> = {
  TWILIO: 'Text messages are not offered. A business that used them would connect its own Twilio account, which is its provider, not ours.',
  META_PIXEL: 'Measures our own advertising on our marketing pages. It never sees a business’s customers (Privacy Policy, Cookies).',
  META_CAPI: 'The same: our own advertising only.',
}

/** One provider as a line of a list: "Postmark: sending email" */
export function subProcessorLine(p: SubProcessor): string {
  return p.onlyFor ? `${p.name}, ${p.onlyFor}: ${p.does}` : `${p.name}: ${p.does}`
}

/** The providers as one sentence, for the Privacy Policy */
export function subProcessorSentence(): string {
  const parts = SUB_PROCESSORS.map((p) => (p.onlyFor ? `${p.onlyFor}, ${p.name} (${p.does})` : `${p.name} (${p.does})`))
  return `${parts.slice(0, -1).join('; ')}; and, ${parts[parts.length - 1]}.`
}
