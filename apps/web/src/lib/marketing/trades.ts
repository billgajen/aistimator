/**
 * US launch-trade landing pages (T-144) — marketing CONTENT as data. One
 * template renders every trade (components/marketing/TradeLanding.tsx), so
 * adding a trade means adding an entry here, not another page.
 *
 * Copy rules (T-154): claims match the live product. The customer sees an
 * estimate at once (or a range and one question) and, by default, the
 * business confirms it before the customer can accept. No "exact", no
 * confirmed-quote-in-seconds, no engine words, no features that aren't live
 * for a new business (text-message quoting, the on-site app, deposits).
 * Prices shown are examples of the business's OWN rates; stats only where a
 * source is linked.
 */

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
  /** How the price is established for this trade, in order of precision */
  howPriced: Array<{ title: string; text: string }>
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
    metaTitle: 'Instant AC, Heat Pump & Furnace Replacement Estimates | Aistimator',
    metaDescription:
      'Homeowners photograph the rating plate and see a replacement estimate from your own prices straight away. You get the lead and confirm it.',
    eyebrow: 'For HVAC contractors',
    headline: 'Instant replacement estimates, in your prices.',
    lede: 'Your customer photographs the rating plate on the outdoor unit or furnace. The size is read from it, and they see an estimate from your prices while they are still on your page. You get the lead, and you confirm it.',
    howPriced: [
      { title: 'Size from the rating plate', text: 'The model number is read and turned into tonnage or furnace input: 3 ton, 80,000 BTU/hr. If it isn’t clear, the customer is asked.' },
      { title: 'Asks when it can’t tell', text: 'Blurry plate? The estimate shows an honest range across the sizes you sell, and the customer is asked for the size.' },
      { title: 'Your size-by-size prices', text: 'One price per tonnage, plus removal, attic or crawl-space access and add-ons like a thermostat or line set.' },
    ],
    features: [
      { title: 'AC, heat pump and furnace templates', text: 'Start from typical US replacement pricing and make it yours in minutes.' },
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
    metaTitle: 'Instant Water Heater Replacement Quotes | Aistimator',
    metaDescription:
      'Customers photograph the tank label and see a gas, propane or electric replacement estimate from your prices straight away. You confirm it.',
    eyebrow: 'For water heater installers',
    headline: 'Instant water heater estimates, in your prices.',
    lede: 'The homeowner photographs the label on the tank. The capacity and fuel are read from it, 50 gallons and natural gas, and they see an estimate from your prices, with venting, expansion tank and haul-away the way you charge them. You get the lead, and you confirm it.',
    howPriced: [
      { title: 'Capacity and fuel from the label', text: '“50 U.S. GAL” and “NATURAL GAS” are read off the tank. If either is unclear, the customer is asked.' },
      { title: 'Honest when unsure', text: 'If the label is unreadable the estimate shows the range across your sizes and asks.' },
      { title: 'Your prices, line by line', text: 'Tank by size, connection by fuel, plus code items like expansion tanks and drain pans.' },
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
    metaTitle: 'Instant Plumbing Fixture Quotes — Toilets, Faucets, Disposals | Aistimator',
    metaDescription: 'A clear per-fixture price list your customers can quote themselves, priced from your own flat rates.',
    eyebrow: 'For plumbers',
    headline: 'Instant fixture estimates, in your prices.',
    lede: 'Customers pick what they want replaced (two toilets, a kitchen faucet, a disposal) and whether you supply the fixtures. They see an estimate from your flat rates straight away. You get the lead, and you confirm it.',
    howPriced: [
      { title: 'They count, you price', text: 'Customers know how many toilets they have. Your per-fixture rates do the rest.' },
      { title: 'Supply or install-only', text: 'Labor and fixture supply priced separately, the way you charge.' },
      { title: 'Trip charge rules', text: 'Minimums and waived trip charges applied automatically.' },
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
    metaTitle: 'Instant EV Charger & Panel Upgrade Estimates | Aistimator',
    metaDescription:
      'EV charger installs and panel upgrades priced from a photo of the panel label and the run length, using your own rates.',
    eyebrow: 'For electricians',
    headline: 'Instant EV charger and panel estimates, in your prices.',
    lede: 'The homeowner photographs the label inside the panel door. The rating (100 A, 200 A) is read from it, and load management or a service upgrade is added the way you price them. Run length and charger supply come from two quick questions. You get the lead, and you confirm it.',
    howPriced: [
      { title: 'Panel rating from the label', text: '“RATED 100 AMPS” is read off the panel. If it isn’t clear, the customer is asked.' },
      { title: 'Run length, calculated', text: 'Your included footage and per-foot rate turn their rough distance into a line item.' },
      { title: 'Upgrades only when needed', text: 'A 60 A service gets your service-entrance line; a 200 A panel doesn’t.' },
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
    metaTitle: 'Instant Garage Door & Spring Repair Quotes | Aistimator',
    metaDescription: 'Door replacements and spring repairs priced from size, style and spring count, using your own rates.',
    eyebrow: 'For garage door companies',
    headline: 'Broken spring at 7 a.m.? They see your estimate by 7:01.',
    lede: 'Customers choose single or double, the style they want, or how many springs are on the bar. Your prices do the rest, with removal, insulation upgrades and openers handled the way you charge them.',
    howPriced: [
      { title: 'Size and style, from the customer', text: 'Single or double, insulated or composite: the things homeowners know.' },
      { title: 'Your upgrades', text: 'Insulated and wood-look upgrades priced the way you set them.' },
      { title: 'Springs and parts', text: 'One spring or a pair, cables and rollers as add-ons.' },
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
    metaTitle: 'Instant Interior & Exterior Painting Estimates | Aistimator',
    metaDescription:
      'Interiors priced per room and exteriors from photos, as an estimate from your own prices. You get the lead and confirm it.',
    eyebrow: 'For painting contractors',
    headline: 'Instant painting estimates, in your prices.',
    lede: 'Homeowners tell you how many rooms, or send photos of the outside. They see an estimate from your prices straight away, or a range and one question when a measurement isn’t clear. You get the lead, and you confirm it.',
    howPriced: [
      { title: 'Rooms from the customer', text: 'Interiors are priced per room from what the homeowner tells you.' },
      { title: 'Photos for the outside', text: 'Exterior wall area is worked out from photos. When it isn’t clear, they see a range.' },
      { title: 'One question to tighten it', text: 'The customer answers one quick question and the range becomes an estimate.' },
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
