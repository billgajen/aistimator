/**
 * T-201: may this business connect a WhatsApp number today?
 *
 * Quotes inside WhatsApp are built but not open: Meta has not reviewed our
 * app, so only someone with a role on it can finish Meta's sign-up. The ONE
 * flag for "open to every business" is the WhatsApp plan line's `live`
 * (lib/marketing/plan-claims.ts), the same flag that draws "Coming soon" on
 * the site and in the help guide. Until it is set, a business that is not
 * connected sees "Coming soon" on its WhatsApp page, not a button that
 * cannot work for it.
 *
 * Two ways connecting is open before that day:
 *   - WHATSAPP_CONNECT_OPEN names the business: a comma-separated list of
 *     business ids (our own test business, and the one Meta's reviewer signs
 *     in to), or "all";
 *   - Meta is stood in for (WHATSAPP_GRAPH_BASE_URL, honoured outside
 *     production only, as in whatsapp-graph.ts): the checks walk the whole
 *     connect flow against the stand-in.
 *
 * A business that is already connected is not asked this: its page is as it
 * was. Pure, with its inputs given in, so every case is a unit test.
 */
import { COMING_SOON, isLive } from '@/lib/marketing/plan-claims'

export interface WhatsAppOpenInput {
  /** Open to every business (the plan line's live flag) */
  live: boolean
  /** WHATSAPP_CONNECT_OPEN: business ids, or "all" */
  openFor: string | null | undefined
  /** Meta is stood in for locally */
  standIn: boolean
}

export function whatsappConnectOpenFor(tenantId: string, input: WhatsAppOpenInput): boolean {
  if (input.live || input.standIn) return true
  const names = (input.openFor ?? '')
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean)
  return names.includes('all') || names.includes(tenantId)
}

/** The answer for this deployment */
export function whatsappConnectOpen(tenantId: string): boolean {
  return whatsappConnectOpenFor(tenantId, {
    live: isLive('whatsapp'),
    openFor: process.env.WHATSAPP_CONNECT_OPEN,
    standIn: process.env.NODE_ENV !== 'production' && Boolean(process.env.WHATSAPP_GRAPH_BASE_URL),
  })
}

/** What the WhatsApp page says to a business that cannot connect yet */
export const WHATSAPP_SOON_COPY = {
  mark: COMING_SOON,
  title: 'Quotes inside WhatsApp',
  text: 'Soon you will connect your own business WhatsApp number here, and a customer who asks for a price in your chat will get a link to their estimate. Connecting a number is not open yet.',
  meanwhile: 'Until then, send your quote link in your WhatsApp chats.',
  link: 'Open Quote link',
} as const
