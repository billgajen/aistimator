/**
 * US launch-trade landing pages (T-144) — marketing CONTENT as data. One
 * template renders every trade (components/marketing/TradeLanding.tsx), so
 * adding a trade means adding an entry here, not another page.
 *
 * T-167: each page says only what the AI does for that trade
 * (Docs/design/ai-capabilities.md, section 5). Sentences about what is read,
 * measured or worked out are written through `says`; a unit test fails on a
 * trade page that claims a capability its template does not have.
 *
 * Copy rules (T-154): claims match the live product. The customer sees an
 * estimate at once (or a range and one question) and, by default, the
 * business confirms it before the customer can accept. No "exact", no
 * confirmed-quote-in-seconds, no engine words, no features that aren't live
 * for a new business (text-message quoting, the on-site app, deposits).
 * Prices shown are examples of the business's OWN rates; stats only where a
 * source is linked.
 */

import { PRODUCT_NAME } from '@qolumns/shared'
import { says } from './ai-claims'

/**
 * T-167: which real screen a "How the price is set" step is shown on
 * (components/marketing/TradeLanding.tsx draws it from the trade's own
 * template through lib/marketing/examples.ts):
 *   form      the request form with this trade's question, and its photo when it asks for one
 *   label     the customer's photo of the label (water heaters: the sample label we ship)
 *   question  the customer's question screen: the reading, and "Yes, … is right"
 *   takeoff   the estimate's measurement block: a quantity worked out from photos
 *   extra     the price breakdown with a line added from the customer's description
 *   prices    setup's price check, with the template's starting prices
 *   estimate  the estimate with its lines
 */
export type TradeScreen = 'form' | 'label' | 'question' | 'takeoff' | 'extra' | 'prices' | 'estimate'

export interface TradePage {
  slug: string
  /** T-154: the vertical pack this page's template comes from (trades row order) */
  packId: string
  /** Nav/footer label, e.g. "HVAC" */
  label: string
  /** As it reads mid-sentence: "Start from the HVAC template" */
  templateName: string
  /** <title> and meta description */
  metaTitle: string
  metaDescription: string
  eyebrow: string
  headline: string
  lede: string
  /** How the price is established for this trade, in order; each step is shown on its real screen (T-167) */
  howPriced: Array<{ title: string; text: string; shows: TradeScreen; screen: string }>
  /** T-167: what a screen reader hears for the hero's screen */
  heroScreen: string
  features: Array<{ title: string; text: string }>
  /** Example of telling the system your prices in plain English */
  pricingExample: string
  closing: string
}

