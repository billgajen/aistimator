import { describe, it, expect } from 'vitest'
import { fieldKind, isAnswered, missingRequired, toSubmissionAnswers, toggleOption, visibleFields, type AppField } from '../lib/answers'
import { createApi, fieldsForService, toApiError, ApiError, type WidgetConfigResponse } from '../lib/api'

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

  it('asks each question the way the website form does', () => {
    expect(fieldKind({ type: 'select', options: ['a', 'b'] })).toBe('choice')
    expect(fieldKind({ type: 'radio', options: ['a', 'b'] })).toBe('choice')
    expect(fieldKind({ type: 'checkbox', options: ['a', 'b'] })).toBe('multi')
    expect(fieldKind({ type: 'boolean' })).toBe('yesno')
    expect(fieldKind({ type: 'number' })).toBe('number')
    expect(fieldKind({ type: 'textarea' })).toBe('long')
    expect(fieldKind({ type: 'text' })).toBe('text')
    expect(fieldKind({})).toBe('text')
  })

  it('a yes/no question answered "No" is answered; tick boxes send a list', () => {
    const yesNo: AppField = { fieldId: 'access', label: 'Access?', type: 'boolean', required: true }
    const ticks: AppField = { fieldId: 'extras', label: 'Extras', type: 'checkbox', required: true, options: ['one', 'two', 'three'] }
    expect(missingRequired([yesNo, ticks], {})).toEqual(['Access?', 'Extras'])
    expect(missingRequired([yesNo, ticks], { access: false, extras: [] })).toEqual(['Extras'])
    expect(isAnswered(yesNo, false)).toBe(true)
    const picked = toggleOption(toggleOption(undefined, 'one'), 'three')
    expect(picked).toEqual(['one', 'three'])
    expect(toggleOption(picked, 'one')).toEqual(['three'])
    expect(toSubmissionAnswers([yesNo, ticks], { access: false, extras: picked }, '')).toEqual([
      { fieldId: 'access', value: false },
      { fieldId: 'extras', value: ['one', 'three'] },
    ])
  })
})

