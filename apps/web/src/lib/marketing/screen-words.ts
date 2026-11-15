/**
 * T-167: the product's own words, for the product screens shown on marketing
 * pages. Each is the text the real screen shows; a unit test
 * (`ai-claims-t167.test.ts`) checks them against the real pages' source, so a
 * marketing screen cannot say something the product does not.
 *
 * These are screen text, not marketing claims: they are not written through
 * `says` (lib/marketing/ai-claims.ts).
 */
export const SCREEN_WORDS = {
  /** The customer's question screen (app/q/[quoteId]/clarify): a reading to confirm */
  question: {
    /**
     * The product asks "<what it is>: we read 50 gal from the tank's rating
     * label. Is that right?". The marketing screens show the sentence without
     * its lead-in (the owner's wording, T-167).
     */
    ask: (value: string, readFrom: string) => `We read ${value} from ${readFrom}. Is that right?`,
    yes: (value: string) => `✓ Yes, ${value} is right`,
    no: 'No, let me correct it',
  },
  /** The estimate (app/q/[quoteId]) */
  estimate: {
    breakdown: 'Price breakdown',
    total: 'Total',
    added: 'Added for you — detected from your description',
    takeoffTitle: 'Measurement & takeoff',
    takeoffLead: 'How each part of this estimate was established.',
    fromPhotos: 'From your photos',
    /** The range a customer sees while a detail is unconfirmed */
    rangeFor: (name: string) => `Estimate for ${name}`,
    rangeLead: 'Confirm a couple of details so we can price it for your job. It takes less than a minute.',
    rangeButton: 'Confirm details',
  },
  /** Setup's price check (components/onboarding/CheckPricesStep) */
  prices: {
    title: 'Check your prices',
    hint: 'These are typical starting prices. Change them to yours.',
    confirm: 'These are my prices',
  },
} as const
