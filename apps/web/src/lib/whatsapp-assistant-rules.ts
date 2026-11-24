/**
 * T-177: the WhatsApp assistant's rules — pure, no IO.
 *
 * The business keeps using WhatsApp as it always has. The assistant is
 * silent unless a customer asks for a price for something the business
 * offers (decided by `lib/ai/whatsapp-intent.ts` from the business's own
 * configuration). Then it asks, in short plain sentences, only for what is
 * still missing, and sends the link to the estimate. The price is worked out
 * by the pricing engine from the business's price list, as for every other
 * request; nothing here knows a price.
 *
 * What is asked, and when:
 *   - what the job is: only when the first message did not say;
 *   - a name: only when WhatsApp did not give one;
 *   - an email: only when the business requires both an email and a phone
 *     (WhatsApp itself gives the phone, which is a way to reach the customer);
 *   - where the job is: only when the business limits where it works;
 *   - photos: only when the service requires them.
 * There are no numbered menus and no confirmation step.
 *
 * When it stops:
 *   - after the link is sent, until a new price request;
 *   - for 24 hours after the business replies to that customer itself;
 *   - when a question goes unanswered for a day, or an answer cannot be used
 *     twice in a row: it drops the request silently rather than nag.
 */
import { withinServiceArea } from '@qolumns/shared'
import type { RegionAreas, WhatsAppIntakeData, WhatsAppIntakeState } from '@qolumns/shared'

/** After the business answers a customer itself, the assistant leaves that chat alone for this long */
export const OWNER_PAUSE_MS = 24 * 60 * 60 * 1000
/** A question the customer has not answered for this long is dropped (WhatsApp's own 24 hours have then passed too) */
export const INTAKE_STALE_MS = 24 * 60 * 60 * 1000
/** An answer that cannot be used is asked for again this many times, then the assistant goes quiet */
export const MAX_RETRIES = 1

/** Extra fields the assistant keeps with a chat (beside the shared intake fields) */
export interface AssistantData extends WhatsAppIntakeData {
  /** when the business last replied to this customer from its own app */
  _ownerRepliedAt?: string
  /** how many times the current question has been asked again */
  _retries?: number
  /** the quote the chat produced (read when the estimate is approved) */
  _quoteId?: string
  _quoteUrl?: string
}

export function ownerPaused(ownerRepliedAt: string | null | undefined, now: Date): boolean {
  if (!ownerRepliedAt) return false
  const at = new Date(ownerRepliedAt).getTime()
  if (Number.isNaN(at)) return false
  const age = now.getTime() - at
  return age >= 0 && age < OWNER_PAUSE_MS
}

const ASKING: readonly WhatsAppIntakeState[] = ['awaiting_description', 'awaiting_name', 'awaiting_email', 'awaiting_address', 'awaiting_photos']

/** Is the assistant in the middle of asking this customer something? */
export function asking(state: WhatsAppIntakeState | null | undefined): boolean {
  return ASKING.includes((state ?? 'idle') as WhatsAppIntakeState)
}

/** Has the question been left unanswered too long to carry on? */
export function questionStale(lastTouchedAt: string | null | undefined, now: Date): boolean {
  if (!lastTouchedAt) return false
  const at = new Date(lastTouchedAt).getTime()
  return !Number.isNaN(at) && now.getTime() - at >= INTAKE_STALE_MS
}

/** What the business's configuration asks of a chat request */
export interface IntakeNeeds {
  /** the business requires an email as well as a phone */
  email: boolean
  /** the business limits where it works, so the job's postal code is needed */
  location: boolean
  /** photos the service requires (0 = none asked for) */
  minPhotos: number
}

export function needsFrom(config: { contactRequirement?: string | null; serviceAreaMode?: string | null; minPhotos?: number | null }): IntakeNeeds {
  return {
    email: config.contactRequirement === 'both',
    location: Boolean(config.serviceAreaMode && config.serviceAreaMode !== 'none'),
    minPhotos: Math.max(0, Math.floor(config.minPhotos ?? 0)),
  }
}

export type Step = 'awaiting_description' | 'awaiting_name' | 'awaiting_email' | 'awaiting_address' | 'awaiting_photos' | 'ready'

/** The next thing to ask for, or 'ready' when the request can be made */
export function nextStep(data: AssistantData, needs: IntakeNeeds, opts: { photosDone?: boolean } = {}): Step {
  if (!data.projectDescription?.trim()) return 'awaiting_description'
  if (!data.customerName?.trim()) return 'awaiting_name'
  if (needs.email && !data.customerEmail) return 'awaiting_email'
  if (needs.location && !data.jobPostcode) return 'awaiting_address'
  if (needs.minPhotos > 0 && !opts.photosDone) return 'awaiting_photos'
  return 'ready'
}

