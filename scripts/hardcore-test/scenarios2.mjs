// Hardcore Round 2 — 20 businesses, SpaceX-style.
// KEY DIFFERENCE from round 1: customer requests are authored BLIND (by a
// separate agent that saw only the business name + tagline — never the
// pricing text or fields), and the "customer" answers widget fields via a
// runtime Gemini simulator (customer-sim.mjs), not pre-scripted hints.
// Pricing models are deliberately nastier: from-prices, conditional-free,
// block-tier discounts, negative offsets, recurring elements.
//
// `request`/`persona` fields are populated by scripts/hardcore-test/requests2.json
// (blind-authored). `expect` carries only structural invariants — totals are
// hand-verified post-hoc against config + simulated answers.

export const businesses = [
  {
    id: 'S11', slug: 'locksmith', business: 'KeySwift Locksmiths', service: 'Locksmith Callout',
    tagline: '24/7 emergency locksmiths — lockouts, lock changes, uPVC specialists',
    assetsDir: 'test-assets/hardcore2/S11-locksmith',
    pricingPlainLanguage:
      'Standard callout is £59 which covers the first 30 minutes. Labour after that is £45 per half hour. ' +
      'Parts are charged on top: standard euro cylinder £28, anti-snap cylinder £55, full uPVC gearbox £85. ' +
      'Between 10pm and 6am everything is time and a half. Lockouts where we gain entry non-destructively ' +
      'carry no extra charge; if the lock must be drilled the replacement part is chargeable. We do not work ' +
      'on safes or car locks.',
  },
  {
    id: 'S12', slug: 'dog-grooming', business: 'The Wagging Wagon', service: 'Mobile Dog Grooming',
    tagline: 'Mobile dog grooming van — we come to your driveway',
    assetsDir: 'test-assets/hardcore2/S12-dog-grooming',
    pricingPlainLanguage:
      'Full groom: small breeds £38, medium £48, large £62, giant breeds £80. Severely matted coats add £15. ' +
      'Flea and tick treatment £12. Puppy introduction groom (under 6 months) flat £25. De-shedding treatment £18. ' +
      'Second dog in the same visit gets 20% off its groom. We cover 10 miles from GL50 free, then 80p per mile.',
  },
  {
    id: 'S13', slug: 'wedding-photo', business: 'Golden Hour Studios', service: 'Wedding Photography',
    tagline: 'Documentary wedding photography, relaxed and unposed',
    assetsDir: 'test-assets/hardcore2/S13-wedding-photo',
    pricingPlainLanguage:
      'Full day coverage (10 hours) £1,650. Half day (5 hours) £950. Each additional hour £140. ' +
      'Second photographer £350. Fine-art album £420. Engagement shoot £180, or free with full day bookings. ' +
      'Travel included within 50 miles of OX1; beyond that 45p per mile each way. A £300 deposit secures the date.',
  },
  {
    id: 'S14', slug: 'gutter-cleaning', business: 'ClearFlow Gutter Services', service: 'Gutter Cleaning & Repair',
    tagline: 'Vacuum gutter cleaning and repairs, no ladders on your lawn',
    assetsDir: 'test-assets/hardcore2/S14-gutter-cleaning',
    pricingPlainLanguage:
      'Gutter cleaning £4 per linear metre for single storey, £5.50 per metre for two storey, £8 for three storey. ' +
      'Minimum visit £60. Conservatory gutters flat £35 extra. Re-seating loose brackets £6 each. ' +
      'Downpipe unblocking £25 per downpipe. Before and after camera footage included free.',
  },
  {
    id: 'S15', slug: 'removals', business: 'Two Blokes & a Lorry', service: 'House Removals',
    tagline: 'Friendly local removals — houses, flats, single items',
    assetsDir: 'test-assets/hardcore2/S15-removals',
    pricingPlainLanguage:
      'Two-man crew with Luton van £70 per hour, minimum 2 hours. Three-man crew £95 per hour. ' +
      'Mileage between properties beyond the first 10 miles: £1.50 per mile. Packing service £25 per hour per packer. ' +
      'Packing materials: box bundle (20 boxes, tape, paper) £45. We do not move pianos, safes over 100kg, or anything ' +
      'requiring window extraction — those need a specialist.',
  },
  {
    id: 'S16', slug: 'pressure-washing', business: 'JetBright Exterior Cleaning', service: 'Pressure Washing',
    tagline: 'Driveways, patios and decking brought back to life',
    assetsDir: 'test-assets/hardcore2/S16-pressure-washing',
    pricingPlainLanguage:
      'Block-paved driveways £3.50 per square metre including re-sanding. Concrete or tarmac £2.50 per square metre. ' +
      'Patios £3 per square metre. Timber decking £4 per square metre with soft-wash. Sealing after cleaning £2 per ' +
      'square metre extra. Weed and moss treatment £30 flat. Minimum job £80.',
  },
  {
    id: 'S17', slug: 'bathroom-refit', business: 'AquaLux Bathrooms', service: 'Bathroom Renovation',
    tagline: 'Design and full refit of bathrooms and en-suites',
    assetsDir: 'test-assets/hardcore2/S17-bathroom-refit',
    pricingPlainLanguage:
      'A straightforward like-for-like bathroom refit starts from £4,800 including labour. En-suites from £3,200. ' +
      'Full redesign with moved plumbing typically £6,500 to £9,000 depending on scope — we always do a free home ' +
      'survey before a final price. Wall tiling £45 per square metre, floor tiling £55 per square metre. ' +
      'Underfloor heating £480. We only fit customer-supplied sanitaryware if it arrives before we start.',
  },
  {
    id: 'S18', slug: 'ev-charger', business: 'VoltHome Installations', service: 'EV Charger Installation',
    tagline: 'OZEV-approved home EV charge point installers',
    assetsDir: 'test-assets/hardcore2/S18-ev-charger',
    pricingPlainLanguage:
      'Standard 7kW wallbox installation £949 including the unit, up to 10 metres of cabling from the consumer unit. ' +
      'Each additional metre of cable run £18. If the consumer unit needs a new circuit breaker add £85. ' +
      'Groundworks for detached garages quoted after survey — anything over 25 metres total run always needs a survey. ' +
      'Customers supplying their own charger: installation only £395.',
  },
  {
    id: 'S19', slug: 'chimney-sweep', business: 'Ember & Soot', service: 'Chimney Sweeping',
    tagline: 'Traditional chimney sweeping with modern camera surveys',
    assetsDir: 'test-assets/hardcore2/S19-chimney-sweep',
    pricingPlainLanguage:
      'Standard sweep £65 per flue, certificate included. Each additional flue in the same visit £45. ' +
      'Bird nest removal £40 to £120 depending on severity — priced on the day but never more than £120. ' +
      'Wood stove full service £95 including rope seal replacement. CCTV flue survey £85, half price with any sweep. ' +
      'We do not fit chimney pots or cowls.',
  },
  {
    id: 'S20', slug: 'carpet-cleaning', business: 'FreshWeave Carpet Care', service: 'Carpet & Upholstery Cleaning',
    tagline: 'Deep steam cleaning for carpets, rugs and sofas',
    assetsDir: 'test-assets/hardcore2/S20-carpet-cleaning',
    pricingPlainLanguage:
      'Carpet cleaning per room: small room (under 12 sqm) £35, standard room £45, large room or through-lounge £65. ' +
      'Hall, stairs and landing together £55. Individual stain treatments £8 per stain. Sofa cleaning £20 per seat ' +
      'cushion width. Rugs £3.50 per square metre, delicate wool rugs £6 per square metre. Minimum visit £70. ' +
      'Moving furniture is included; we do not clean sisal or jute.',
  },
  {
    id: 'S21', slug: 'web-design', business: 'Pixelforge Studio', service: 'Website Design & Build',
    tagline: 'Websites for small businesses that actually convert',
    assetsDir: 'test-assets/hardcore2/S21-web-design',
    pricingPlainLanguage:
      'Brochure websites £380 per page designed and built, minimum 3 pages. Online shop functionality adds £900 ' +
      'plus £12 per product uploaded beyond the first 20. Logo design £320. Copywriting £95 per page. ' +
      'Hosting and care plan £39 per month. Rush delivery inside 3 weeks adds 25% to the project total.',
  },
  {
    id: 'S22', slug: 'personal-training', business: 'Forge Fitness Coaching', service: 'Personal Training',
    tagline: '1-to-1 and small group personal training, your place or the park',
    assetsDir: 'test-assets/hardcore2/S22-personal-training',
    pricingPlainLanguage:
      'Single session £48. Block of 10 sessions £430. Block of 20 £780. Training in pairs: add £15 per session ' +
      'split however you like. Home visits within 8 miles included; beyond that £1 per mile per visit. ' +
      'A written 12-week programme without coaching £120. Nutrition plan add-on £85.',
  },
  {
    id: 'S23', slug: 'upholstery', business: 'Heritage & Hide', service: 'Furniture Reupholstery',
    tagline: 'Traditional reupholstery and restoration of loved furniture',
    assetsDir: 'test-assets/hardcore2/S23-upholstery',
    pricingPlainLanguage:
      'Reupholstery labour: dining chair seat £45 each, armchair from £420, two-seat sofa from £680, ' +
      'chaise longue from £750. Fabric is charged at cost — typically £25 to £85 per metre; an armchair needs ' +
      'about 6 metres, a sofa about 12. Frame repairs £38 per hour. Collection and delivery £45 within 20 miles. ' +
      'Foam and webbing replacement included in all from-prices.',
  },
  {
    id: 'S24', slug: 'skip-hire', business: 'GrabIt Skips', service: 'Skip Hire',
    tagline: 'Same-week skip hire, all sizes, permits arranged',
    assetsDir: 'test-assets/hardcore2/S24-skip-hire',
    pricingPlainLanguage:
      '4-yard skip £190, 6-yard £230, 8-yard £270, 12-yard £340 — all for 14 days hire including collection. ' +
      'Extension £10 per week. If the skip goes on the road we arrange the council permit at £35 plus the council fee. ' +
      'Plasterboard must be separate: £15 per bag. No asbestos, tyres, fridges, or paint — collection refused and a ' +
      '£60 wasted journey fee applies if prohibited items are found.',
  },
  {
    id: 'S25', slug: 'solar-cleaning', business: 'SunClear Solar Care', service: 'Solar Panel Cleaning',
    tagline: 'Pure-water solar panel cleaning to keep output high',
    assetsDir: 'test-assets/hardcore2/S25-solar-cleaning',
    pricingPlainLanguage:
      '£8 per panel for single-storey installs, £11 per panel for two-storey. Minimum visit £70. ' +
      'Bird-proofing mesh £22 per metre of panel perimeter. Annual twice-a-year plan saves 15% on each visit. ' +
      'Ground-mounted arrays £6 per panel. We do not walk on tiled roofs — anything without safe ladder or ' +
      'scaffold access needs our cherry-picker day rate, quoted separately.',
  },
  {
    id: 'S26', slug: 'hedge-garden', business: 'TrimTide Garden Maintenance', service: 'Hedge & Garden Maintenance',
    tagline: 'Hedges, lawns and borders kept sharp all season',
    assetsDir: 'test-assets/hardcore2/S26-hedge-garden',
    pricingPlainLanguage:
      'Hedge cutting £5 per metre of hedge length up to 2m tall, £8 per metre for taller hedges. ' +
      'Lawn mowing £30 for gardens up to 100 sqm, £45 up to 250 sqm. Border weeding £28 per hour. ' +
      'Green waste removal £25 per builder bag. Monthly maintenance contracts get 20% off all rates. Minimum visit £45.',
  },
  {
    id: 'S27', slug: 'tutoring', business: 'BrightPath Tutors', service: 'GCSE Maths Tutoring',
    tagline: 'GCSE and A-level maths tutoring, online or at home',
    assetsDir: 'test-assets/hardcore2/S27-tutoring',
    pricingPlainLanguage:
      'Online sessions £42 per hour. In-home sessions £55 per hour within 12 miles of CB1. ' +
      'Block of 10 hours prepaid saves 10%. Easter exam crash course (15 hours over one week) £520 flat. ' +
      'Initial assessment session free. Past-paper marking service £15 per paper with written feedback.',
  },
  {
    id: 'S28', slug: 'house-clearance', business: 'SwiftClear House Clearance', service: 'House Clearance',
    tagline: 'Compassionate full and part house clearances',
    assetsDir: 'test-assets/hardcore2/S28-house-clearance',
    pricingPlainLanguage:
      'Priced by volume: £120 per van load (about 10 cubic yards). Typical 3-bed full clearance is 3 to 4 loads. ' +
      'Resaleable furniture and valuables are offset against the bill — we reduce the price by our resale estimate ' +
      'and show it as a credit line. Hazardous waste, chemicals and asbestos are excluded. Hoarded properties add ' +
      '£40 per load handling. Same-week service, £80 deposit.',
  },
  {
    id: 'S29', slug: 'ice-sculpture', business: 'Glacier Art Co', service: 'Ice Sculptures',
    tagline: 'Hand-carved ice sculptures and luges for events',
    assetsDir: 'test-assets/hardcore2/S29-ice-sculpture',
    pricingPlainLanguage:
      'Single-block sculpture (up to 1m, e.g. swan, initials) £395. Double-block £680. Vodka luge conversion £85. ' +
      'Fully custom design fee £120, waived for orders over £600. Refrigerated delivery and setup £2.50 per mile ' +
      'from B98, minimum £60. Display tray with LED lighting hire £45. Event standby technician £35 per hour, ' +
      'minimum 2 hours, for events over 4 hours long.',
  },
  {
    id: 'S30', slug: 'swarm-removal', business: 'Hive Rescue', service: 'Bee Swarm Removal',
    tagline: 'Ethical honeybee swarm collection and rehoming',
    assetsDir: 'test-assets/hardcore2/S30-swarm-removal',
    pricingPlainLanguage:
      'Accessible clustered swarm collection is FREE — the bees are rehomed to our apiaries. ' +
      'Established colonies inside structures (cut-outs) £65 per hour, typically 3 to 6 hours, plus £45 making-good ' +
      'materials. Work above single-storey height adds £60 access charge. Callout where it turns out to be wasps or ' +
      'bumblebees (which we do not treat): £30 identification visit fee, waived if you send clear photos first. ' +
      'We never destroy honeybees.',
  },
];
