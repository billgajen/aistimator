/**
 * Tests for Gemini structured output schemas
 *
 * Validates that schema constants are well-formed JSON Schema
 * and contain the expected required fields.
 */

import { describe, it, expect } from 'vitest'
import {
  EXTRACTED_SIGNALS_SCHEMA,
  QUOTE_CONTENT_SCHEMA,
  ADDON_DETECTION_SCHEMA,
  INVENTORY_DETECTION_SCHEMA,
  CATALOG_MATCHING_SCHEMA,
  SERVICE_MATCH_SCHEMA,
} from '../ai/schemas'

describe('Gemini JSON Schemas', () => {
  function assertValidSchema(schema: Record<string, unknown>) {
    expect(schema).toBeDefined()
    expect(typeof schema).toBe('object')
    expect(schema.type).toBeDefined()
  }

  function assertObjectSchema(schema: Record<string, unknown>, requiredFields: string[]) {
    assertValidSchema(schema)
    expect(schema.type).toBe('object')
    expect(schema.properties).toBeDefined()
    expect(typeof schema.properties).toBe('object')

    if (requiredFields.length > 0) {
      expect(schema.required).toBeDefined()
      expect(Array.isArray(schema.required)).toBe(true)
      for (const field of requiredFields) {
        expect((schema.required as string[]).includes(field)).toBe(true)
      }
    }
  }

  describe('EXTRACTED_SIGNALS_SCHEMA', () => {
    it('should be a valid object schema', () => {
      assertObjectSchema(EXTRACTED_SIGNALS_SCHEMA, [
        'confidence',
        'siteVisitRecommended',
        'materials',
        'complexity',
        'observations',
        'warnings',
      ])
    })

    it('should define all expected properties', () => {
      const props = EXTRACTED_SIGNALS_SCHEMA.properties as Record<string, unknown>
      expect(props.confidence).toBeDefined()
      expect(props.siteVisitRecommended).toBeDefined()
      expect(props.dimensions).toBeDefined()
      expect(props.condition).toBeDefined()
      expect(props.complexity).toBeDefined()
      expect(props.access).toBeDefined()
      expect(props.observations).toBeDefined()
      expect(props.warnings).toBeDefined()
      expect(props.detectedConditions).toBeDefined()
      expect(props.assessedCondition).toBeDefined()
      expect(props.countedItems).toBeDefined()
      expect(props.customerStatedQuantity).toBeDefined()
      expect(props.signals).toBeDefined()
    })

    it('should have correct detectedConditions enum values', () => {
      const props = EXTRACTED_SIGNALS_SCHEMA.properties as Record<string, Record<string, unknown>>
      const detectedConditions = props.detectedConditions
      expect(detectedConditions).toBeDefined()
      const conditionsItems = (detectedConditions as { items: Record<string, unknown> }).items
      expect(conditionsItems.enum).toBeDefined()
      const enumValues = conditionsItems.enum as string[]
      expect(enumValues).toContain('oil_stains')
      expect(enumValues).toContain('water_damage')
      expect(enumValues).toContain('pest_damage')
      expect(enumValues.length).toBe(16)
    })
  })

  describe('QUOTE_CONTENT_SCHEMA', () => {
    it('should be a valid object schema with all required fields', () => {
      assertObjectSchema(QUOTE_CONTENT_SCHEMA, [
        'scopeSummary',
        'assumptions',
        'exclusions',
        'notes',
        'validityDays',
      ])
    })

    it('should define assumptions and exclusions as string arrays', () => {
      const props = QUOTE_CONTENT_SCHEMA.properties as Record<string, Record<string, unknown>>
      const assumptions = props.assumptions
      expect(assumptions).toBeDefined()
      expect(assumptions!.type).toBe('array')
      expect((assumptions!.items as Record<string, unknown>).type).toBe('string')
      const exclusions = props.exclusions
      expect(exclusions).toBeDefined()
      expect(exclusions!.type).toBe('array')
      expect((exclusions!.items as Record<string, unknown>).type).toBe('string')
    })
  })

  describe('ADDON_DETECTION_SCHEMA', () => {
    it('should be a valid array schema', () => {
      assertValidSchema(ADDON_DETECTION_SCHEMA)
      expect(ADDON_DETECTION_SCHEMA.type).toBe('array')
    })

    it('should define items with required fields', () => {
      const items = ADDON_DETECTION_SCHEMA.items as Record<string, unknown>
      expect(items.type).toBe('object')
      expect((items.required as string[])).toContain('addonId')
      expect((items.required as string[])).toContain('reason')
      expect((items.required as string[])).toContain('confidence')
    })
  })

  describe('INVENTORY_DETECTION_SCHEMA', () => {
    it('should be a valid object schema', () => {
      assertObjectSchema(INVENTORY_DETECTION_SCHEMA, ['detectedItems'])
    })

    it('should define detectedItems as array', () => {
      const props = INVENTORY_DETECTION_SCHEMA.properties as Record<string, Record<string, unknown>>
      const detectedItems = props.detectedItems
      expect(detectedItems).toBeDefined()
      expect(detectedItems!.type).toBe('array')
    })
  })

  describe('CATALOG_MATCHING_SCHEMA', () => {
    it('should be a valid object schema', () => {
      assertObjectSchema(CATALOG_MATCHING_SCHEMA, ['matches'])
    })
  })

  describe('SERVICE_MATCH_SCHEMA', () => {
    it('should be a valid object schema with required fields', () => {
      assertObjectSchema(SERVICE_MATCH_SCHEMA, ['isMatch', 'confidence', 'reason'])
    })
  })
})
