import { describe, it, expect } from 'vitest'
import { missingRequired, toSubmissionAnswers, visibleFields, type AppField } from '../lib/answers'
import { headlinePrice, isPricing, statusLabel } from '../lib/price'
import { createApi, fieldsForService, ApiError, type WidgetConfigResponse } from '../lib/api'

const fields: AppField[] = [
  { fieldId: '_project_description', label: 'Describe', type: 'text' },
  { fieldId: 'run_length_ft', label: 'Run length', type: 'number', required: true },
  { fieldId: 'charger_supply', label: 'Charger', type: 'select', required: true, options: [{ value: 'yes', label: 'Yes' }] },
  { fieldId: 'notes', label: 'Notes', type: 'text' },
  { fieldId: 'has_dog', label: 'Dog?', type: 'boolean' },
]

describe('answers', () => {
  it('hides internal fields', () => {
    expect(visibleFields(fields).map((f) => f.fieldId)).toEqual(['run_length_ft', 'charger_supply', 'notes', 'has_dog'])
  })

  it('lists missing required fields; a non-numeric number is missing', () => {
    expect(missingRequired(fields, {})).toEqual(['Run length', 'Charger'])
    expect(missingRequired(fields, { run_length_ft: 'about 40', charger_supply: 'yes' })).toEqual(['Run length'])
    expect(missingRequired(fields, { run_length_ft: '40', charger_supply: 'yes' })).toEqual([])
  })

  it('types answers and adds the description', () => {
    expect(toSubmissionAnswers(fields, { run_length_ft: '1,200', charger_supply: 'yes', notes: '', has_dog: true }, ' Garage wall ')).toEqual([
      { fieldId: '_project_description', value: 'Garage wall' },
      { fieldId: 'run_length_ft', value: 1200 },
      { fieldId: 'charger_supply', value: 'yes' },
      { fieldId: 'has_dog', value: true },
    ])
  })
})

describe('price', () => {
  const base = { pricing: { total: 2880, currency: 'USD', estimate: { grade: 'A' as const, label: 'Confirmed', description: '' } } }

  it('exact total when confirmed; range while provisional', () => {
    expect(headlinePrice({ ...base, status: 'sent' })).toBe('$2,880.00')
    expect(
      headlinePrice({ status: 'awaiting_clarification', pricing: { total: 300, currency: 'USD', estimate: { grade: 'C', label: 'Concept', description: '', rangeLow: 2300, rangeHigh: 4100 } } })
    ).toBe('$2,300–$4,100')
    expect(headlinePrice({ ...base, status: 'generating' })).toBe('Pricing…')
  })

  it('labels and pricing states', () => {
    expect(statusLabel('awaiting_clarification')).toBe('Needs a confirmation')
    expect(statusLabel('something_new')).toBe('something_new')
    expect(isPricing('queued')).toBe(true)
    expect(isPricing('sent')).toBe(false)
  })
})

describe('api client', () => {
  function fakeFetch(responses: Array<{ status: number; body: unknown }>) {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    const fetchImpl = async (url: string, init?: RequestInit) => {
      calls.push({ url, init })
      const r = responses.shift() ?? { status: 200, body: {} }
      return new Response(typeof r.body === 'string' ? r.body : JSON.stringify(r.body), { status: r.status })
    }
    return { calls, fetchImpl }
  }

  it('sends the bearer token to business endpoints, none to public ones', async () => {
    const { calls, fetchImpl } = fakeFetch([
      { status: 200, body: { tenantKey: 'tk', tenantName: 'X' } },
      { status: 200, body: { services: [] } },
    ])
    const api = createApi({ baseUrl: 'https://app.test/', getAccessToken: async () => 'jwt', fetch: fetchImpl })
    await api.bootstrap()
    await api.widgetConfig('tk')
    expect(calls[0]!.url).toBe('https://app.test/api/app/bootstrap')
    expect((calls[0]!.init!.headers as Record<string, string>).Authorization).toBe('Bearer jwt')
    expect((calls[1]!.init!.headers as Record<string, string>).Authorization).toBeUndefined()
  })

  it('surfaces the API error message and code', async () => {
    const { fetchImpl } = fakeFetch([{ status: 400, body: { error: { code: 'VALIDATION_ERROR', message: 'Missing critical fields' } } }])
    const api = createApi({ baseUrl: 'https://app.test', getAccessToken: async () => 'jwt', fetch: fetchImpl })
    await expect(api.getQuote('q1')).rejects.toMatchObject({ status: 400, code: 'VALIDATION_ERROR', message: 'Missing critical fields' })
  })

  it('refuses business calls when signed out', async () => {
    const api = createApi({ baseUrl: 'https://app.test', getAccessToken: async () => null, fetch: async () => new Response('{}') })
    await expect(api.listQuotes()).rejects.toBeInstanceOf(ApiError)
  })

  it('uploads photos through signed URLs and returns asset ids in order', async () => {
    const { calls, fetchImpl } = fakeFetch([
      { status: 200, body: { uploads: [{ assetId: 'a1', uploadUrl: 'https://r2.test/1' }, { assetId: 'a2', uploadUrl: 'https://r2.test/2' }] } },
      { status: 200, body: '' },
      { status: 200, body: '' },
    ])
    const api = createApi({ baseUrl: 'https://app.test', getAccessToken: async () => 'jwt', fetch: fetchImpl, readFile: async () => new Blob(['x']) })
    const ids = await api.uploadPhotos('tk', [
      { uri: 'file://1', fileName: '1.jpg', contentType: 'image/jpeg', sizeBytes: 1 },
      { uri: 'file://2', fileName: '2.jpg', contentType: 'image/jpeg', sizeBytes: 1 },
    ])
    expect(ids).toEqual(['a1', 'a2'])
    expect(calls.map((c) => c.init?.method)).toEqual(['POST', 'PUT', 'PUT'])
  })

  it('answers carry the stored quote token when there is one', async () => {
    const { calls, fetchImpl } = fakeFetch([{ status: 200, body: { success: true } }])
    const api = createApi({ baseUrl: 'https://app.test', getAccessToken: async () => 'jwt', fetch: fetchImpl })
    await api.answerQuestions('q1', [{ questionId: 'c1', answer: '3 ton' }], 'tok')
    expect(JSON.parse(String(calls[0]!.init!.body))).toEqual({ answers: [{ questionId: 'c1', answer: '3 ton' }], quoteToken: 'tok' })
  })
})

describe('fieldsForService', () => {
  it('global fields first, then the service fields, de-duplicated', () => {
    const cfg = {
      tenantName: 'X',
      services: [],
      globalFields: [{ fieldId: 'a', label: 'A' }],
      serviceFields: { s1: [{ fieldId: 'a', label: 'A2' }, { fieldId: 'b', label: 'B' }] },
    } as WidgetConfigResponse
    expect(fieldsForService(cfg, 's1').map((f) => f.label)).toEqual(['A', 'B'])
  })
})