/** A name from WhatsApp's profile that can stand on an estimate: letters in it, one line, not long */
export function usableProfileName(name: string | null | undefined): string | null {
  const clean = (name ?? '').replace(/\s+/g, ' ').trim()
  if (clean.length < 2 || clean.length > 60 || !/\p{L}/u.test(clean)) return null
  return clean
}

/** The first name, for a greeting; empty when there is none to use */
const firstName = (name: string | null | undefined) => (usableProfileName(name)?.split(' ')[0] ?? '')

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** The email address in a reply, or null. "my email is a@b.co" is read as well as "a@b.co". */
export function emailIn(text: string): string | null {
  const found = text
    .split(/[\s,;<>()]+/)
    .map((part) => part.replace(/[.!?]+$/, '').toLowerCase())
    .find((part) => EMAIL_RE.test(part) && part.length <= 254)
  return found ?? null
}

/**
 * Is this job inside the places the business works? The same rule as the request form
 * (T-201: `withinServiceArea`, @qolumns/shared), which also checks "County/State" areas: the
 * customer's own words are the address, and the region says which state a ZIP code is in.
 */
export function inServiceArea(
  postcode: string,
  mode: string | null | undefined,
  values: string[] | null | undefined,
  place: { address?: string | null; areas?: RegionAreas | null } = {}
): boolean {
  return withinServiceArea({ mode, values, postcode, address: place.address, areas: place.areas })
}

export interface Wording {
  businessName: string
  serviceName: string
  customerName?: string | null
  postalCodeNoun: string
  minPhotos: number
  photoGuidance?: string | null
}

/** The assistant's sentences. Short, plain, no menus, no price. */
export const say = {
  /** The first reply, which also says who is speaking, followed by the first question (if there is one) */
  opening(w: Wording, question: string | null): string {
    const hello = firstName(w.customerName) ? `Hi ${firstName(w.customerName)}, ` : 'Hi, '
    const who = `this is ${w.businessName}’s quoting assistant. I can get you a price for ${w.serviceName}.`
    return question ? `${hello}${who} ${question}` : `${hello}${who}`
  },
  /** nothing to ask: the first reply carries the link */
  openingWithLink(w: Wording, url: string): string {
    const hello = firstName(w.customerName) ? `Hi ${firstName(w.customerName)}, ` : 'Hi, '
    return `${hello}this is ${w.businessName}’s quoting assistant. Your estimate for ${w.serviceName} will be here in a moment: ${url}`
  },
  description: () => 'What needs doing? Sizes or quantities help.',
  descriptionAgain: () => 'Could you say a little more about the job? One or two sentences is enough.',
  name: () => 'What name should I put on the estimate?',
  email: () => 'What email address should the estimate go to?',
  emailAgain: () => 'That doesn’t look like an email address. What email should the estimate go to?',
  location: (w: Wording) => `What’s the ${w.postalCodeNoun} for the job?`,
  locationAgain: (w: Wording) => `I couldn’t find a ${w.postalCodeNoun} in that. What’s the ${w.postalCodeNoun} for the job?`,
  outsideArea: (w: Wording) => `Sorry, ${w.businessName} doesn’t cover that area.`,
  photos(w: Wording): string {
    const ask = w.minPhotos === 1 ? 'Could you send a photo of the job?' : `Could you send ${w.minPhotos} photos of the job?`
    const guidance = w.photoGuidance?.replace(/\s+/g, ' ').trim()
    return guidance ? `${ask} ${guidance.length > 160 ? `${guidance.slice(0, 157)}…` : guidance}` : ask
  },
  /** enough photos have arrived: more are welcome, and any reply moves on */
  photosEnough: () => 'Got it, thanks. Send any more photos now, or say “that’s all” and I’ll send your estimate.',
  photoNotKept: () => 'I couldn’t use that file. A photo (JPEG or PNG, up to 10 MB) works best.',
  /** the link; the page shows the estimate as soon as it is ready */
  link(w: Wording, url: string): string {
    const thanks = firstName(w.customerName) ? `Thanks, ${firstName(w.customerName)}.` : 'Thanks.'
    return `${thanks} Your estimate from ${w.businessName} will be here in a moment: ${url}`
  },
  failed: (w: Wording) => `Sorry, something went wrong on our side. ${w.businessName} will get back to you.`,
}

/** The question that asks for a step */
export function questionFor(step: Step, w: Wording): string | null {
  switch (step) {
    case 'awaiting_description':
      return say.description()
    case 'awaiting_name':
      return say.name()
    case 'awaiting_email':
      return say.email()
    case 'awaiting_address':
      return say.location(w)
    case 'awaiting_photos':
      return say.photos(w)
    default:
      return null
  }
}
