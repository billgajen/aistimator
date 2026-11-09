// Hardcore Round 3 — the US launch trades (T-142).
// Twelve US businesses across the six launch trades (Docs/09):
//  - S31–S36 onboard from the TEMPLATE PACKS (T-140/T-141): the path a US
//    business takes in onboarding, and the only path that exercises
//    nameplate identification (packs carry the decode rules).
//  - S37–S42 onboard from the owner's PLAIN-LANGUAGE pricing in USD through
//    the compiler (T-104), the other onboarding path.
// Customer requests are authored BLIND (requests3.json: the author saw only
// the business name, service and tagline) and the customer answers the
// widget via the runtime simulator, as in round 2.
// `band` is a hand-derived plausible total range from the pricing + any
// realistic answer; totals are also reviewed post-hoc against the trace.
// Plate photos are synthetic renders (test-assets/hardcore2/T140|T141-labels).

export const businesses = [
  // ── Pack-onboarded ───────────────────────────────────────────────────
  {
    id: 'S31', slug: 'us-ac', business: 'Lone Star Comfort Air', service: 'Central AC Replacement',
    tagline: 'Central air conditioning replacement across Austin — same-week installs',
    pack: { file: 'hvac-us', export: 'hvacPackUS', service: 'Central AC Replacement' },
    assetsDir: 'test-assets/hardcore2/T140-labels', assetFiles: ['ac-plate.jpg'],
    band: [5000, 8500], // 3-ton plate: $450 + $5,000, access ×1.12–1.15 and add-ons possible
  },
  {
    id: 'S32', slug: 'us-furnace', business: 'Prairie Heating & Air', service: 'Gas Furnace Replacement',
    tagline: 'Furnace replacement and heating repair in the Twin Cities',
    pack: { file: 'hvac-us', export: 'hvacPackUS', service: 'Gas Furnace Replacement' },
    assetsDir: 'test-assets/hardcore2/T140-labels', assetFiles: ['furnace-plate.jpg'],
    band: [3600, 5200], // 80,000 BTU plate: $300 + $3,600, access/thermostat possible
  },
  {
    id: 'S33', slug: 'us-water-heater', business: 'HotSpring Water Heaters', service: 'Water Heater Replacement',
    tagline: 'Tank water heater replacement — gas, propane and electric',
    pack: { file: 'water-heater-us', export: 'waterHeaterPackUS', service: 'Water Heater Replacement' },
    assetsDir: 'test-assets/hardcore2/T140-labels', assetFiles: ['water-heater-label.jpg'],
    band: [2150, 3300], // 50 gal natural gas: $250 + $1,450 + $450, add-ons/attic possible
  },
  {
    id: 'S34', slug: 'us-fixtures', business: 'Copperline Plumbing', service: 'Fixture Replacement',
    tagline: 'Toilets, faucets and garbage disposals replaced by licensed plumbers',
    pack: { file: 'plumbing-us', export: 'plumbingPackUS', service: 'Fixture Replacement' },
    assetsDir: null, assetFiles: [],
    band: [250, 3000], // $95 trip + per fixture; depends entirely on the blind request
  },
  {
    id: 'S35', slug: 'us-ev', business: 'Bright Volt Electric', service: 'EV Charger Installation',
    tagline: 'Level 2 EV charger installs for homes in Phoenix',
    pack: { file: 'electrical-us', export: 'electricalPackUS', service: 'EV Charger Installation' },
    assetsDir: 'test-assets/hardcore2/T141-labels', assetFiles: ['panel-label.jpg'],
    band: [1600, 5000], // 100 A panel: $1,150 + $450 load mgmt + run/charger per answers
  },
  {
    id: 'S36', slug: 'us-garage-door', business: 'Overhead Pros', service: 'Garage Door Replacement',
    tagline: 'New garage doors installed, old door hauled away',
    pack: { file: 'garage-doors-us', export: 'garageDoorsPackUS', service: 'Garage Door Replacement' },
    assetsDir: null, assetFiles: [],
    band: [1400, 3400], // single $1,400 … double composite $3,360
  },

  // ── Compiler-onboarded (owner's own words, USD) ───────────────────────
  {
    id: 'S37', slug: 'us-paint-ext', business: 'Sunbelt Painting Co', service: 'Exterior House Painting',
    tagline: 'Exterior house painting — stucco, siding and trim',
    assetsDir: 'test-assets/hardcore/S01-painting', assetFiles: null,
    pricingPlainLanguage:
      'Exterior painting is $2.75 per square foot of wall area to be painted, two coats, power washing included. ' +
      'Minimum job $1,200. Trim, fascia and doors are $350 flat. Two-story homes add 20% for ladders and staging. ' +
      'Wood rot repair is quoted on site.',
    band: [1200, 4500],
  },
  {
    id: 'S38', slug: 'us-hvac-compiled', business: 'Coolbreeze HVAC', service: 'AC Replacement',
    tagline: 'AC replacement and repair in Houston, financing available',
    assetsDir: null, assetFiles: [],
    pricingPlainLanguage:
      'AC replacement priced by system size: 2 ton $4,800, 3 ton $5,600, 4 ton $6,400, 5 ton $7,500. ' +
      'Removal and disposal of the old unit $400. New thermostat $250 if wanted. ' +
      'If the air handler is in the attic add $600. We do not do ductwork.',
    band: [5200, 8800],
  },
  {
    id: 'S39', slug: 'us-wh-compiled', business: 'Rapid Rooter Plumbing', service: 'Water Heater Install',
    tagline: 'Same-day water heater installs in Atlanta',
    assetsDir: null, assetFiles: [],
    pricingPlainLanguage:
      'Installed prices including haul away: 40 gallon gas tank $1,650, 50 gallon gas tank $1,850, 50 gallon electric $1,500. ' +
      'Expansion tank $200 if your system needs one. City permit $95 on every install. Tankless is quoted separately.',
    band: [1595, 2200],
  },
  {
    id: 'S40', slug: 'us-panel-compiled', business: 'Amp Up Electric', service: 'Panel Upgrade',
    tagline: 'Electrical panel upgrades and rewiring in Denver',
    assetsDir: null, assetFiles: [],
    pricingPlainLanguage:
      'Upgrade to a 200 amp panel is $2,900 including the permit. If you are on 60 amp service add $1,500 for the meter base ' +
      'and service entrance. Whole-home surge protector $350. Moving the panel to a new location is quoted on site.',
    band: [2900, 4750],
  },
  {
    id: 'S41', slug: 'us-springs-compiled', business: 'DoorMasters', service: 'Garage Door Spring Repair',
    tagline: 'Broken garage door springs fixed today',
    assetsDir: null, assetFiles: [],
    pricingPlainLanguage:
      'Torsion spring replacement: single spring $250, or both springs $350. Cable replacement $80. ' +
      'Nylon roller upgrade, set of 10, $120. If we come out and no repair is needed the service call is $89.',
    band: [89, 550],
  },
  {
    id: 'S42', slug: 'us-plumbing-compiled', business: 'Fixit Faucet', service: 'Plumbing Fixture Install',
    tagline: 'Faucets, toilets and disposals installed by the hour-free flat rate',
    assetsDir: null, assetFiles: [],
    pricingPlainLanguage:
      'Toilet install $300 each if you supply the toilet, or $575 each with a standard toilet included. ' +
      'Kitchen faucet install $225, bathroom faucet $185. Garbage disposal install $195, plus $175 if we supply a 1/2 HP unit. ' +
      'Trip charge $79, waived on jobs over $500.',
    band: [185, 2500],
  },
]