export const TRADES: TradePage[] = [
  {
    slug: 'hvac',
    packId: 'hvac-replacement-us',
    label: 'HVAC',
    templateName: 'HVAC',
    metaTitle: `Instant AC, Heat Pump, Furnace & Mini-Split Estimates | ${PRODUCT_NAME}`,
    metaDescription:
      'Homeowners photograph the rating plate and see a replacement estimate from your own prices straight away. You get the lead and confirm it.',
    eyebrow: 'For HVAC contractors',
    headline: 'Instant replacement estimates, in your prices.',
    lede: says(['label-reading', 'confirm-question', 'pricing-engine'], 'Your customer photographs the rating plate on the outdoor unit or furnace. The AI reads the size from it and checks the reading with them. Your prices do the rest, and they see an estimate while they are still on your page. You get the lead, and you confirm it.'),
    heroScreen: 'The request form on an HVAC contractor’s quote page, with a question answered and a photo of the rating plate added. Under it, the question the customer is asked next: the size read from the plate, 3 ton, with “Yes, 3 ton is right” chosen.',
    howPriced: [
      {
        title: 'It reads the rating plate',
        text: says(['label-reading'], 'One photo of the plate on the outdoor unit or furnace. The model number is read and turned into the size: 3 ton, 80,000 BTU/hr.'),
        shows: 'form',
        screen: 'The request form: a question about the indoor unit answered, and a photo of the rating plate added.',
      },
      {
        title: 'Your customer confirms the size',
        text: says(['confirm-question', 'range-and-question'], 'The reading goes back to them: they tap “Yes, 3 ton is right”, or pick the right size. Blurry plate? They see a range across the sizes you sell, and are asked.'),
        shows: 'question',
        screen: 'The question the customer is asked: the size read from the rating plate, 3 ton, with “Yes, 3 ton is right” chosen.',
      },
      {
        title: 'Your size-by-size prices',
        text: 'One price per tonnage, plus removal, attic or crawl-space access and add-ons like a thermostat or line set.',
        shows: 'estimate',
        screen: 'The customer’s estimate for a 3 ton AC replacement: removal and the 3 ton system, each at the business’s price, and the total.',
      },
    ],
    features: [
      { title: 'AC, heat pump and furnace templates', text: 'Start from typical US replacement pricing and make it yours in minutes.' },
      // T-195: the mini-split is priced from the customer's answers (ai-capabilities.md, section 5)
      { title: 'Mini-splits by the room', text: says(['pricing-engine'], 'The customer says how many rooms. Your per-room prices set the estimate.') },
      { title: 'Your quote link', text: 'Share it on Google, Facebook or WhatsApp, or put the QR code on your van. No website needed.' },
      { title: 'You confirm first', text: 'By default the customer sees the estimate at once and can accept once you’ve confirmed it.' },
    ],
    pricingExample: '“3 ton system $5,600, attic air handler add $600”',
    closing: 'Be the contractor who answers with a price first.',
  },
  {
    slug: 'water-heaters',
    packId: 'water-heater-us',
    label: 'Water heaters',
    templateName: 'water heater',
    metaTitle: `Instant Water Heater Replacement Quotes | ${PRODUCT_NAME}`,
    metaDescription:
      'Customers photograph the tank label and see a gas, propane or electric replacement estimate from your prices straight away. You confirm it.',
    eyebrow: 'For water heater installers',
    headline: 'Instant water heater estimates, in your prices.',
    lede: says(['label-reading', 'confirm-question', 'pricing-engine'], 'The homeowner photographs the label on the tank. The AI reads the capacity and the fuel from it, 50 gallons and natural gas, and checks the reading with them. Your prices do the rest: tank by size, connection by fuel, with venting, expansion tank and haul-away the way you charge them. You get the lead, and you confirm it.'),
    heroScreen: 'The request form on a water heater installer’s quote page: “Where is the water heater?” answered “Garage”, and a photo of the tank’s rating label added. Under it, the question the customer is asked next: the capacity read from the label, 50 gal, with “Yes, 50 gal is right” chosen.',
    howPriced: [
      {
        title: 'It reads the label',
        text: says(['label-reading'], '“CAPACITY 50 U.S. GAL” and “GAS TYPE NATURAL GAS” are read off the tank.'),
        shows: 'label',
        screen: 'A customer’s photo of a water heater’s rating label. It reads: capacity 50 U.S. gallons, gas type natural gas.',
      },
      {
        title: 'Your customer confirms it',
        text: says(['confirm-question', 'range-and-question'], 'They tap “Yes, 50 gal is right”, or pick the right size. Until they do, they see a range across your sizes.'),
        shows: 'question',
        screen: 'The question the customer is asked: the capacity read from the tank’s rating label, 50 gal, with “Yes, 50 gal is right” chosen.',
      },
      {
        title: 'Your prices set the estimate',
        text: says(['pricing-engine'], 'Tank by size, connection by fuel, plus code items like expansion tanks and drain pans.'),
        shows: 'estimate',
        screen: 'The customer’s estimate: removal and haul-away, the 50 gallon tank and the natural gas connection, each at the business’s price, and the total.',
      },
    ],
    features: [
      { title: 'Ready-made template', text: '30 to 75 gallon tanks, gas, propane and electric, pre-filled with typical rates you adjust.' },
      { title: 'Answered at 2 a.m.', text: 'An emergency request gets an estimate from your prices, not a voicemail.' },
      { title: 'You confirm, or it sends', text: 'Confirm each estimate before the customer can accept, or let a service send on its own.' },
    ],
    pricingExample: '“50 gallon gas tank $1,850 installed, expansion tank $200 if needed”',
    closing: 'Win the no-hot-water call while it’s still ringing.',
  },
  {
    slug: 'plumbing',
    packId: 'plumbing-fixtures-us',
    label: 'Plumbing',
    templateName: 'plumbing',
    metaTitle: `Instant Plumbing Fixture Quotes — Toilets, Faucets, Disposals | ${PRODUCT_NAME}`,
    metaDescription: 'A clear per-fixture price list your customers can quote themselves, priced from your own flat rates.',
    eyebrow: 'For plumbers',
    headline: 'Instant fixture estimates, in your prices.',
    lede: 'Customers pick what they want replaced (two toilets, a kitchen faucet, a disposal) and whether you supply the fixtures. They see an estimate from your flat rates straight away. You get the lead, and you confirm it.',
    heroScreen: 'The request form on a plumber’s quote page: “How many toilets to replace?” answered “2”.',
    howPriced: [
      {
        title: 'They count, you price',
        text: 'Customers know how many toilets they have. Your per-fixture rates do the rest.',
        shows: 'form',
        screen: 'The request form: “How many toilets to replace?” answered “2”.',
      },
      {
        title: 'Supply or install-only',
        text: 'Labor and fixture supply priced separately, the way you charge.',
        shows: 'prices',
        screen: 'The price check screen in setup: the plumbing template’s starting prices, each one editable.',
      },
      {
        title: 'Trip charge rules',
        text: 'Minimums and waived trip charges applied automatically.',
        shows: 'estimate',
        screen: 'The customer’s estimate for replacing two toilets, at the business’s price, and the total.',
      },
    ],
    features: [
      { title: 'Price list template', text: 'Toilets, faucets and disposals pre-configured; edit rates in plain English.' },
      { title: 'Photos for the tricky ones', text: 'Seized shut-off valves and odd connections show up before you arrive.' },
      { title: 'Edit before you confirm', text: 'Add a fixture or change a line before the customer can accept.' },
    ],
    pricingExample: '“Toilet install $300, or $575 with a standard toilet; trip charge $79 waived over $500”',
    closing: 'Turn “how much to swap a toilet?” into a lead with a price.',
  },
  {
    slug: 'electrical',
    packId: 'electrical-us',
    label: 'Electrical',
    templateName: 'electrical',
    metaTitle: `Instant EV Charger & Panel Upgrade Estimates | ${PRODUCT_NAME}`,
    metaDescription:
      'EV charger installs and panel upgrades priced from a photo of the panel label and the run length, using your own rates.',
    eyebrow: 'For electricians',
    headline: 'Instant EV charger and panel estimates, in your prices.',
    lede: says(['label-reading', 'confirm-question', 'pricing-engine'], 'The homeowner photographs the label inside the panel door. The AI reads the rating from it, 100 A or 200 A, and checks the reading with them. Load management or a service upgrade is added the way you price them, and run length and charger supply come from two quick questions. You get the lead, and you confirm it.'),
    heroScreen: 'The request form on an electrician’s quote page: “Do you already have the charger?” answered “Please supply one”, and a photo of the panel label added. Under it, the question the customer is asked next: the rating read from the label, 200 A, with “Yes, 200 A is right” chosen.',
    howPriced: [
      {
        title: 'It reads the panel label',
        text: says(['label-reading'], 'One photo of the label inside the panel door. The rating is read from it: 100 A, 200 A.'),
        shows: 'form',
        screen: 'The request form: a question about the charger answered, and a photo of the panel label added.',
      },
      {
        title: 'Your customer confirms the rating',
        text: says(['confirm-question', 'range-and-question'], 'The reading goes back to them: they tap “Yes, 200 A is right”, or pick the right rating.'),
        shows: 'question',
        screen: 'The question the customer is asked: the rating read from the panel’s label, 200 A, with “Yes, 200 A is right” chosen.',
      },
      {
        title: 'Run length and upgrades, at your prices',
        text: says(['pricing-engine'], 'Your included footage and per-foot rate turn their rough distance into a line. A 60 A service gets your service-entrance line; a 200 A panel doesn’t.'),
        shows: 'estimate',
        screen: 'The customer’s estimate for a Level 2 charger installation, at the business’s price, and the total.',
      },
    ],
    features: [
      { title: 'Panel and EV templates', text: 'Typical US pricing for 200 A upgrades and Level 2 installs, yours to adjust.' },
      { title: 'Charger supplied or not', text: 'Customers who bought their own charger aren’t quoted for one.' },
      { title: 'Private by design', text: 'Photos are stored privately; customers see their estimate through their own link.' },
    ],
    pricingExample: '“200 amp panel $2,900 including permit; 60 amp service add $1,500”',
    closing: 'Quote every new EV owner the day they ask.',
  },
  {
    slug: 'garage-doors',
    packId: 'garage-doors-us',
    label: 'Garage doors',
    templateName: 'garage door',
    metaTitle: `Instant Garage Door & Spring Repair Quotes | ${PRODUCT_NAME}`,
    metaDescription: 'Door replacements and spring repairs priced from size, style and spring count, using your own rates.',
    eyebrow: 'For garage door companies',
    headline: 'Broken spring at 7 a.m.? They see your estimate by 7:01.',
    lede: 'Customers choose single or double, the style they want, or how many springs are on the bar. Your prices do the rest, with removal, insulation upgrades and openers handled the way you charge them.',
    heroScreen: 'The request form on a garage door company’s quote page: “How many springs need replacing?” answered “Two”.',
    howPriced: [
      {
        title: 'Size and style, from the customer',
        text: 'Single or double, insulated or composite: the things homeowners know.',
        shows: 'form',
        screen: 'The request form: “How many springs need replacing?” answered “Two”.',
      },
      {
        title: 'Your upgrades',
        text: 'Insulated and wood-look upgrades priced the way you set them.',
        shows: 'prices',
        screen: 'The price check screen in setup: the garage door template’s starting prices, each one editable.',
      },
      {
        title: 'Springs and parts',
        text: 'One spring or a pair, cables and rollers as add-ons.',
        shows: 'estimate',
        screen: 'The customer’s estimate for replacing a pair of torsion springs, at the business’s price, and the total.',
      },
    ],
    features: [
      { title: 'Door and spring templates', text: 'Replacement and repair pre-configured with typical rates.' },
      { title: 'Photos for the install', text: 'The opening, tracks and opener arrive with the request.' },
      { title: 'Accept from the estimate', text: 'Once you’ve confirmed it, the customer accepts and tells you when suits them.' },
    ],
    pricingExample: '“Torsion spring $250, both springs $350, cables $80”',
    closing: 'Be the first price on the stuck-car-in-the-garage call.',
  },
  {
    slug: 'painting',
    packId: 'painting-decorating-us',
    label: 'Painting',
    templateName: 'painting',
    metaTitle: `Instant Interior & Exterior Painting Estimates | ${PRODUCT_NAME}`,
    metaDescription:
      'Interiors priced per room and exteriors from photos, as an estimate from your own prices. You get the lead and confirm it.',
    eyebrow: 'For painting contractors',
    headline: 'Instant painting estimates, in your prices.',
    lede: says(['photo-measurement', 'range-and-question', 'pricing-engine'], 'Homeowners tell you how many rooms, or send photos of the outside. For exteriors the AI works out the wall area from the photos. They see an estimate from your prices, or a range and one question when a measurement isn’t clear. You get the lead, and you confirm it.'),
    heroScreen: 'The request form on a painter’s quote page: “How many rooms?” answered “2”. Under it, part of an exterior estimate: the wall area, worked out from the customer’s photos, priced by the square foot.',
    howPriced: [
      {
        title: 'Rooms from the customer',
        text: 'Interiors are priced per room from what the homeowner tells you.',
        shows: 'form',
        screen: 'The request form: “How many rooms?” answered “2”.',
      },
      {
        title: 'Walls from their photos',
        text: says(['photo-measurement', 'range-and-question'], 'For an exterior, the wall area is worked out from the customer’s photos, using a door as its ruler. When it isn’t clear, they see a range and one quick question.'),
        shows: 'takeoff',
        screen: 'Part of an exterior estimate: the exterior walls priced by the square foot, with the area marked as worked out from the customer’s photos.',
      },
      {
        title: 'Extras they ask for, at your price',
        text: says(['extras-from-description', 'pricing-engine'], 'When the customer writes “and the trim too”, your trim line is added, at your price.'),
        shows: 'extra',
        screen: 'The price breakdown of an interior estimate: the trim line carries a note that it was added from the customer’s description.',
      },
    ],
    features: [
      { title: 'Interior and exterior templates', text: 'Per-room interiors and per-square-foot exteriors, pre-filled with typical US rates.' },
      { title: 'You see the working', text: 'See the working behind every sent estimate.' },
      { title: 'Link or website', text: 'Share your quote link, or add it to your website.' },
    ],
    pricingExample: '“$2.75 per sq ft of wall, trim $350 flat, two-story add 20%”',
    closing: 'Be the painter who quotes first.',
  },
]

export function getTrade(slug: string): TradePage | undefined {
  return TRADES.find((t) => t.slug === slug)
}

/** T-154: where a trade's page lives (painting kept its original /painting) */
export function tradeHref(t: Pick<TradePage, 'slug'>): string {
  return t.slug === 'painting' ? '/painting' : `/trades/${t.slug}`
}

/** T-154: the trades with a template, in the pack registry's order */
export function templateTrades(packIds: readonly string[]): TradePage[] {
  return packIds.map((id) => TRADES.find((t) => t.packId === id)).filter((t): t is TradePage => Boolean(t))
}
