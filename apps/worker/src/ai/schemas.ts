/**
 * Centralized JSON Schema definitions for Gemini structured output.
 *
 * These schemas use Gemini API's subset of JSON Schema format.
 * They enforce typed, validated responses directly from the model.
 */

/**
 * Schema for ExtractedSignals (legacy format) with optional V2 signals array.
 * Used by extractStructuredSignals() for vision-based signal extraction.
 */
export const EXTRACTED_SIGNALS_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    confidence: {
      type: 'number',
      description: 'Overall confidence in the extraction (0-1)',
    },
    siteVisitRecommended: {
      type: 'boolean',
      description: 'Whether a site visit is recommended',
    },
    siteVisitReason: {
      type: 'string',
      description: 'Reason for site visit recommendation',
    },
    category: {
      type: 'string',
      description: 'Detected job category',
    },
    materials: {
      type: 'array',
      items: { type: 'string' },
      description: 'Detected materials',
    },
    dimensions: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          enum: ['area', 'linear', 'count', 'room'],
        },
        value: { type: 'number' },
        unit: { type: 'string' },
        isEstimate: { type: 'boolean' },
      },
      required: ['type', 'value', 'unit', 'isEstimate'],
    },
    condition: {
      type: 'object',
      properties: {
        rating: {
          type: 'string',
          enum: ['excellent', 'good', 'fair', 'poor', 'unknown'],
        },
        notes: { type: 'string' },
      },
      required: ['rating'],
    },
    complexity: {
      type: 'object',
      properties: {
        level: {
          type: 'string',
          enum: ['low', 'medium', 'high', 'unknown'],
        },
        factors: {
          type: 'array',
          items: { type: 'string' },
        },
      },
      required: ['level', 'factors'],
    },
    access: {
      type: 'object',
      properties: {
        difficulty: {
          type: 'string',
          enum: ['easy', 'moderate', 'difficult', 'unknown'],
        },
        notes: { type: 'string' },
      },
      required: ['difficulty'],
    },
    observations: {
      type: 'array',
      items: { type: 'string' },
      description: 'Key observations from the images',
    },
    warnings: {
      type: 'array',
      items: { type: 'string' },
      description: 'Concerns or flags',
    },
    detectedConditions: {
      type: 'array',
      items: {
        type: 'string',
        enum: [
          'oil_stains', 'rust_stains', 'weed_growth', 'moss_growth',
          'mold_mildew', 'graffiti', 'chewing_gum', 'paint_overspray',
          'concrete_damage', 'wood_rot', 'heavy_soiling', 'algae_buildup',
          'efflorescence', 'pest_damage', 'water_damage', 'sun_damage',
        ],
      },
    },
    assessedCondition: {
      type: 'string',
      enum: ['excellent', 'good', 'fair', 'poor'],
    },
    countedItems: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          itemType: { type: 'string' },
          location: { type: 'string' },
          details: { type: 'string' },
          confidence: { type: 'number' },
        },
        required: ['itemType', 'location', 'confidence'],
      },
    },
    customerStatedQuantity: {
      type: 'number',
      description: 'Quantity stated by customer in their notes',
    },
    signals: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          key: { type: 'string' },
          value: { type: 'string', description: 'String, number, or boolean as string' },
          confidence: { type: 'number' },
          source: {
            type: 'string',
            enum: ['vision', 'form', 'nlp', 'inferred'],
          },
          evidence: { type: 'string' },
        },
        required: ['key', 'value', 'confidence', 'source'],
      },
      description: 'Structured signals matching expectedSignals config',
    },
  },
  required: ['confidence', 'siteVisitRecommended', 'materials', 'complexity', 'observations', 'warnings'],
}

/**
 * Schema for QuoteContent (wording generation output).
 * Used by generateWording() for professional quote content.
 */
export const QUOTE_CONTENT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    scopeSummary: {
      type: 'string',
      description: '2-4 sentences describing what work is included',
    },
    assumptions: {
      type: 'array',
      items: { type: 'string' },
      description: 'List of assumptions being made',
    },
    exclusions: {
      type: 'array',
      items: { type: 'string' },
      description: 'List of what is NOT included',
    },
    notes: {
      type: 'string',
      description: 'Additional notes or recommendations',
    },
    validityDays: {
      type: 'number',
      description: 'Quote validity in days (typically 30)',
    },
  },
  required: ['scopeSummary', 'assumptions', 'exclusions', 'notes', 'validityDays'],
}

/**
 * Schema for addon detection from customer description.
 */
export const ADDON_DETECTION_SCHEMA: Record<string, unknown> = {
  type: 'array',
  items: {
    type: 'object',
    properties: {
      addonId: {
        type: 'string',
        description: 'The exact addon ID from the available list',
      },
      reason: {
        type: 'string',
        description: 'Brief explanation of why this addon is needed',
      },
      confidence: {
        type: 'number',
        description: 'Confidence score 0-1',
      },
    },
    required: ['addonId', 'reason', 'confidence'],
  },
}

/**
 * Schema for inventory item detection from images.
 */
export const INVENTORY_DETECTION_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    detectedItems: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          itemType: {
            type: 'string',
            description: 'Specific item name',
          },
          quantity: {
            type: 'number',
            description: 'Count of visible items',
          },
          confidence: {
            type: 'number',
            description: 'Confidence score 0-1',
          },
          description: {
            type: 'string',
            description: 'Details about color, material, style',
          },
        },
        required: ['itemType', 'quantity', 'confidence'],
      },
    },
  },
  required: ['detectedItems'],
}

/**
 * Schema for catalog item matching.
 */
export const CATALOG_MATCHING_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    matches: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          detectedIndex: {
            type: 'number',
            description: 'Index of detected item in the input list',
          },
          catalogId: {
            type: 'string',
            description: 'Catalog item ID',
          },
          matchConfidence: {
            type: 'number',
            description: 'Match confidence 0-1',
          },
        },
        required: ['detectedIndex', 'catalogId', 'matchConfidence'],
      },
    },
  },
  required: ['matches'],
}

/**
 * Schema for service match validation.
 */
export const SERVICE_MATCH_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    isMatch: {
      type: 'boolean',
      description: 'Whether the description matches the selected service',
    },
    confidence: {
      type: 'number',
      description: 'Confidence score 0-1',
    },
    suggestedServiceId: {
      type: 'string',
      description: 'Suggested alternative service ID, or null',
    },
    suggestedServiceName: {
      type: 'string',
      description: 'Suggested alternative service name, or null',
    },
    reason: {
      type: 'string',
      description: 'Brief explanation',
    },
  },
  required: ['isMatch', 'confidence', 'reason'],
}
