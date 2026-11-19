/**
 * T-167: the product's own words, for the product screens shown on marketing
 * pages. Each is the text the real screen shows; a unit test
 * (`ai-claims-t167.test.ts`) checks them against the real pages' source, so a
 * marketing screen cannot say something the product does not.
 *
 * These are screen text, not marketing claims: they are not written through
 * `says` (lib/marketing/ai-claims.ts).
 */
import { customerReadLines, readingQuestion } from '../customer-read'

export const SCREEN_WORDS = {
  /** The customer's question screen (app/q/[quoteId]/clarify): a reading to confirm */
  question: {
    /**
     * T-171: the product's own sentence, from the function the real question
     * page uses: "We read 50 gal from your tank's rating label. Is that
     * right?" (T-167 wrote it out here, with "the tank's".)
     */
    ask: (value: string, readFrom: string) => readingQuestion(value, readFrom),
    yes: (value: string) => `✓ Yes, ${value} is right`,
    no: 'No, let me correct it',
  },
  /** The estimate (app/q/[quoteId]) */
  estimate: {
    breakdown: 'Price breakdown',
    total: 'Total',
    added: 'Added for you — detected from your description',
    takeoffTitle: 'Measurement & takeoff',
    takeoffLead: 'What was measured or read for this estimate.',
    fromPhotos: 'From your photos',
    /**
     * T-171: the block's one line for a quantity measured from photos, from
     * the function the real page's lines come from. No amount and no rate:
     * the price is in the breakdown, once.
     */
    measuredLine: (row: { item: string; quantity: number; unit: string }, locale = 'en-US') =>
      customerReadLines({ signals: null, questions: null, answers: null, takeoff: [{ ...row, method: 'From your photos' }], locale })[0] ?? '',
    /** The range a customer sees while a detail is unconfirmed */
    rangeFor: (name: string) => `Estimate for ${name}`,
    rangeLead: 'Confirm a couple of details so we can price it for your job. It takes less than a minute.',
    rangeButton: 'Confirm details',
  },
  /** A quote that carries several services (app/q/[quoteId]): each service's part, and the one total (T-179, T-187) */
  sections: {
    subtotal: (serviceName: string) => `${serviceName} subtotal`,
    total: 'Total',
  },
  /**
   * T-187: the on-site app's own words (apps/mobile), for the app screens shown on the site. The status
   * words and the step names are not here: they come from the shared wording the app itself uses
   * (packages/shared/src/quote-turn.ts).
   */
  app: {
    listTitle: 'Quotes',
    search: 'Search by customer name',
    tabs: { quotes: 'Quotes', newQuote: 'New quote', account: 'Account' },
    priceTitle: 'Price',
    scanTitle: 'Room scan',
    scanLead: 'Walk each room with the camera. A scanned room is measured, not estimated.',
    scanButton: 'Scan a room',
  },
  /** Setup's price check (components/onboarding/CheckPricesStep) */
  prices: {
    title: 'Check your prices',
    hint: 'These are typical starting prices. Change them to yours.',
    confirm: 'These are my prices',
  },
} as const
