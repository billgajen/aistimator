/**
 * Painting pack — United States variant (T-133, AD-025).
 *
 * PURE DATA, parallel to the UK pack (`painting.ts`) but written for US
 * businesses: USD, square feet, stories, US English, US ceiling heights.
 *
 * TODO-OWNER: every rate below is a PLACEHOLDER typical of the US market for
 * the business to review and edit at onboarding. They are not researched
 * price data and must be confirmed before this pack is promoted (OWNER-TODO.md).
 *
 * Design notes (same shape as the UK pack):
 * - Interior prices per room (customers can count rooms exactly)
 * - Exterior prices per square foot from the measurement engine; the signal
 *   declares `unit: 'sqft'`, so anchored geometry (computed in metres against
 *   the US reference table — 80 in doors, 4 in siding courses) converts to sq ft
 * - The exterior envelope is expressed in sq ft per story
 */

import type { VerticalPack } from './types'

export const paintingPackUS: VerticalPack = {
  id: 'painting-decorating-us',
  name: 'Painting (US)',
  description:
    'Interior and exterior house painting plus wallpaper — priced per room and per square foot, with photo-based prep detection.',
  icon: '🎨',
  rateCurrency: 'USD',
  region: 'US',
  services: [
    // ────────────────────────────────────────────────────────────────────
    // Interior painting — per-room pricing
    // ────────────────────────────────────────────────────────────────────
    {
      name: 'Interior Painting',
      description:
        'Interior repaint — walls and ceilings painted per room, with prep work priced from your photos.',
      draft: {
        scope: {
          included: [
            'Two coats of interior latex paint on walls and ceilings',
            'Prep: patching nail holes and minor cracks, light sanding, caulking',
            'Drop cloths and masking to protect floors and furniture',
            'All standard paint and materials',
          ],
          excluded: [
            'Drywall replacement or major repairs',
            'Water-damage or mold remediation (quoted separately after inspection)',
            'Moving heavy furniture',
          ],
          assumptions: [
            'Rooms are accessible and small items are cleared',
            'Standard 8 ft ceilings unless stated',
            'Colors confirmed before work starts',
          ],
        },
        media: {
          minPhotos: 1,
          maxPhotos: 8,
          photoGuidance:
            'Take one wide photo of each room from the doorway, plus close-ups of any damage (cracks, stains, peeling paint).',
          requiredAngles: [
            {
              id: 'room_overview',
              label: 'Each room — wide shot',
              guidance: 'Stand in the doorway and capture the whole room, floor to ceiling',
            },
            {
              id: 'problem_areas',
              label: 'Close-up of any damage',
              guidance: 'Cracks, stains, peeling or flaking paint — skip if walls are in good shape',
            },
          ],
        },
        pricing: {
          pricingModel: 'per_unit',
          unitType: 'room',
          baseFee: 75, // TODO-OWNER: placeholder rate
          minimumCharge: 400, // TODO-OWNER: placeholder rate
          workSteps: [
            {
              id: 'step_rooms',
              name: 'Walls & ceilings',
              description: 'Two coats per room including standard prep',
              costType: 'per_unit',
              defaultCost: 375, // TODO-OWNER: placeholder rate
              optional: false,
              unitLabel: 'room',
              quantitySource: { type: 'form_field', fieldId: 'room_count' },
            },
            {
              id: 'step_heavy_prep',
              name: 'Heavy prep',
              description: 'Extensive patching, sanding and priming where walls are in poor condition',
              costType: 'fixed',
              defaultCost: 250, // TODO-OWNER: placeholder rate
              optional: true,
              triggerSignal: 'prep_level',
              triggerCondition: { operator: 'equals', value: 'heavy' },
            },
          ],
          addOns: [
            {
              name: 'Trim, doors & baseboards',
              price: 200, // TODO-OWNER: placeholder rate
              description: 'Doors, casings and baseboards painted in semi-gloss',
            },
            {
              name: 'Accent wall',
              price: 100, // TODO-OWNER: placeholder rate
              description: 'One wall in a contrasting color or finish',
            },
          ],
          siteVisit: {
            alwaysRecommend: false,
            confidenceBelowPct: 50,
            estimateAbove: 5000,
          },
        },
        expectedSignals: [
          {
            signalKey: 'room_count',
            type: 'number',
            description: 'Number of rooms to be painted',
            // T-138: an on-site LiDAR scan fills the room count exactly
            scan: { measure: 'room_count' },
          },
          {
            signalKey: 'wall_condition',
            type: 'enum',
            possibleValues: ['good', 'fair', 'poor'],
            description: 'Overall condition of wall surfaces visible in photos',
          },
          {
            signalKey: 'prep_level',
            type: 'enum',
            possibleValues: ['light', 'standard', 'heavy'],
            description: 'Prep work needed before painting (from visible cracks, stains, peeling)',
          },
          {
            signalKey: 'ceiling_height',
            type: 'enum',
            possibleValues: ['standard', 'high'],
            description: 'Whether ceilings appear higher than a standard 8 ft',
          },
        ],
        suggestedFields: [
          {
            label: 'How many rooms need painting?',
            fieldId: 'room_count',
            type: 'number',
            required: true,
            criticalForPricing: true,
            mapsToSignal: 'room_count',
            helpText: 'Count each room, hallway or stairwell separately',
          },
          {
            label: 'Ceiling height',
            fieldId: 'ceiling_height_answer',
            type: 'dropdown',
            required: false,
            options: ['Standard (8 ft)', 'High (9 ft or more)'],
            mapsToSignal: 'ceiling_height',
          },
        ],
      },
      addons: [
        {
          id: 'addon_trim',
          label: 'Trim, doors & baseboards',
          price: 200, // TODO-OWNER: placeholder rate
          triggerKeywords: ['trim', 'baseboard', 'baseboards', 'doors', 'door casings', 'semi-gloss'],
        },
        {
          id: 'addon_accent_wall',
          label: 'Accent wall',
          price: 100, // TODO-OWNER: placeholder rate
          triggerKeywords: ['accent wall', 'feature wall'],
        },
      ],
      multipliers: [
        {
          when: { fieldId: 'ceiling_height_answer', operator: 'equals', equals: 'High (9 ft or more)' },
          multiplier: 1.2,
        },
      ],
    },

    // ────────────────────────────────────────────────────────────────────
    // Exterior painting — per sq ft from the measurement engine
    // ────────────────────────────────────────────────────────────────────
    {
      name: 'Exterior Painting',
      description:
        'Exterior siding, stucco and masonry painted per square foot — wall area measured from your photos.',
      draft: {
        scope: {
          included: [
            'Two coats of exterior acrylic paint',
            'Power washing and surface prep',
            'Scraping loose paint, caulking gaps, spot-priming bare wood',
            'Masking windows, doors, fixtures and landscaping',
          ],
          excluded: [
            'Siding or rotten wood replacement',
            'Lead paint abatement (homes built before 1978 need an EPA RRP-certified assessment)',
            'Work in rain or below the paint manufacturer’s temperature limit',
          ],
          assumptions: [
            'Reasonable access around the house',
            'Water and power available on site',
            'A dry weather window to finish',
          ],
        },
        media: {
          minPhotos: 2,
          maxPhotos: 10,
          photoGuidance:
            'Photograph each side of the house from far enough back to see the whole wall, ground to roofline. Add close-ups of any peeling or damaged areas.',
          requiredAngles: [
            {
              id: 'front_elevation',
              label: 'Front of the house',
              guidance: 'Stand well back — capture the whole front wall, ground to roof, including the front door',
            },
            {
              id: 'other_sides',
              label: 'Each other side being painted',
              guidance: 'One wide shot per side, showing the whole wall',
            },
            {
              id: 'surface_damage',
              label: 'Close-up of surface problems',
              guidance: 'Peeling paint, cracked stucco, rot — skip if surfaces are in good shape',
            },
          ],
        },
        pricing: {
          pricingModel: 'per_unit',
          unitType: 'sqft',
          baseFee: 150, // TODO-OWNER: placeholder rate
          minimumCharge: 1200, // TODO-OWNER: placeholder rate
          workSteps: [
            {
              id: 'step_walls_sqft',
              name: 'Exterior walls',
              description: 'Prep and two coats per square foot of wall',
              costType: 'per_unit',
              defaultCost: 2.5, // TODO-OWNER: placeholder rate
              optional: false,
              unitLabel: 'sqft',
              quantitySource: { type: 'ai_signal', signalKey: 'wall_area_sqft' },
            },
            {
              id: 'step_access',
              name: 'Ladders & staging',
              description: 'Extension ladders or lifts for homes of two stories or more',
              costType: 'fixed',
              defaultCost: 350, // TODO-OWNER: placeholder rate
              optional: true,
              triggerSignal: 'stories',
              triggerCondition: { operator: 'gte', value: 2 },
            },
          ],
          addOns: [
            {
              name: 'Gutters, fascia & soffits',
              price: 350, // TODO-OWNER: placeholder rate
              description: 'Roofline trim and gutters painted to match',
            },
            {
              name: 'Front door repaint',
              price: 150, // TODO-OWNER: placeholder rate
              description: 'Front door prepped and repainted in your chosen color',
            },
          ],
          siteVisit: {
            alwaysRecommend: false,
            confidenceBelowPct: 55,
            estimateAbove: 8000,
          },
        },
        expectedSignals: [
          {
            signalKey: 'wall_area_sqft',
            type: 'number',
            unit: 'sqft',
            description: 'Estimated total paintable wall area in square feet across all photographed sides',
            // Plausibility envelope (T-116), in sq ft per story: one side of a
            // story spans roughly [13 ft wide × 8 ft high] to [50 ft × 10 ft];
            // the upper bound leaves room for two photographed sides
            envelope: {
              driverKey: 'stories',
              minPerUnit: 100,
              maxPerUnit: 1000,
              defaultDriver: 2,
              absoluteMin: 80,
              absoluteMax: 6000,
            },
          },
          {
            signalKey: 'stories',
            type: 'number',
            description: 'Number of stories of the house',
          },
          {
            signalKey: 'surface_condition',
            type: 'enum',
            possibleValues: ['good', 'fair', 'poor'],
            description: 'Condition of the siding/stucco surface (peeling, cracking, rot)',
          },
        ],
        suggestedFields: [
          {
            label: 'How many stories is the house?',
            fieldId: 'stories',
            type: 'number',
            required: true,
            criticalForPricing: true,
            mapsToSignal: 'stories',
          },
          {
            label: 'Which sides need painting?',
            fieldId: 'sides_to_paint',
            type: 'dropdown',
            required: false,
            options: ['Front only', 'Front and back', 'All sides'],
            helpText: 'Helps us check the photos cover the whole job',
          },
          {
            label: 'Wall area in square feet — if you know it',
            fieldId: 'wall_area_sqft',
            type: 'number',
            required: false,
            mapsToSignal: 'wall_area_sqft',
            helpText: 'Leave blank and we will measure it from your photos',
          },
        ],
      },
      addons: [
        {
          id: 'addon_roofline',
          label: 'Gutters, fascia & soffits',
          price: 350, // TODO-OWNER: placeholder rate
          triggerKeywords: ['gutter', 'gutters', 'fascia', 'soffit', 'soffits', 'roofline'],
        },
        {
          id: 'addon_front_door',
          label: 'Front door repaint',
          price: 150, // TODO-OWNER: placeholder rate
          triggerKeywords: ['front door', 'door repaint'],
        },
      ],
      multipliers: [],
    },

    // ────────────────────────────────────────────────────────────────────
    // Wallpaper — per-wall pricing with removal option
    // ────────────────────────────────────────────────────────────────────
    {
      name: 'Wallpaper Installation',
      description: 'Wallpaper hung per wall, with optional removal of existing paper.',
      draft: {
        scope: {
          included: [
            'Wall prep: patching, light sanding and primer where needed',
            'Professional hanging with pattern matching',
            'Trimming and finishing around outlets and fixtures',
          ],
          excluded: ['Drywall repair beyond minor patching', 'Wallpaper cost unless we supply it'],
          assumptions: [
            'Walls are sound once existing paper is removed',
            'Wallpaper choice confirmed before the start date',
          ],
        },
        media: {
          minPhotos: 1,
          maxPhotos: 6,
          photoGuidance:
            'One photo of each wall to be papered, straight-on where possible. Include the current wall covering.',
          requiredAngles: [
            {
              id: 'each_wall',
              label: 'Each wall to be papered',
              guidance: 'Straight-on shot showing the whole wall and its current covering',
            },
          ],
        },
        pricing: {
          pricingModel: 'per_unit',
          unitType: 'wall',
          baseFee: 75, // TODO-OWNER: placeholder rate
          minimumCharge: 300, // TODO-OWNER: placeholder rate
          workSteps: [
            {
              id: 'step_hang',
              name: 'Wallpaper hanging',
              description: 'Prep and hanging per wall, pattern-matched',
              costType: 'per_unit',
              defaultCost: 250, // TODO-OWNER: placeholder rate
              optional: false,
              unitLabel: 'wall',
              quantitySource: { type: 'form_field', fieldId: 'wall_count' },
            },
            {
              id: 'step_removal',
              name: 'Existing wallpaper removal',
              description: 'Stripping and disposal of current wallpaper per wall',
              costType: 'per_unit',
              defaultCost: 100, // TODO-OWNER: placeholder rate
              optional: true,
              unitLabel: 'wall',
              triggerSignal: 'needs_removal',
              triggerCondition: { operator: 'equals', value: true },
              quantitySource: { type: 'form_field', fieldId: 'wall_count' },
            },
          ],
          addOns: [
            {
              name: 'Wall liner',
              price: 75, // TODO-OWNER: placeholder rate
              description: 'Liner paper hung first for a smoother finish on uneven walls',
            },
          ],
          siteVisit: {
            alwaysRecommend: false,
            confidenceBelowPct: 50,
            estimateAbove: 3000,
          },
        },
        expectedSignals: [
          {
            signalKey: 'wall_count',
            type: 'number',
            description: 'Number of walls to be papered',
          },
          {
            signalKey: 'needs_removal',
            type: 'boolean',
            description: 'Whether existing wallpaper is present and needs stripping',
          },
          {
            signalKey: 'wall_condition',
            type: 'enum',
            possibleValues: ['good', 'fair', 'poor'],
            description: 'Surface condition of the walls to be papered',
          },
        ],
        suggestedFields: [
          {
            label: 'How many walls need wallpaper?',
            fieldId: 'wall_count',
            type: 'number',
            required: true,
            criticalForPricing: true,
            mapsToSignal: 'wall_count',
          },
          {
            label: 'Does existing wallpaper need removing?',
            fieldId: 'needs_removal',
            type: 'boolean',
            required: true,
            mapsToSignal: 'needs_removal',
          },
          {
            label: 'Who supplies the wallpaper?',
            fieldId: 'wallpaper_supplied',
            type: 'dropdown',
            required: false,
            options: ["I'll supply it", 'Please supply it'],
          },
        ],
      },
      addons: [
        {
          id: 'addon_liner',
          label: 'Wall liner',
          price: 75, // TODO-OWNER: placeholder rate
          triggerKeywords: ['liner', 'lining paper', 'uneven walls'],
        },
      ],
      multipliers: [
        {
          when: { fieldId: 'wallpaper_supplied', operator: 'equals', equals: 'Please supply it' },
          multiplier: 1.15,
        },
      ],
    },
  ],
}
