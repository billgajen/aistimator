/**
 * Typed client for the web API (no React Native imports, testable).
 *
 * Business endpoints authenticate with the signed-in user's Supabase access
 * token as a bearer (the web app accepts it in place of the session cookie,
 * under the same row-level security). Photo uploads and the service form go
 * through the same public endpoints the website form uses, keyed by the
 * tenant key from /api/app/bootstrap.
 *
 * T-182: every failure is an `ApiError` that says whether trying again can
 * help (no signal, a time-out, the server busy, a rate limit) or not (the
 * request itself was refused). The sending queue (outbox.ts) decides from
 * that alone, so a lost signal never loses a quote.
 */

import type {
  AppAccountResponse,
  AppBootstrapResponse,
  AppCreateQuoteRequest,
  AppCreateQuoteResponse,
  AppQuoteView,
  QuoteListGroup,
  QuotesListResponse,
} from '@qolumns/shared'
import type { RoomScanRoom, ScanMeasure } from '@qolumns/shared'
import type { AppField } from './answers'

export interface ApiErrorBody {
  error?: { code?: string; message?: string; retryAfterSeconds?: number; details?: Array<{ error?: string }> }
}

/** `status` 0 means the request never got an answer (no signal, or it timed out) */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    /** How long the server asked us to wait (a rate limit) */
    public readonly retryAfterSeconds?: number
  ) {
    super(message)
    this.name = 'ApiError'
  }

  /** No answer at all: the phone has no signal, or the request timed out */
  get offline(): boolean {
    return this.status === 0
  }

  /** Trying the same thing again later can work: nothing was wrong with what was sent */
  get retryable(): boolean {
    return this.status === 0 || this.status === 408 || this.status === 429 || this.status >= 500
  }
}

/** Whatever was thrown, as an ApiError (a thrown fetch is "no signal") */
export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error
  return new ApiError(0, 'NETWORK', 'No signal')
}

export interface WidgetConfigService {
  id: string
  name: string
  /** Pack signal specs (T-138: which quantities a room scan can fill) */
  expectedSignals?: Array<{ signalKey: string; unit?: string; scan?: { measure: ScanMeasure } }>
  mediaConfig: {
    minPhotos: number
    maxPhotos: number
    photoGuidance: string | null
    requiredAngles: Array<{ id: string; label: string; guidance?: string }>
  }
}

export interface WidgetConfigResponse {
  tenantName: string
  services: WidgetConfigService[]
  globalFields: AppField[]
  serviceFields: Record<string, AppField[]>
}

export interface PhotoFile {
  uri: string
  fileName: string
  contentType: string
  sizeBytes: number
}

/** The account line the dashboard shows on every page (GET /api/billing/notice) */
export type AccountNotice =
  | { kind: 'payment_failed'; line: string }
  | { kind: 'suspended'; line: string; email?: string }

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

/** A request that gets no answer in this long counts as no signal */
export const REQUEST_TIMEOUT_MS = 25_000

