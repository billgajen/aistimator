// 10 hardcore E2E scenarios — see SCENARIOS.md for the human-readable spec.
// Each scenario becomes a fresh tenant. Pricing is configured via the
// plain-language compiler; the customer request goes through the public
// widget API. `expect` holds hand-computed anchors and invariants the
// runner checks against the produced quote.

export const scenarios = [
  {
    id: 'S01',
    slug: 'painting',
    business: 'Brushline Decorators',
    service: 'Exterior Masonry Painting',
    assetsDir: 'test-assets/hardcore/S01-painting',
    pricingPlainLanguage:
      'Exterior masonry painting is £28 per square metre including minor crack filling and two coats. ' +
      'If access is above single storey, add £250 for scaffold tower. Minimum job £350. ' +
      'We cover 15 miles from BS7, no travel charge.',
    customer: { name: 'Sarah Whitfield', email: 'sarah.whitfield.test@example.com', postcode: 'BS7 8PY' },
    request:
      "Hi, the front of our house is looking really tired, paint peeling around the windows and the render " +
      "looks patchy. How much roughly to freshen it all up? Photos attached. Hoping to get it done before " +
      "my daughter's wedding in September.",
    expect: {
      needsPhotos: true,
      ratePerSqm: 28,
      minimumJob: 350,
      invariants: [
        'quantity (sqm) must sit inside the plausibility envelope for a house front',
        'grade B or C with an interval — request is vague',
        'VOI question plausible; if asked, it must clear the max(£75, 10%) bar',
      ],
    },
  },

  {
    id: 'S02',
    slug: 'roofing',
    business: 'Apex Ridge Roofing',
    service: 'Slate Roof Repair',
    assetsDir: 'test-assets/hardcore/S02-roofing',
    pricingPlainLanguage:
      'Replacing slipped or broken slates costs £45 per slate for the first 10 slates, then £30 per slate ' +
      'after that. Ridge repointing £60 per metre. Leak investigation £180 fixed fee. Access tower £120 per day. ' +
      'Jobs needed within 48 hours get a 1.5 times emergency multiplier. We do not do full re-roofs — ' +
      'anything over 40 slates needs an in-person survey.',
    customer: { name: 'Derek Mansell', email: 'derek.mansell.test@example.com', postcode: 'BS16 4QT' },
    request:
      'Storm last night and water is coming into the back bedroom. From the garden I can see 5 or 6 slates ' +
      "slipped near the ridge and one is cracked on the patio. Need someone THIS WEEK, it's forecast rain " +
      'again Thursday.',
    expect: {
      needsPhotos: true,
      slateRateFirst10: 45,
      leakInvestigation: 180,
      invariants: [
        'slate count in the 5–7 region (stated 5 or 6 + 1 cracked), never above 40',
        'urgency/emergency multiplier applied (customer said THIS WEEK)',
        'no full re-roof pricing invented',
      ],
    },
  },

  {
    id: 'S03',
    slug: 'landscaping',
    business: 'GreenForm Landscapes',
    service: 'Garden Landscaping',
    assetsDir: 'test-assets/hardcore/S03-landscaping',
    pricingPlainLanguage:
      'Returfing costs £22 per square metre including topsoil and preparation. Closeboard fencing £85 per ' +
      'metre supplied and installed. Porcelain patio £140 per square metre. Waste removal £90 per load. ' +
      '10% discount on jobs over £5,000.',
    customer: { name: 'Priya Raman', email: 'priya.raman.test@example.com', postcode: 'BS9 3JD' },
    request:
      'Quite a specific list: lawn is roughly 30ft x 18ft and needs returfing. Replace about 65 feet of fence ' +
      'on the left boundary. New porcelain patio approx 12ft x 10ft where the old shed was. Can you break the ' +
      "price down per item? What's the lead time?",
    expect: {
      needsPhotos: true,
      // hand-computed from stated imperial dims: lawn 50.2 sqm ×£22 ≈ £1,104;
      // fence 19.8 m ×£85 ≈ £1,684; patio 11.1 sqm ×£140 ≈ £1,561 → ≈£4,349 (+ waste)
      approxTotalRange: [3900, 5000],
      invariants: [
        'three separate line items (turf, fence, patio) — itemised as requested',
        'imperial converted correctly (30ft ≈ 9.1m, not 30m)',
        'NO 10% discount — subtotal is under £5,000 (near-threshold trap)',
      ],
    },
  },

  {
    id: 'S04',
    slug: 'car-valeting',
    business: 'GleamSquad Mobile Valeting',
    service: 'Mobile Full Valet',
    assetsDir: 'test-assets/hardcore/S04-car-valeting',
    pricingPlainLanguage:
      'Full valet: small car £70, SUV or 7-seater £95. Pet hair removal add £25. Child seat deep clean £10 ' +
      'each. Stain treatment £15 per seat. Weekend appointments £20 extra. We need at least 24 hours notice.',
    customer: { name: 'Jodie Okafor', email: 'jodie.okafor.test@example.com', postcode: 'BS3 1LP' },
    request:
      'Got a 7 seater (Skoda Kodiaq), dog crates lived in the boot for years so dog hair is EVERYWHERE, plus ' +
      "two child seats that have seen things 😅 It's my sister's wedding Sunday morning — can you make it " +
      'showroom by Saturday evening?? 🙏',
    expect: {
      needsPhotos: true,
      // £95 (7-seater) + £25 (pet hair) + 2×£10 (child seats) = £150 core; +£20 if Saturday counted as weekend
      approxTotalRange: [150, 200],
      invariants: [
        '7-seater rate (£95) selected, not small car (£70)',
        'pet hair and 2× child seat addons applied',
        'small-ticket job — should NOT hit the senior adjudication tier',
      ],
    },
  },

  {
    id: 'S05',
    slug: 'accounting',
    business: 'Ledgerly & Co',
    service: 'Accounts Catch-Up Package',
    assetsDir: 'test-assets/hardcore/S05-accounting',
    pricingPlainLanguage:
      'Limited company year-end accounts and CT600: £850 covering up to 1,000 transactions, then £150 per ' +
      'extra 500 transactions or part thereof. VAT return catch-up £95 per quarter. Payroll £8 per payslip ' +
      'per month. Director self-assessment £160 each. Bookkeeping tidy-up £45 per hour where records are messy.',
    customer: { name: 'Tom Beaumont', email: 'tom.beaumont.test@example.com', postcode: 'BS8 2LG' },
    request:
      'Behind on everything. Ltd company, year end was March. About 2,400 transactions across two bank ' +
      'accounts (statement attached). 3 VAT quarters outstanding. Me and my wife are both on monthly payroll ' +
      'and both need self assessments. What will it cost to get us fully up to date?',
    expect: {
      needsPhotos: false, // document upload instead (bank-statement.csv, 2,388 rows)
      // £850 + 3×£150 (2,400 tx → 3 extra tiers) + 3×£95 VAT + 2×£160 SA = £2,205 before payroll/tidy-up
      minTotal: 2205,
      invariants: [
        'no vision/measurement passes — quantities come from text and document',
        'transaction tiering: ~2,400 tx → base + 3 extra tiers (£450), not 2.8 tiers',
        '2 self-assessments, 3 VAT quarters priced',
      ],
    },
  },

  {
    id: 'S06',
    slug: 'catering',
    business: 'Saffron & Sage Catering',
    service: 'Wedding Catering',
    assetsDir: 'test-assets/hardcore/S06-catering',
    pricingPlainLanguage:
      'Three-course seated menu £62 per head, children half price. Canapés on arrival £14 per head. Vegan and ' +
      'gluten-free variants at no extra charge but they must be flagged in advance. Waiting staff: one per 15 ' +
      'guests at £140 each. Marquee or field kitchen setup £380. Travel beyond 30 miles: £1.20 per mile. ' +
      '10% service charge on food.',
    customer: { name: 'Ellie Fairbrother', email: 'ellie.fairbrother.test@example.com', postcode: 'BA11 5JU' },
    request:
      "Wedding 14th June next year. 120 adults plus 8 children, seated three-course. 30 vegans and 5 " +
      "gluten-free among them. Canapés on arrival for everyone. It's in a marquee on a farm near Frome (BA11) " +
      '— no kitchen on site at all. Can you quote all-in including staff?',
    expect: {
      needsPhotos: false, // text-only scenario — zero uploads
      // 120×£62 + 8×£31 + 128×£14 + 9×£140 (ceil(128/15)) + £380 = £11,320 + 10% service on food
      approxTotalRange: [11000, 13500],
      invariants: [
        'children priced at half rate (£31), not full',
        'staff count derived: 128 guests → 9 staff',
        'marquee setup fee applied; dietary flags noted but NOT surcharged',
        'text-only pipeline works end-to-end with zero uploads',
      ],
    },
  },

  {
    id: 'S07',
    slug: 'tree-surgery',
    business: 'Oakwise Tree Care',
    service: 'Tree Surgery',
    assetsDir: 'test-assets/hardcore/S07-tree-surgery',
    pricingPlainLanguage:
      'Crown reduction: £450 for trees under 10 metres, £900 for larger trees. Full removal of a large tree ' +
      'from £1,400. Work near structures or power lines carries a 25% risk premium. Chipping is included; log ' +
      'removal £120 extra. TPO check £60.',
    customer: { name: 'Graham Liddell', email: 'graham.liddell.test@example.com', postcode: 'BS6 7TR' },
    request:
      "Big oak at the bottom of the garden — branches are now over next door's roof and quite close to the " +
      'power line coming into the house. Neighbour is complaining. Not sure whether it needs taking down ' +
      'completely or just cutting back — what would each option cost? Photos taken from the upstairs window.',
    expect: {
      needsPhotos: true,
      invariants: [
        'either/or ambiguity handled: clarification asked OR both options addressed — not a silent guess',
        '25% risk premium applied (power line + neighbour roof explicitly stated)',
        'large-tree classification justified from photos, high-value path → adjudication tier',
      ],
    },
  },

  {
    id: 'S08',
    slug: 'window-cleaning',
    business: 'ClearView Commercial',
    service: 'Commercial Window Cleaning',
    assetsDir: 'test-assets/hardcore/S08-window-cleaning',
    pricingPlainLanguage:
      '£3.20 per window per clean at ground level, £4.50 per window for second and third storeys (reach ' +
      'pole). Frame wipe-down included. Minimum visit charge £60. Monthly contract customers get 15% off the ' +
      'per-visit price. The first clean is 50% extra as a deep clean.',
    customer: { name: 'Martin Kowalski', email: 'martin.kowalski.test@example.com', postcode: 'BS11 9YA' },
    request:
      "Three-storey office on an industrial estate. I counted 84 windows in total. We want monthly cleans — " +
      "what's the per-visit price, and does the first clean cost more? Could start next month.",
    expect: {
      needsPhotos: true,
      invariants: [
        'stated count (84) reconciled with photo evidence — takeoff should reference both',
        'storey split priced at two different rates, not a single blended rate',
        'both numbers answered: discounted per-visit AND first-clean +50%',
      ],
    },
  },

  {
    id: 'S09',
    slug: 'piano-moving',
    business: 'NoteWorthy Piano & Fine Moves',
    service: 'Specialty Item Move',
    assetsDir: 'test-assets/hardcore/S09-piano-moving',
    pricingPlainLanguage:
      'Baby grand piano local move £420. Grandfather or longcase clock £180. Stairs without a lift: £60 extra ' +
      'per flight per item. Distance beyond 25 miles: £2.10 per mile. Window or hoist extraction is not ' +
      'something we quote online — in-person survey required. Insurance up to £20,000 included.',
    customer: { name: 'Imogen Hartley-Vane', email: 'imogen.hv.test@example.com', postcode: 'BS1 5DB' },
    request:
      'Yamaha GB1 baby grand plus a longcase clock, out of a 3rd floor flat in Bristol — no lift, tight ' +
      'Victorian staircase. Moving to Ambleside in Cumbria, about 250 miles. Slight worry the piano might not ' +
      'fit down the stairs and could need to go out the window?',
    expect: {
      needsPhotos: true,
      // £420 + £180 + 3 flights ×£60 ×2 items (£360) + 225 excess miles ×£2.10 (£472.50) = £1,432.50
      approxTotalRange: [1200, 1700],
      invariants: [
        'stairs charged per flight per item (3×2×£60), not once',
        'distance charged on the excess beyond 25 miles only',
        'hoist/window extraction flagged as needing survey — NOT priced (scope exclusion)',
      ],
    },
  },

  {
    id: 'S10',
    slug: 'pest-control',
    business: 'ShieldPest Solutions',
    service: 'Pest Treatment',
    assetsDir: 'test-assets/hardcore/S10-pest-control',
    pricingPlainLanguage:
      'Wasp nest treatment £85, each additional nest £40. Mouse treatment programme of 3 visits £190. ' +
      'Contaminated loft insulation clearance is not offered. Bird proofing is not a service we provide. ' +
      'Landlord or managed-property invoicing adds a £15 admin fee.',
    customer: { name: 'Ryan Doherty', email: 'ryan.doherty.test@example.com', postcode: 'BS5 6HN' },
    request:
      "I'm the tenant but the landlord will pay. Wasps are getting in under the roof tiles into the loft — " +
      'think there might be two nests?? Also found droppings under the kitchen sink, pretty sure we have ' +
      'mice. And while you are up there could you put spikes on the gutter so the pigeons stop sitting there? ' +
      'Photo of the corner where the wasps go in.',
    expect: {
      needsPhotos: true,
      // £85 + £40 (2nd nest) + £190 (mice) + £15 (landlord admin) = £330
      approxTotalRange: [275, 400],
      invariants: [
        'bird proofing / pigeon spikes NEVER appears as a priced line (hard scope exclusion)',
        'landlord admin fee applied (third-party payer)',
        '"two nests??" uncertainty → clarification or explicitly-stated assumption, low grade acceptable',
      ],
    },
  },
];