describe('api client', () => {
  function fakeFetch(responses: Array<{ status: number; body: unknown; headers?: Record<string, string> }>) {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    const fetchImpl = async (url: string, init?: RequestInit) => {
      calls.push({ url, init })
      const r = responses.shift() ?? { status: 200, body: {} }
      return new Response(typeof r.body === 'string' ? r.body : JSON.stringify(r.body), { status: r.status, headers: r.headers })
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

  it('surfaces the API error message and code; a refused request is not worth trying again', async () => {
    const { fetchImpl } = fakeFetch([{ status: 400, body: { error: { code: 'VALIDATION_ERROR', message: 'Missing critical fields' } } }])
    const api = createApi({ baseUrl: 'https://app.test', getAccessToken: async () => 'jwt', fetch: fetchImpl })
    const error = await api.getQuote('q1').catch((e: unknown) => e as ApiError)
    expect(error).toMatchObject({ status: 400, code: 'VALIDATION_ERROR', message: 'Missing critical fields', retryable: false, offline: false })
  })

  it('refuses business calls when signed out', async () => {
    const api = createApi({ baseUrl: 'https://app.test', getAccessToken: async () => null, fetch: async () => new Response('{}') })
    await expect(api.listQuotes()).rejects.toBeInstanceOf(ApiError)
  })

  it('no signal is an error that says so, and can be tried again', async () => {
    const api = createApi({
      baseUrl: 'https://app.test',
      getAccessToken: async () => 'jwt',
      fetch: async () => {
        throw new TypeError('Network request failed')
      },
    })
    const error = await api.getQuote('q1').catch((e: unknown) => e as ApiError)
    expect(error).toMatchObject({ status: 0, code: 'NETWORK', offline: true, retryable: true })
    expect(toApiError(new TypeError('x'))).toMatchObject({ offline: true })
  })

  it('a request that gets no answer in time counts as no signal', async () => {
    const api = createApi({
      baseUrl: 'https://app.test',
      getAccessToken: async () => 'jwt',
      timeoutMs: 20,
      fetch: (_url, init) => new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))),
    })
    await expect(api.getQuote('q1')).rejects.toMatchObject({ offline: true })
  })

  it('a rate limit is waited out for as long as the server asks: from the body, or from Retry-After', async () => {
    const { fetchImpl } = fakeFetch([
      { status: 429, body: { error: { code: 'RATE_LIMITED', message: 'Too many requests', retryAfterSeconds: 42 } } },
      { status: 429, body: { error: { code: 'RATE_LIMITED', message: 'Too many requests' } }, headers: { 'Retry-After': '17' } },
      { status: 503, body: 'down' },
    ])
    const api = createApi({ baseUrl: 'https://app.test', getAccessToken: async () => 'jwt', fetch: fetchImpl })
    expect(await api.bootstrap().catch((e: unknown) => e)).toMatchObject({ status: 429, retryable: true, retryAfterSeconds: 42 })
    expect(await api.bootstrap().catch((e: unknown) => e)).toMatchObject({ status: 429, retryable: true, retryAfterSeconds: 17 })
    expect(await api.bootstrap().catch((e: unknown) => e)).toMatchObject({ status: 503, retryable: true })
  })

  it("starts one photo's upload with its real size; a refused file says why and is not tried again", async () => {
    const { calls, fetchImpl } = fakeFetch([
      { status: 200, body: { uploads: [{ assetId: 'a1', uploadUrl: 'https://r2.test/1' }] } },
      { status: 400, body: { error: { code: 'VALIDATION_ERROR', message: 'All files failed validation', details: [{ fileName: 'big.jpg', error: 'File too large. Maximum size: 10MB' }] } } },
    ])
    const api = createApi({ baseUrl: 'https://app.test', getAccessToken: async () => 'jwt', fetch: fetchImpl })
    expect(await api.startUpload('tk', { fileName: '1.jpg', contentType: 'image/jpeg', sizeBytes: 123456 })).toEqual({ assetId: 'a1', uploadUrl: 'https://r2.test/1' })
    expect(JSON.parse(String(calls[0]!.init!.body))).toEqual({ tenantKey: 'tk', files: [{ fileName: '1.jpg', contentType: 'image/jpeg', sizeBytes: 123456 }] })
    // the public upload route takes no sign-in
    expect((calls[0]!.init!.headers as Record<string, string>).Authorization).toBeUndefined()
    const refused = await api.startUpload('tk', { fileName: 'big.jpg', contentType: 'image/jpeg', sizeBytes: 99_000_000 }).catch((e: unknown) => e)
    expect(refused).toMatchObject({ status: 400, retryable: false, message: 'File too large. Maximum size: 10MB' })
  })

  it('creates a quote with the id that makes a repeat safe, and with no email when none was given', async () => {
    const { calls, fetchImpl } = fakeFetch([{ status: 200, body: { quoteId: 'q1', status: 'queued', quoteViewUrl: 'https://app.test/q/q1?token=t' } }])
    const api = createApi({ baseUrl: 'https://app.test', getAccessToken: async () => 'jwt', fetch: fetchImpl })
    await api.createQuote({ serviceId: 's1', customer: { name: 'Megan Grant' }, assetIds: ['a1'], clientRequestId: 'app-abc12345' })
    expect(calls[0]!.url).toBe('https://app.test/api/app/quotes')
    expect(JSON.parse(String(calls[0]!.init!.body))).toEqual({ serviceId: 's1', customer: { name: 'Megan Grant' }, assetIds: ['a1'], clientRequestId: 'app-abc12345' })
  })

  it('asks for a link, prices a held request and reads the account line on the dashboard routes', async () => {
    const { calls, fetchImpl } = fakeFetch([
      { status: 200, body: { quoteViewUrl: 'https://app.test/q/q1?token=new' } },
      { status: 402, body: { error: { code: 'PLAN_LIMIT_REACHED', message: 'Your 10 free quotes are used. Pick a plan to price this lead.' } } },
      { status: 200, body: { notice: { kind: 'suspended', line: 'Your account is paused.' } } },
      { status: 200, body: { notice: null } },
    ])
    const api = createApi({ baseUrl: 'https://app.test', getAccessToken: async () => 'jwt', fetch: fetchImpl })
    expect((await api.quoteLink('q1')).quoteViewUrl).toBe('https://app.test/q/q1?token=new')
    expect(calls[0]!.url).toBe('https://app.test/api/quotes/q1/link')
    expect(JSON.parse(String(calls[0]!.init!.body))).toEqual({ force: true })
    // the plan limit is the server's answer, shown as it is; the app never works round it
    expect(await api.priceHeldRequest('q1').catch((e: unknown) => e)).toMatchObject({ status: 402, code: 'PLAN_LIMIT_REACHED', retryable: false })
    expect(calls[1]!.url).toBe('https://app.test/api/quotes/q1/process')
    expect(await api.accountNotice()).toEqual({ kind: 'suspended', line: 'Your account is paused.' })
    expect(await api.accountNotice()).toBeNull()
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
