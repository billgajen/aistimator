/**
 * Painting & Decorating vertical pack (T-114, AD-022).
 *
 * PURE DATA — typical UK decorator defaults the business reviews and edits at
 * onboarding. Nothing here is authoritative pricing; every rate, angle, and
 * question is editable configuration.
 *
 * Design notes:
 * - Interior prices per room (customers can answer room counts exactly)
 * - Exterior prices per sqm from AI wall-area estimation (customers can't
 *   measure render area — this exercises vision + the T-108 confirm step)
 * - requiredAngles drive the T-107 guided-capture slots
 * - expectedSignals give the AI a strict extraction schema and power
 *   low-confidence confirmations
 */

import type { VerticalPack } from './types'

export const paintingPack: VerticalPack = {
  id: 'painting-decorating',
  name: 'Painting & Decorating (UK)',
  description:
    'Interior & exterior painting plus wallpapering — priced per room and per square metre, with photo-based prep detection.',
  icon: '🎨',
  rateCurrency: 'GBP',
  region: 'GB',
  services: [
    // ────────────────────────────────────────────────────────────────────
    // Interior painting — per-room pricing, customer-answerable quantities
    // ────────────────────────────────────────────────────────────────────
    {
      name: 'Interior Painting',
      description:
        'Full interior redecoration — walls and ceilings painted per room, with preparation work priced from your photos.',
      draft: {
        scope: {
          included: [
            'Two coats of emulsion to walls and ceilings',
            'Surface preparation: filling minor cracks, light sanding',
            'Protection of floors and furniture with dust sheets',
            'All standard trade paints and materials',
          ],
          excluded: [
            'Structural repairs or replastering',
            'Damp treatment (quoted separately after inspection)',
            'Moving of heavy furniture',
          ],
          assumptions: [
            'Rooms are accessible and cleared of small items',
            'Standard ceiling height unless stated',
            'Colours confirmed before work starts',
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
              guidance: 'Cracks, stains, peeling or flaking paint — skip if walls are sound',
            },
          ],
        },
        pricing: {
          pricingModel: 'per_unit',
          unitType: 'room',
          baseFee: 60,
          minimumCharge: 250,
          workSteps: [
            {
              id: 'step_rooms',
              name: 'Walls & ceilings',
              description: 'Two-coat emulsion per room including standard prep',
              costType: 'per_unit',
              defaultCost: 200,
              optional: false,
              unitLabel: 'room',
              quantitySource: { type: 'form_field', fieldId: 'room_count' },
            },
            {
              id: 'step_heavy_prep',
              name: 'Heavy preparation',
              description: 'Extensive filling, sanding and sealing where walls are in poor condition',
              costType: 'fixed',
              defaultCost: 150,
              optional: true,
              triggerSignal: 'prep_level',
              triggerCondition: { operator: 'equals', value: 'heavy' },
            },
          ],
          addOns: [
            {
              name: 'Woodwork & trim',
              price: 120,
              description: 'Doors, frames and skirting boards glossed to match',
            },
            {
              name: 'Feature wall (different colour)',
              price: 60,
              description: 'One wall in a contrasting colour or finish',
            },
          ],
          siteVisit: {
            alwaysRecommend: false,
            confidenceBelowPct: 50,
            estimateAbove: 2500,
          },
        },
        expectedSignals: [
          {
            signalKey: 'room_count',
            type: 'number',
            description: 'Number of rooms to be painted',
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
            description: 'Preparation work needed before painting (from visible cracks, stains, peeling)',
          },
          {
            signalKey: 'ceiling_height',
            type: 'enum',
            possibleValues: ['standard', 'high'],
            description: 'Whether ceilings appear higher than a standard 2.6m',
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
            helpText: 'Count each room, hallway or landing separately',
          },
          {
            label: 'Ceiling height',
            fieldId: 'ceiling_height_answer',
            type: 'dropdown',
            required: false,
            options: ['Standard (up to 2.6m)', 'High (over 2.6m)'],
            mapsToSignal: 'ceiling_height',
          },
        ],
      },
      addons: [
        {
          id: 'addon_woodwork',
          label: 'Woodwork & trim',
          price: 120,
          triggerKeywords: ['woodwork', 'skirting', 'doors', 'door frames', 'trim', 'gloss'],
        },
        {
          id: 'addon_feature_wall',
          label: 'Feature wall (different colour)',
          price: 60,
          triggerKeywords: ['feature wall', 'accent wall'],
        },
      ],
      multipliers: [
        {
          when: { fieldId: 'ceiling_height_answer', operator: 'equals', equals: 'High (over 2.6m)' },
          multiplier: 1.2,
        },
      ],
    },

    // ────────────────────────────────────────────────────────────────────
    // Exterior painting — per-sqm from AI wall-area estimation
    // ────────────────────────────────────────────────────────────────────
    {
      name: 'Exterior Painting',
      description:
        'Exterior walls, render and masonry painted per square metre — wall area estimated from your photos.',
      draft: {
        scope: {
          included: [
            'Two coats of exterior masonry paint',
            'Pressure washing and surface preparation',
            'Filling of minor cracks in render',
            'Protection of windows, doors and paths',
          ],
          excluded: [
            'Render repairs beyond minor crack filling',
            'Roofline replacement (fascias/soffits replaced, not painted)',
            'Work in unsafe weather conditions',
          ],
          assumptions: [
            'Reasonable access around the property',
            'Water and power available on site',
            'Dry weather window for completion',
          ],
        },
        media: {
          minPhotos: 2,
          maxPhotos: 10,
          photoGuidance:
            'Photograph each side of the property from far enough back to see the full wall, ground to roofline. Add close-ups of any flaking or cracked areas.',
          requiredAngles: [
            {
              id: 'front_elevation',
              label: 'Front of the property',
              guidance: 'Stand well back — capture the full front wall, ground to roof',
            },
            {
              id: 'other_sides',
              label: 'Each other side being painted',
              guidance: 'One wide shot per side, showing the whole wall',
            },
            {
              id: 'surface_damage',
              label: 'Close-up of surface problems',
              guidance: 'Flaking paint, cracked render, staining — skip if surfaces are sound',
            },
          ],
        },
        pricing: {
          pricingModel: 'per_unit',
          unitType: 'sqm',
          baseFee: 100,
          minimumCharge: 400,
          workSteps: [
            {
              id: 'step_walls_sqm',
              name: 'Exterior walls',
              description: 'Preparation and two-coat masonry paint per square metre',
              costType: 'per_unit',
              defaultCost: 18,
              optional: false,
              unitLabel: 'sqm',
              quantitySource: { type: 'ai_signal', signalKey: 'wall_area_sqm' },
            },
            {
              id: 'step_access',
              name: 'Access equipment',
              description: 'Towers or platforms for properties of two storeys or more',
              costType: 'fixed',
              defaultCost: 250,
              optional: true,
              triggerSignal: 'storeys',
              triggerCondition: { operator: 'gte', value: 2 },
            },
          ],
          addOns: [
            {
              name: 'Gutters, fascias & soffits',
              price: 180,
              description: 'Roofline woodwork and guttering painted to match',
            },
            {
              name: 'Front door repaint',
              price: 90,
              description: 'Front door prepared and repainted in your chosen colour',
            },
          ],
          siteVisit: {
            alwaysRecommend: false,
            confidenceBelowPct: 55,
            estimateAbove: 4000,
          },
        },
        expectedSignals: [
          {
            signalKey: 'wall_area_sqm',
            type: 'number',
            description: 'Estimated total paintable wall area in square metres across all photographed sides',
            // Plausibility envelope (T-116): per storey, a painted elevation
            // spans roughly [4m wide × 2.3m high] to [12m wide × 3.0m high]
            envelope: {
              driverKey: 'storeys',
              minPerUnit: 9,
              maxPerUnit: 36,
              defaultDriver: 2,
              absoluteMin: 8,
              absoluteMax: 500,
            },
          },
          {
            signalKey: 'storeys',
            type: 'number',
            description: 'Number of storeys of the property',
          },
          {
            signalKey: 'render_condition',
            type: 'enum',
            possibleValues: ['good', 'fair', 'poor'],
            description: 'Condition of the render/masonry surface (flaking, cracking, staining)',
          },
        ],
        suggestedFields: [
          {
            label: 'How many storeys is the property?',
            fieldId: 'storeys',
            type: 'number',
            required: true,
            criticalForPricing: true,
            mapsToSignal: 'storeys',
          },
          {
            label: 'Which sides need painting?',
            fieldId: 'sides_to_paint',
            type: 'dropdown',
            required: false,
            options: ['Front only', 'Front and back', 'All sides'],
            helpText: 'Helps us check the photo coverage matches the job',
          },
        ],
      },
      addons: [
        {
          id: 'addon_roofline',
          label: 'Gutters, fascias & soffits',
          price: 180,
          triggerKeywords: ['gutter', 'gutters', 'fascia', 'fascias', 'soffit', 'soffits', 'roofline'],
        },
        {
          id: 'addon_front_door',
          label: 'Front door repaint',
          price: 90,
          triggerKeywords: ['front door', 'door repaint'],
        },
      ],
      multipliers: [],
    },

    // ────────────────────────────────────────────────────────────────────
    // Wallpapering — per-wall pricing with removal option
    // ────────────────────────────────────────────────────────────────────
    {
      name: 'Wallpapering',
      description:
        'Wallpaper hanging priced per wall, with optional removal of existing paper.',
      draft: {
        scope: {
          included: [
            'Wall preparation: light sanding and lining where needed',
            'Professional hanging with pattern matching',
            'Trimming and finishing around sockets and fittings',
          ],
          excluded: [
            'Replastering of damaged walls',
            'Wallpaper cost unless we supply it',
          ],
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
              guidance: 'Straight-on shot showing the full wall and its current covering',
            },
          ],
        },
        pricing: {
          pricingModel: 'per_unit',
          unitType: 'wall',
          baseFee: 40,
          minimumCharge: 150,
          workSteps: [
            {
              id: 'step_hang',
              name: 'Wallpaper hanging',
              description: 'Preparation and hanging per wall, pattern-matched',
              costType: 'per_unit',
              defaultCost: 140,
              optional: false,
              unitLabel: 'wall',
              quantitySource: { type: 'form_field', fieldId: 'wall_count' },
            },
            {
              id: 'step_removal',
              name: 'Existing wallpaper removal',
              description: 'Stripping and disposal of current wallpaper per wall',
              costType: 'per_unit',
              defaultCost: 50,
              optional: true,
              unitLabel: 'wall',
              triggerSignal: 'needs_removal',
              triggerCondition: { operator: 'equals', value: true },
              quantitySource: { type: 'form_field', fieldId: 'wall_count' },
            },
          ],
          addOns: [
            {
              name: 'Lining paper',
              price: 45,
              description: 'Lining paper hung first for a smoother finish on uneven walls',
            },
          ],
          siteVisit: {
            alwaysRecommend: false,
            confidenceBelowPct: 50,
            estimateAbove: 1500,
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
            label: 'How many walls need papering?',
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
          id: 'addon_lining',
          label: 'Lining paper',
          price: 45,
          triggerKeywords: ['lining paper', 'lining', 'uneven walls'],
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
