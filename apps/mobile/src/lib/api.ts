/**
 * Typed client for the web API (no React Native imports, testable).
 *
 * Business endpoints authenticate with the signed-in user's Supabase access
 * token as a bearer (the web app accepts it in place of the session cookie,
 * under the same row-level security). Photo uploads and the service form go
 * through the same public endpoints the website widget uses, keyed by the
 * tenant key from /api/app/bootstrap.
 */

import type {
  AppBootstrapResponse,
  AppCreateQuoteRequest,
  AppQuoteView,
  CreateQuoteResponse,
  QuotesListResponse,
} from '@estimator/shared'
import type { ScanMeasure } from '@estimator/shared'
import type { AppField } from './answers'

export interface ApiErrorBody {
  error?: { code?: string; message?: string }
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string
  ) {
    super(message)
    this.name = 'ApiError'
  }
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

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

export function createApi(opts: {
  baseUrl: string
  getAccessToken: () => Promise<string | null>
  fetch?: FetchLike
  /** Reads a local file into bytes for upload (RN: fetch(uri).blob()) */
  readFile?: (uri: string) => Promise<Blob>
}) {
  const doFetch: FetchLike = opts.fetch ?? ((input, init) => fetch(input, init))
  const base = opts.baseUrl.replace(/\/+$/, '')

  async function request<T>(path: string, init: RequestInit & { auth?: boolean } = {}): Promise<T> {
    const headers: Record<string, string> = { Accept: 'application/json' }
    if (init.body) headers['Content-Type'] = 'application/json'
    if (init.auth !== false) {
      const token = await opts.getAccessToken()
      if (!token) throw new ApiError(401, 'UNAUTHORIZED', 'Please sign in again')
      headers.Authorization = `Bearer ${token}`
    }
    const res = await doFetch(`${base}${path}`, { ...init, headers: { ...headers, ...(init.headers as Record<string, string> | undefined) } })
    const text = await res.text()
    let json: unknown = null
    try {
      json = text ? JSON.parse(text) : null
    } catch {
      json = null
    }
    if (!res.ok) {
      const err = (json as ApiErrorBody | null)?.error
      throw new ApiError(res.status, err?.code ?? 'HTTP_ERROR', err?.message ?? `Request failed (${res.status})`)
    }
    return json as T
  }

  return {
    bootstrap: () => request<AppBootstrapResponse>('/api/app/bootstrap'),

    widgetConfig: (tenantKey: string) =>
      request<WidgetConfigResponse>(`/api/public/widget/config?tenantKey=${encodeURIComponent(tenantKey)}`, { auth: false }),

    listQuotes: () => request<QuotesListResponse>('/api/quotes?limit=30'),

    getQuote: (quoteId: string) => request<AppQuoteView>(`/api/app/quotes/${encodeURIComponent(quoteId)}`),

    createQuote: (body: AppCreateQuoteRequest) =>
      request<CreateQuoteResponse>('/api/app/quotes', { method: 'POST', body: JSON.stringify(body) }),

    answerQuestions: (quoteId: string, answers: Array<{ questionId: string; answer: string }>, quoteToken?: string) =>
      request<{ success: boolean }>(`/api/app/quotes/${encodeURIComponent(quoteId)}/answers`, {
        method: 'POST',
        body: JSON.stringify({ answers, ...(quoteToken && { quoteToken }) }),
      }),

    /** Signed-URL upload through the widget's public flow; returns asset ids in order. */
    async uploadPhotos(tenantKey: string, files: PhotoFile[]): Promise<string[]> {
      if (files.length === 0) return []
      if (!opts.readFile) throw new Error('readFile is required to upload photos')
      const init = await request<{ uploads: Array<{ assetId: string; uploadUrl: string }>; errors?: unknown[] }>(
        '/api/public/uploads/init',
        {
          method: 'POST',
          auth: false,
          body: JSON.stringify({
            tenantKey,
            files: files.map((f) => ({ fileName: f.fileName, contentType: f.contentType, sizeBytes: f.sizeBytes })),
          }),
        }
      )
      const ids: string[] = []
      for (let i = 0; i < init.uploads.length; i++) {
        const upload = init.uploads[i]!
        const file = files[i]!
        const put = await doFetch(upload.uploadUrl, {
          method: 'PUT',
          headers: { 'Content-Type': file.contentType },
          body: await opts.readFile(file.uri),
        })
        if (!put.ok) throw new ApiError(put.status, 'UPLOAD_FAILED', `Photo ${i + 1} failed to upload`)
        ids.push(upload.assetId)
      }
      return ids
    },
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
