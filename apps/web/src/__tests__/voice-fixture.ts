/**
 * T-210, T-211: a business and a call session as the voice test's loader and routes hand them over,
 * for the unit tests. Its two services are priced from made-up rules; nothing here is a real business.
 */
import { getRegion } from '@qolumns/shared'
import type { WorkerPreview } from '@/lib/pricing-preview'
import type { VoiceBusiness } from '@/lib/voice/business'
import { NO_NOTES, type CallSession } from '@/lib/voice/session'
import type { ToolCall } from '@/lib/voice/tools'

export function business(over: Partial<VoiceBusiness> = {}): VoiceBusiness {
  const us = getRegion('US')
  return {
    id: 'tnt_one',
    name: 'Harlow Works',
    region: 'US',
    locale: us.locale,
    languageVariant: us.copy.languageVariant,
    emergencyNumber: us.emergencyNumber,
    speechLanguage: us.speechLanguage,
    country: us.name,
    contactRequirement: 'email',
    timeZone: 'America/New_York',
    currency: 'USD',
    serviceArea: { everywhere: false, areas: ['63021', 'Missouri'], postalCodeLabel: 'ZIP code' },
    terms: 'Half is due before work starts.',
    services: [
      {
        id: 'svc_a',
        name: 'Service A',
        description: 'The first service.',
        included: ['Part one'],
        notIncluded: ['Part nine'],
        assumptions: ['Access from the ground'],
        questions: [
          { id: 'size', question: 'How large is it?', type: 'number', required: true, choices: [], help: null },
          { id: 'finish', question: 'Which finish?', type: 'select', required: false, choices: [{ value: 'std', label: 'Standard' }, { value: 'prem', label: 'Premium' }], help: null },
          { id: 'rush', question: 'Is it urgent?', type: 'boolean', required: false, choices: [], help: null },
        ],
        measurements: [{ id: 'measured_area', what: 'Area read from photos', unit: 'sq ft' }],
        row: { id: 'svc_a', name: 'Service A' },
        rules: { baseFee: 0 },
        fields: [
          { fieldId: 'size', type: 'number', label: 'How large is it?', required: true },
          { fieldId: 'finish', type: 'select', label: 'Which finish?', required: false, options: [{ value: 'std', label: 'Standard' }, { value: 'prem', label: 'Premium' }] },
          { fieldId: 'rush', type: 'boolean', label: 'Is it urgent?', required: false },
        ],
      },
      { id: 'svc_b', name: 'Service B', description: null, included: [], notIncluded: [], assumptions: [], questions: [], measurements: [], row: { id: 'svc_b', name: 'Service B' }, rules: null, fields: [] },
    ],
    ...over,
  }
}

export const priced = (over: Partial<Extract<WorkerPreview, { success: true }>> = {}): WorkerPreview => ({ success: true, currency: 'USD', lines: [{ label: 'Base', amount: 75 }, { label: 'Work', amount: 375 }], subtotal: 450, taxAmount: 0, total: 450, notes: [], steps: [], unmeasured: [], ...over })

/** A Friday afternoon in New York */
export const NOW = new Date('2026-11-27T15:00:00Z')

export const session = (over: Partial<CallSession> = {}): CallSession => ({
  v: 2, callId: 'call-1', tenantId: 'tnt_one', adminId: 'admin-1', engine: 'gemini', voice: 'Aoede',
  contact: { name: 'Dana Reyes', email: 'dana@example.com', phone: '(555) 201-3434' },
  deviceId: 'device-0123456789abcdef', ipHash: 'a'.repeat(32), notes: NO_NOTES, exp: 2_000_000_000,
  ...over,
})

/** A tool call for the fixture business, with the session's details and notes */
export const call = (over: { business?: Partial<VoiceBusiness>; session?: Partial<CallSession> } = {}): ToolCall => ({ business: business(over.business), session: session(over.session) })
