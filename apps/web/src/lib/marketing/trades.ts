/**
 * US launch-trade landing pages (T-144) — marketing CONTENT as data. One
 * template renders every trade (components/marketing/TradeLanding.tsx), so
 * adding a trade means adding an entry here, not another page.
 *
 * Copy rules: claims match what the product actually does (Docs/09 accuracy
 * promise: photos → range, nameplate → firm, LiDAR scan → exact); prices
 * shown are examples of the business's OWN rates, never ours; stats only
 * where a source is cited.
 */

export interface TradePage {
  slug: string
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
    label: 'HVAC',
    templateName: 'HVAC',
    metaTitle: 'Instant AC, Heat Pump & Furnace Replacement Estimates | Aistimator',
    metaDescription:
      'Homeowners snap the rating plate, you send a firm replacement price in under a minute, priced from your own rates.',
    eyebrow: 'For HVAC contractors',
    headline: 'A replacement price from one photo of the rating plate.',
    lede: 'Your customer photographs the data label on the outdoor unit or furnace. Aistimator reads the model number, works out the tonnage or BTU input, and prices the replacement from your rates, while the homeowner is still on your website.',
    howPriced: [
      { title: 'Reads the rating plate', text: 'The model number is transcribed and decoded into tonnage or furnace input: 3 ton, 80,000 BTU/hr. The customer confirms it in one tap.' },
      { title: 'Asks when it can’t tell', text: 'Blurry plate? The estimate shows an honest range across the sizes you sell, and the customer is asked for the size.' },
      { title: 'Your size-by-size prices', text: 'One price per tonnage, plus removal, attic or crawl-space access and add-ons like a thermostat or line set.' },
    ],
    features: [
      { title: 'AC, heat pump and furnace templates', text: 'Start from typical US replacement pricing and make it yours in minutes.' },
      { title: 'Text-message quoting', text: 'Customers text your number, send the plate photo, and get the link back by SMS.' },
      { title: 'On-site app', text: 'Your tech opens the app, photographs the plate, confirms the size and sends the quote from the driveway.' },
    ],
    pricingExample: '“3 ton system $5,600, attic air handler add $600”',
    closing: 'Be the contractor who sends the price first.',
  },
  {
    slug: 'water-heaters',
    label: 'Water heaters',
    templateName: 'water heater',
    metaTitle: 'Instant Water Heater Replacement Quotes | Aistimator',
    metaDescription:
      'Customers photograph the tank label; you send a firm gas, propane or electric replacement price in under a minute.',
    eyebrow: 'For water heater installers',
    headline: 'No hot water? Send the price before the next plumber calls back.',
    lede: 'The homeowner photographs the label on the tank. Aistimator reads the capacity and fuel, 50 gallons and natural gas, and prices the swap from your rates, with venting, expansion tank and haul-away exactly as you charge them.',
    howPriced: [
      { title: 'Capacity and fuel from the label', text: '“50 U.S. GAL” and “NATURAL GAS” are read off the tank, then confirmed by the customer.' },
      { title: 'Honest when unsure', text: 'If the label is unreadable the estimate shows the range across your sizes and asks.' },
      { title: 'Your prices, line by line', text: 'Tank by size, connection by fuel, plus code items like expansion tanks and drain pans.' },
    ],
    features: [
      { title: 'Ready-made template', text: '30 to 75 gallon tanks, gas, propane and electric, pre-filled with typical rates you adjust.' },
      { title: 'Same-day leads, answered instantly', text: 'Emergency requests get a real price at 2 a.m., not a voicemail.' },
      { title: 'You approve or it sends', text: 'Set review rules, or let confirmed quotes go out on their own.' },
    ],
    pricingExample: '“50 gallon gas tank $1,850 installed, expansion tank $200 if needed”',
    closing: 'Win the no-hot-water call while it’s still ringing.',
  },
  {
    slug: 'plumbing',
    label: 'Plumbing',
    templateName: 'plumbing',
    metaTitle: 'Instant Plumbing Fixture Quotes — Toilets, Faucets, Disposals | Aistimator',
    metaDescription: 'A clear per-fixture price list your customers can quote themselves, priced from your own flat rates.',
    eyebrow: 'For plumbers',
    headline: 'Flat-rate fixture quotes, without the phone tag.',
    lede: 'Customers pick what they want replaced (two toilets, a kitchen faucet, a disposal) and whether you supply the fixtures. They get a professional price in seconds; you get a booked job.',
    howPriced: [
      { title: 'They count, you price', text: 'Customers know how many toilets they have. Your per-fixture rates do the rest. Nothing is guessed.' },
      { title: 'Supply or install-only', text: 'Labor and fixture supply priced separately, exactly the way you charge.' },
      { title: 'Trip charge rules', text: 'Minimums and waived trip charges applied automatically.' },
    ],
    features: [
      { title: 'Price list template', text: 'Toilets, faucets and disposals pre-configured; edit rates in plain English.' },
      { title: 'Photos for the tricky ones', text: 'Seized shut-off valves and odd connections show up before you arrive.' },
      { title: 'On-site app', text: 'Add a fixture on the spot and send the updated quote before you leave.' },
    ],
    pricingExample: '“Toilet install $300, or $575 with a standard toilet; trip charge $79 waived over $500”',
    closing: 'Turn “how much to swap a toilet?” into a booked job.',
  },
  {
    slug: 'electrical',
    label: 'Electrical',
    templateName: 'electrical',
    metaTitle: 'Instant EV Charger & Panel Upgrade Estimates | Aistimator',
    metaDescription:
      'EV charger installs and panel upgrades priced from a photo of the panel label and the run length, using your own rates.',
    eyebrow: 'For electricians',
    headline: 'EV charger and panel quotes, priced from the panel label.',
    lede: 'The homeowner photographs the label inside the panel door. Aistimator reads the rating (100 A, 200 A) and adds load management or a service upgrade exactly as you price them. Run length and charger supply come from two quick questions.',
    howPriced: [
      { title: 'Panel rating from the label', text: '“RATED 100 AMPS” is read off the panel and confirmed by the customer.' },
      { title: 'Run length, calculated', text: 'Your included footage and per-foot rate turn their rough distance into a line item.' },
      { title: 'Upgrades only when needed', text: 'A 60 A service gets your service-entrance line; a 200 A panel doesn’t.' },
    ],
    features: [
      { title: 'Panel and EV templates', text: 'Typical US pricing for 200 A upgrades and Level 2 installs, yours to adjust.' },
      { title: 'Charger supplied or not', text: 'Customers who bought their own charger aren’t quoted for one.' },
      { title: 'Tenant-safe and private', text: 'Photos stay private; customers see their quote through a secure link.' },
    ],
    pricingExample: '“200 amp panel $2,900 including permit; 60 amp service add $1,500”',
    closing: 'Quote every new EV owner the day they ask.',
  },
  {
    slug: 'garage-doors',
    label: 'Garage doors',
    templateName: 'garage door',
    metaTitle: 'Instant Garage Door & Spring Repair Quotes | Aistimator',
    metaDescription: 'Door replacements and spring repairs priced from size, style and spring count, using your own rates.',
    eyebrow: 'For garage door companies',
    headline: 'Broken spring at 7 a.m.? They have your price by 7:01.',
    lede: 'Customers choose single or double, the style they want, or how many springs are on the bar. Your prices do the rest, with removal, insulation upgrades and openers handled the way you charge them.',
    howPriced: [
      { title: 'Size and style, from the customer', text: 'Single or double, insulated or composite: the things homeowners know.' },
      { title: 'Your multipliers', text: 'Insulated and wood-look upgrades priced exactly as you set them.' },
      { title: 'Springs and parts', text: 'One spring or a pair, cables and rollers as add-ons.' },
    ],
    features: [
      { title: 'Door and spring templates', text: 'Replacement and repair pre-configured with typical rates.' },
      { title: 'Photos for the install', text: 'The opening, tracks and opener arrive with the request.' },
      { title: 'Book from the quote', text: 'Customers accept and pay a deposit from the quote page.' },
    ],
    pricingExample: '“Torsion spring $250, both springs $350, cables $80”',
    closing: 'Be the first price on the stuck-car-in-the-garage call.',
  },
  {
    slug: 'painting',
    label: 'Painting',
    templateName: 'painting',
    metaTitle: 'Instant Interior & Exterior Painting Estimates | Aistimator',
    metaDescription:
      'Exterior wall area measured from photos, interiors priced per room, exact prices from an on-site LiDAR scan, all on your own rates.',
    eyebrow: 'For painting contractors',
    headline: 'Painting estimates in 60 seconds, measured, not guessed.',
    lede: 'Homeowners send photos of the house. Aistimator measures the wall area against doors and siding courses, shows an honest range, and asks the one question that tightens it. On site, scan the rooms with your iPhone’s LiDAR and the price is exact.',
    howPriced: [
      { title: 'Photos → an honest range', text: 'Wall area measured several independent times against known sizes (an 80 in door, a siding course).' },
      { title: 'One confirmation → a firm price', text: 'The customer confirms the measured area in one tap and the range becomes a price.' },
      { title: 'LiDAR scan → exact', text: 'Scan each room on site with the Aistimator app; scanned quantities are exact.' },
    ],
    features: [
      { title: 'Interior and exterior templates', text: 'Per-room interiors and per-square-foot exteriors, pre-filled with typical US rates.' },
      { title: 'Shows its work', text: 'Every estimate lists how each quantity was measured, like a professional takeoff.' },
      { title: 'Text and website', text: 'Quote from your website widget or by text message.' },
    ],
    pricingExample: '“$2.75 per sq ft of wall, trim $350 flat, two-story add 20%”',
    closing: 'Be the painter who quotes first.',
  },
]

export function getTrade(slug: string): TradePage | undefined {
  return TRADES.find((t) => t.slug === slug)
}