export function createApi(opts: {
  baseUrl: string
  getAccessToken: () => Promise<string | null>
  fetch?: FetchLike
  timeoutMs?: number
}) {
  const doFetch: FetchLike = opts.fetch ?? ((input, init) => fetch(input, init))
  const base = opts.baseUrl.replace(/\/+$/, '')
  const timeoutMs = opts.timeoutMs ?? REQUEST_TIMEOUT_MS

  async function request<T>(path: string, init: RequestInit & { auth?: boolean } = {}): Promise<T> {
    const headers: Record<string, string> = { Accept: 'application/json' }
    if (init.body) headers['Content-Type'] = 'application/json'
    if (init.auth !== false) {
      let token: string | null
      try {
        token = await opts.getAccessToken()
      } catch {
        // the sign-in could not be refreshed: that is the network, not a sign-out
        throw new ApiError(0, 'NETWORK', 'No signal')
      }
      if (!token) throw new ApiError(401, 'UNAUTHORIZED', 'Please sign in again')
      headers.Authorization = `Bearer ${token}`
    }

    const controller = typeof AbortController === 'undefined' ? null : new AbortController()
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null
    let res: Response
    let text: string
    try {
      const rest: RequestInit = { ...init }
      delete (rest as { auth?: boolean }).auth
      res = await doFetch(`${base}${path}`, {
        ...rest,
        headers: { ...headers, ...(init.headers as Record<string, string> | undefined) },
        ...(controller && { signal: controller.signal }),
      })
      text = await res.text()
    } catch {
      throw new ApiError(0, 'NETWORK', 'No signal')
    } finally {
      if (timer) clearTimeout(timer)
    }

    let json: unknown = null
    try {
      json = text ? JSON.parse(text) : null
    } catch {
      json = null
    }
    if (!res.ok) {
      const err = (json as ApiErrorBody | null)?.error
      const header = Number(res.headers?.get?.('Retry-After'))
      const retryAfter = err?.retryAfterSeconds ?? (Number.isFinite(header) && header > 0 ? header : undefined)
      // a refused file says why in its own line ("File too large. Maximum size: 10MB")
      const detail = Array.isArray(err?.details) ? err.details.find((d) => typeof d?.error === 'string')?.error : undefined
      throw new ApiError(res.status, err?.code ?? 'HTTP_ERROR', detail ?? err?.message ?? `Request failed (${res.status})`, retryAfter)
    }
    return json as T
  }

  const quotePath = (quoteId: string) => `/api/quotes/${encodeURIComponent(quoteId)}`

  return {
    bootstrap: () => request<AppBootstrapResponse>('/api/app/bootstrap'),

    widgetConfig: (tenantKey: string) =>
      request<WidgetConfigResponse>(`/api/public/widget/config?tenantKey=${encodeURIComponent(tenantKey)}`, { auth: false }),

    /** `default` opens on what needs the business, when anything does (the dashboard's rule) */
    listQuotes: (group: QuoteListGroup | 'default' = 'all', search = '') =>
      request<QuotesListResponse>(`/api/quotes?limit=50&group=${group}${search.trim() ? `&search=${encodeURIComponent(search.trim())}` : ''}`),

    /** T-184: the Account tab (the business's name and logo, its plan's name and usage, its quote link) */
    account: () => request<AppAccountResponse>('/api/app/account'),

    getQuote: (quoteId: string) => request<AppQuoteView>(`/api/app/quotes/${encodeURIComponent(quoteId)}`),

    createQuote: (body: AppCreateQuoteRequest) =>
      request<AppCreateQuoteResponse>('/api/app/quotes', { method: 'POST', body: JSON.stringify(body) }),

    /** T-188: an answer may carry the business's own note ("Why (for your records)"); it is kept with the answer */
    answerQuestions: (quoteId: string, answers: Array<{ questionId: string; answer: string; note?: string }>, quoteToken?: string) =>
      request<{ success: boolean }>(`/api/app/quotes/${encodeURIComponent(quoteId)}/answers`, {
        method: 'POST',
        body: JSON.stringify({ answers, ...(quoteToken && { quoteToken }) }),
      }),

    /** T-146: approve a quote awaiting review — the customer gets it */
    approveQuote: (quoteId: string) =>
      request<{ status: 'sent'; emailed: boolean }>(`${quotePath(quoteId)}/approve`, { method: 'POST' }),

    /**
     * A link to the customer's quote page (the dashboard's "Copy link"). Raw
     * links are never stored, so this is always a new one; every link the
     * customer already has keeps working (T-157).
     */
    quoteLink: (quoteId: string) =>
      request<{ quoteViewUrl: string }>(`${quotePath(quoteId)}/link`, { method: 'POST', body: JSON.stringify({ force: true }) }),

    /** T-134: price a request that was saved when the plan limit was reached (402 while the limit still stands) */
    priceHeldRequest: (quoteId: string) => request<{ queued: boolean }>(`${quotePath(quoteId)}/process`, { method: 'POST' }),

    /** T-180: the account line (a paused account, a failed payment), or null */
    async accountNotice(): Promise<AccountNotice | null> {
      const { notice } = await request<{ notice: AccountNotice | null }>('/api/billing/notice')
      return notice
    },

    /** T-143: what the job was finally invoiced at (null clears it) */
    recordFinalInvoice: (quoteId: string, amount: number | null, note?: string) =>
      request<{ finalInvoiceAmount: number | null; finalInvoiceRecordedAt: string | null }>(`${quotePath(quoteId)}/final-invoice`, {
        method: 'PUT',
        body: JSON.stringify({ amount, ...(note && { note }) }),
      }),

    /**
     * Start one photo's upload: the server makes its record and answers a
     * signed address that takes exactly this size and type (T-173), so
     * `sizeBytes` must be the file's real size.
     */
    async startUpload(tenantKey: string, file: Omit<PhotoFile, 'uri'>): Promise<{ assetId: string; uploadUrl: string }> {
      const init = await request<{ uploads?: Array<{ assetId: string; uploadUrl: string }>; errors?: Array<{ error?: string }> }>(
        '/api/public/uploads/init',
        {
          method: 'POST',
          auth: false,
          body: JSON.stringify({ tenantKey, files: [{ fileName: file.fileName, contentType: file.contentType, sizeBytes: file.sizeBytes }] }),
        }
      )
      const upload = init.uploads?.[0]
      // refused for what the file is (its type or size): sending it again cannot help
      if (!upload) throw new ApiError(400, 'UPLOAD_REFUSED', init.errors?.[0]?.error ?? 'This photo could not be uploaded')
      return upload
    },

    /** T-193: start a room model's upload: a signed address for exactly this size, in this business's own folder */
    startModelUpload: (sizeBytes: number) =>
      request<{ modelId: string; uploadUrl: string }>('/api/app/room-models', { method: 'POST', body: JSON.stringify({ sizeBytes }) }),

    /** T-194: a short-lived address for a model this business uploaded (straight after a scan, before the quote is sent) */
    modelUrl: (modelId: string) => request<{ url: string }>(`/api/app/room-models/${encodeURIComponent(modelId)}`),

    /** T-194: one area scanned again (`index`) or added (none); the quote is priced again */
    rescan: (quoteId: string, area: RoomScanRoom, index?: number) =>
      request<{ success: boolean }>(`/api/app/quotes/${encodeURIComponent(quoteId)}/scan`, { method: 'POST', body: JSON.stringify({ area, ...(index !== undefined && { index }) }) }),
  }
}

export type Api = ReturnType<typeof createApi>

/** Fields for one service: global (unscoped) fields first, then the service's own. */
export function fieldsForService(config: WidgetConfigResponse, serviceId: string): AppField[] {
  const seen = new Set<string>()
  const out: AppField[] = []
  for (const f of [...(config.globalFields || []), ...(config.serviceFields?.[serviceId] || [])]) {
    if (seen.has(f.fieldId)) continue
    seen.add(f.fieldId)
    out.push(f)
  }
  return out
}
