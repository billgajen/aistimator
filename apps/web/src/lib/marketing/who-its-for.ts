/**
 * T-195: the "Who it's for" page (/trades, the URL kept), as data. It says
 * that any business can add its own services and prices, with templates as a
 * head start: the page used to read as if only six trades were served.
 *
 * The template cards are their own list (pack id, label, a line from the
 * customer's side, an optional page), so a template needs no landing page to
 * appear; their order is the pack registry's (lib/vertical-packs), and a test
 * keeps the two in step. Each customer line is checked against its pack's own
 * questions in that test. A sentence about what the product reads or works
 * out is written through `says` (Docs/design/ai-capabilities.md).
 */
import { PRODUCT_NAME } from '@qolumns/shared'
import { says } from './ai-claims'

export const WHO_META = {
  title: `Instant Estimates for Any Business That Prices Jobs | ${PRODUCT_NAME}`,
  description: 'Your customer fills in a short form, adds photos and sees an estimate in your prices. Start from a ready-made template or add your own services and prices.',
} as const

export const WHO_HERO = {
  heading: 'For any business that prices jobs.',
  lede: 'Your customer fills in a short form, adds a photo or two, and sees an estimate in your prices, while you’re still on another job. You get the lead before they ask the next company.',
} as const

export const WHO_FITS = {
  heading: 'Where it works best',
  points: [
    { title: 'Customers already ask you for prices', text: 'Through your website, your quote link or a QR code.' },
    { title: 'The job can be priced from a few answers and photos', text: 'Replacements, installs and other jobs with a known price list.' },
    { title: 'You can’t always answer straight away', text: 'You’re on a job, driving, or it’s 9 at night. Your customer still sees an estimate.' },
  ],
  quiet: 'Less suited to emergency call-outs and fault-finding, where nobody can price the job before seeing it.',
} as const

export interface TemplateCard {
  /** The vertical pack it starts from (lib/vertical-packs) */
  packId: string
  label: string
  /** One line from the customer's side: what they do on the form */
  customer: string
}

/** In the pack registry's order (a test checks it) */
/**
 * T-196: a card's line of services. Nothing when the template's only service
 * has the card's own name (it would say the title twice). The "·" between
 * two names is tied to the name before it by a space that does not break, so
 * a line never starts with one.
 */
export function cardServiceLine(label: string, serviceNames: string[]): string | null {
  const names = serviceNames.map((n) => n.trim()).filter(Boolean)
  const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()
  if (names.length === 0 || (names.length === 1 && same(names[0] ?? '', label.trim()))) return null
  return names.join('\u00A0· ')
}

export const TEMPLATE_CARDS: readonly TemplateCard[] = [
  { packId: 'water-heater-us', label: 'Water heaters', customer: 'The customer photographs the label on the tank and says where it is.' },
  { packId: 'hvac-replacement-us', label: 'HVAC', customer: 'The customer photographs the rating plate. For a mini-split, they say how many rooms.' },
  { packId: 'electrical-us', label: 'Electrical', customer: 'The customer photographs the panel label and says how far the charger is from it.' },
  { packId: 'plumbing-fixtures-us', label: 'Plumbing', customer: 'The customer counts the toilets, faucets and disposals to replace.' },
  { packId: 'garage-doors-us', label: 'Garage doors', customer: 'The customer picks the door size and style, or the number of springs.' },
  { packId: 'painting-decorating-us', label: 'Painting', customer: 'The customer counts the rooms, or photographs the outside walls.' },
  { packId: 'fencing-us', label: 'Fence installation', customer: 'The customer gives the length, height and material.' },
  { packId: 'junk-removal-us', label: 'Junk removal', customer: 'The customer photographs the pile and picks how much of a truck it fills.' },
  { packId: 'pressure-washing-us', label: 'Pressure washing', customer: 'The customer picks what needs cleaning and how big it is.' },
]

export const WHO_TEMPLATES = {
  heading: 'Ready-made templates',
  lede: 'A head start, not a limit. Start from one and change anything: services, questions and prices. The rates are typical ones to make your own.',
  seeHow: 'See how it works',
  start: 'Start with this template',
} as const

/**
 * The ways setup offers to add a business, in setup's own order and words (components/onboarding/TradeStep.tsx:
 * a template, or "Something else" → "Read my website" / "I'll describe it"). Each with what happens next.
 */
export const WHO_OTHER = {
  id: 'other',
  heading: 'Any business can add its own services and prices.',
  text: 'Not on the list? You don’t need a template. Add your business in minutes, then change anything.',
  ways: [
    { title: 'Start from a template', text: 'Pick the closest trade. Its services, questions and typical prices are filled in for you to change.' },
    { title: says(['service-draft'], 'Read my website'), text: says(['service-draft'], 'Give your website’s address. Your services are drafted from it for you to check and price.') },
    { title: 'I’ll describe it', text: says(['service-draft', 'price-sentence'], 'Say what you offer and how you charge, in your own words. It becomes services and prices for you to check.') },
  ],
  likeLabel: 'Businesses like:',
  like: ['Gutter cleaning', 'Tree work', 'Flooring', 'Window cleaning', 'Lawn care', 'Carpet cleaning', 'Appliance installation', 'Handyman jobs', 'Dog grooming', 'Moving'],
} as const

export const WHO_CLOSING = { heading: 'Never lose a lead to a slower quote.' } as const