// ---------------------------------------------------------------------------
// In-character hints: how "the customer" answers required widget fields
// (fieldHints — regex tested against `fieldId label`, lowercased) and
// clarification questions (clarify — regex tested against the question text).
// Everything stays consistent with the original request story.
// ---------------------------------------------------------------------------
const HINTS = {
  S01: {
    fieldHints: [
      { match: /above|storey|floor|level|scaffold/, value: true },
      { match: /area|sqm|square|size|m2/, value: 'Not sure — typical two-storey 3-bed semi' }, // non-numeric on purpose: this customer cannot answer
    ],
    clarify: [
      { match: /area|size|sqm|square|metre|wide|dimension/, answer: "I honestly don't know the area — it's the front of a typical two-storey 3-bed semi, roughly 8 metres wide. Just the front elevation." },
      { match: /scope|which wall|surface|elevation|side/, answer: 'Just the front of the house, including around the windows where it is peeling.' },
    ],
    clarifyDefault: "It's a normal two-storey semi, front only — whatever is standard for that.",
  },
  S02: {
    fieldHints: [
      { match: /first/, value: 7 },
      { match: /beyond|second|after|extra/, value: 0 },
      { match: /tower|day/, value: 1 },
      { match: /urgen|emergency|when|timing/, value: 'emergency this week within 48 hours' },
      { match: /slate|count|how many/, value: 7 },
    ],
    clarify: [
      { match: /slate|how many|count|number/, answer: 'Six slipped that I can see, plus one cracked on the patio — call it 7.' },
      { match: /ridge|repoint/, answer: "Can't tell from the ground, maybe a metre or two near the ridge looks open." },
    ],
    clarifyDefault: 'Whatever you can see from the photos — the leak is above the back bedroom.',
  },
  S03: {
    fieldHints: [
      { match: /lawn|turf|grass/, value: 50 },
      { match: /fenc/, value: 20 },
      { match: /patio/, value: 11 },
    ],
    clarify: [
      { match: /lawn|turf/, answer: 'Lawn is 30ft by 18ft.' },
      { match: /fenc/, answer: '65 feet of standard 6ft closeboard on the left boundary.' },
      { match: /patio/, answer: 'Patio about 12ft by 10ft.' },
      { match: /waste|load|skip/, answer: 'However many loads it takes — the old shed base and turf will need taking away.' },
    ],
    clarifyDefault: 'The measurements in my message are accurate — 30x18ft lawn, 65ft fence, 12x10ft patio.',
  },
  S04: {
    fieldHints: [
      { match: /child.?seat/, value: 2 },
      { match: /stain/, value: 2 },
      { match: /pet|dog|hair/, value: true },
      { match: /appointment|day|weekend|slot|date/, value: 'Weekend' },
      { match: /vehicle|car|size|type|class|seater/, value: 'SUV or 7-seater' },
    ],
    clarify: [
      { match: /stain/, answer: 'A couple of juice stains on the middle-row seats — treat 2 seats.' },
      { match: /weekend|day|when|slot/, answer: 'Saturday please, needs to be done by Saturday evening.' },
    ],
    clarifyDefault: 'Saturday, at my house, needs to be pristine for Sunday morning.',
  },
  S05: {
    fieldHints: [
      { match: /transaction/, value: 2400 },
      { match: /vat|quarter/, value: 3 },
      { match: /month/, value: 4 },
      { match: /director|assess/, value: 2 },
      { match: /payslip|employee|payroll|staff/, value: 2 },
      { match: /year.?end|period/, value: 'Year end 31 March' },
    ],
    clarify: [
      { match: /payroll|month/, answer: 'Payroll is 4 months behind for both of us, monthly payslips.' },
      { match: /hour|tidy|bookkeep|messy/, answer: 'Records are messy but complete — assume whatever tidy-up time is typical for 2,400 transactions.' },
    ],
    clarifyDefault: 'Everything since last March needs catching up — the statement I attached covers it all.',
  },
  S06: {
    fieldHints: [
      { match: /include|flag|require/, value: true }, // include_* booleans must not swallow numeric hints
      { match: /canap/, value: 128 },
      { match: /staff|waiter/, value: 9 },
      { match: /child|kid/, value: 8 },
      { match: /adult/, value: 120 },
      { match: /mile|travel|distance/, value: 20 },
      { match: /kitchen|marquee|venue|setup/, value: true },
      { match: /date|when/, value: '14 June next year' },
      { match: /vegan/, value: 30 },
      { match: /gluten/, value: 5 },
      { match: /guest|head|attend|cover/, value: 128 },
    ],
    clarify: [
      { match: /travel|distance|mile|location/, answer: 'The farm is about 20 miles from you, just outside Frome, BA11.' },
      { match: /kitchen|power|facilities/, answer: 'No kitchen at all — bare marquee in a field, generator power available.' },
      { match: /staff/, answer: 'However many you normally provide for 128 covers.' },
    ],
    clarifyDefault: '128 covers total on 14 June, marquee on a farm near Frome, no kitchen on site.',
  },
  S07: {
    fieldHints: [
      { match: /power|structure|risk|near|cable|line/, value: true },
      { match: /log|timber/, value: true },
      { match: /tpo|preservation/, value: true },
      { match: /remov|reduction|option|type of work|service/, value: 'Full removal' },
      { match: /height|size|metre|tall|large/, value: 'Large (10m+)' },
      { match: /access/, value: 'Through the side gate, bottom of the garden' },
    ],
    clarify: [
      { match: /remove|removal|reduction|option|which|prefer/, answer: 'Go with the full removal — the neighbour pressure has settled it. Please include taking the logs away.' },
      { match: /power|line|distance|cable/, answer: 'The power line passes about 2 metres from the outer branches.' },
      { match: /tpo|preservation/, answer: 'No idea about TPO — please check, happy to pay for that.' },
    ],
    clarifyDefault: "It's a large mature oak, roughly 15m, overhanging next door's roof and near the supply line.",
  },
  S08: {
    fieldHints: [
      { match: /ground/, value: 28 },
      { match: /second|third|upper|storey|floor/, value: 56 },
      { match: /contract|frequen|monthly|often/, value: 'Monthly contract' },
      { match: /first.?clean|deep/, value: true },
      { match: /window|count|how many|total/, value: 84 },
    ],
    clarify: [
      { match: /ground|storey|floor|split|upper/, answer: 'Roughly even per floor — 28 at ground level, 56 across the two upper floors.' },
    ],
    clarifyDefault: '84 windows over three storeys, monthly clean, industrial estate so easy parking and access.',
  },
  S09: {
    fieldHints: [
      { match: /flight|stair/, value: 3 },
      { match: /lift/, value: false },
      { match: /distance|mile/, value: 250 },
      { match: /piano/, value: true },
      { match: /clock/, value: true },
      { match: /item|what|piece|move/, value: 'Baby grand piano and a longcase clock' },
    ],
    clarify: [
      { match: /flight|stair|lift/, answer: 'Three flights, no lift, tight Victorian staircase.' },
      { match: /distance|mile/, answer: 'About 250 miles, Bristol BS1 to Ambleside LA22.' },
      { match: /window|hoist|fit/, answer: "I don't know if it will fit — quote the stairs option and tell me what happens if it doesn't." },
    ],
    clarifyDefault: 'Two items, 3rd floor no lift, Bristol to Ambleside (~250 miles).',
  },
  S10: {
    fieldHints: [
      { match: /additional|extra/, value: 1 }, // "two nests total" = 1 additional beyond the first
      { match: /nest|wasp/, value: 2 },
      { match: /mice|mouse|rodent|programme|visit/, value: true },
      { match: /landlord|tenant|managed|rented|who|payer|property/, value: 'Yes — rented, landlord pays' },
    ],
    clarify: [
      { match: /nest|entry|wasp/, answer: "I've watched two separate entry points under the tiles, so I think two nests." },
      { match: /mice|mouse|visit|programme/, answer: 'Droppings every day under the sink — yes, do the full 3-visit programme.' },
    ],
    clarifyDefault: 'Two wasp entry points under the roof tiles, mice under the kitchen sink, landlord settles the invoice.',
  },
};

for (const s of scenarios) Object.assign(s, HINTS[s.id]);
