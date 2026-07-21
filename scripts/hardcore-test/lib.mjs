// Shared plumbing for the hardcore E2E harness. Plain Node (>=18), no deps.
import { readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

// ---------- env ----------

function parseEnvFile(file) {
  const out = {}
  if (!existsSync(file)) return out
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
  return out
}

export function loadEnv() {
  const env = parseEnvFile(path.join(ROOT, 'apps/web/.env.local'))
  const cfg = {
    appUrl: env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
    supabaseUrl: env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321',
    anonKey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    serviceKey: env.SUPABASE_SERVICE_ROLE_KEY,
    geminiKey: env.GEMINI_API_KEY,
  }
  if (!cfg.anonKey || !cfg.serviceKey) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_ANON_KEY or SUPABASE_SERVICE_ROLE_KEY in apps/web/.env.local')
  }
  return cfg
}

// ---------- http ----------

export async function http(method, url, { headers = {}, body, timeoutMs = 240_000 } = {}) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(new Error(`timeout after ${timeoutMs}ms: ${method} ${url}`)), timeoutMs)
  try {
    const res = await fetch(url, {
      method,
      headers: body && !(body instanceof Uint8Array) ? { 'Content-Type': 'application/json', ...headers } : headers,
      body: body ? (body instanceof Uint8Array ? body : JSON.stringify(body)) : undefined,
      signal: ctrl.signal,
    })
    const text = await res.text()
    let json = null
    try { json = text ? JSON.parse(text) : null } catch { /* non-JSON body */ }
    return { status: res.status, ok: res.ok, json, text }
  } finally {
    clearTimeout(timer)
  }
}

export function expectOk(step, res) {
  if (!res.ok) {
    throw new Error(`${step} failed (HTTP ${res.status}): ${JSON.stringify(res.json ?? res.text).slice(0, 500)}`)
  }
  return res.json
}

// ---------- supabase admin + auth ----------

export function makeSupabase(cfg) {
  const adminHeaders = { apikey: cfg.serviceKey, Authorization: `Bearer ${cfg.serviceKey}` }

  return {
    async createUser(email, password, businessName) {
      const res = await http('POST', `${cfg.supabaseUrl}/auth/v1/admin/users`, {
        headers: adminHeaders,
        body: { email, password, email_confirm: true, user_metadata: { business_name: businessName } },
      })
      return expectOk('admin createUser', res)
    },

    async signIn(email, password) {
      const res = await http('POST', `${cfg.supabaseUrl}/auth/v1/token?grant_type=password`, {
        headers: { apikey: cfg.anonKey },
        body: { email, password },
      })
      const session = expectOk('signIn', res)
      if (!session.expires_at) session.expires_at = Math.floor(Date.now() / 1000) + (session.expires_in || 3600)
      return session
    },

    async insert(table, row) {
      const res = await http('POST', `${cfg.supabaseUrl}/rest/v1/${table}`, {
        headers: { ...adminHeaders, Prefer: 'return=representation' },
        body: row,
      })
      const json = expectOk(`insert ${table}`, res)
      return Array.isArray(json) ? json[0] : json
    },

    async select(table, query) {
      const res = await http('GET', `${cfg.supabaseUrl}/rest/v1/${table}?${query}`, { headers: adminHeaders })
      return expectOk(`select ${table}`, res)
    },
  }
}

// Replicates @supabase/ssr 0.4.1 cookie storage: name sb-<host-1st-segment>-auth-token,
// value "base64-" + base64url(JSON(session)), chunked at 3180 chars into <name>.0, .1, ...
export function sessionCookieHeader(cfg, session) {
  const ref = new URL(cfg.supabaseUrl).hostname.split('.')[0]
  const name = `sb-${ref}-auth-token`
  const encoded = 'base64-' + Buffer.from(JSON.stringify(session), 'utf8').toString('base64url')
  const MAX = 3180
  if (encoded.length <= MAX) return `${name}=${encoded}`
  const parts = []
  for (let i = 0; i * MAX < encoded.length; i++) {
    parts.push(`${name}.${i}=${encoded.slice(i * MAX, (i + 1) * MAX)}`)
  }
  return parts.join('; ')
}

// ---------- assets ----------

const IMAGE_TYPES = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' }

/**
 * Collect uploadable files from a scenario asset dir. HEIC/HEIF are converted
 * to JPEG via macOS `sips` (into scratchDir). CSV/other types are skipped with
 * a note (public upload accepts images + PDF only).
 */
export function collectAssets(assetsDir, scratchDir) {
  const abs = path.join(ROOT, assetsDir)
  const out = { files: [], skipped: [] }
  if (!existsSync(abs)) return out
  for (const name of readdirSync(abs).sort()) {
    if (name.startsWith('.') || name === 'README.md') continue
    const ext = path.extname(name).toLowerCase()
    const full = path.join(abs, name)
    if (ext === '.heic' || ext === '.heif') {
      mkdirSync(scratchDir, { recursive: true })
      const jpg = path.join(scratchDir, name.replace(/\.[^.]+$/, '.jpg'))
      execFileSync('sips', ['-s', 'format', 'jpeg', full, '--out', jpg], { stdio: 'pipe' })
      out.files.push({ path: jpg, fileName: path.basename(jpg), contentType: 'image/jpeg' })
    } else if (IMAGE_TYPES[ext]) {
      out.files.push({ path: full, fileName: name, contentType: IMAGE_TYPES[ext] })
    } else if (ext === '.pdf') {
      out.files.push({ path: full, fileName: name, contentType: 'application/pdf' })
    } else {
      out.skipped.push(name)
    }
  }
  return out
}

export async function uploadAssets(cfg, tenantKey, files) {
  if (files.length === 0) return { assetIds: [], errors: [] }
  const init = expectOk('uploads/init', await http('POST', `${cfg.appUrl}/api/public/uploads/init`, {
    body: {
      tenantKey,
      files: files.map((f) => ({
        fileName: f.fileName,
        contentType: f.contentType,
        sizeBytes: readFileSync(f.path).byteLength,
      })),
    },
  }))
  const assetIds = []
  const errors = [...(init.errors || [])]
  for (let i = 0; i < (init.uploads || []).length; i++) {
    const u = init.uploads[i]
    const f = files[i]
    const bytes = new Uint8Array(readFileSync(f.path))
    const put = await http('PUT', u.uploadUrl, { headers: { 'Content-Type': f.contentType }, body: bytes })
    if (put.status >= 200 && put.status < 300) assetIds.push(u.assetId)
    else errors.push({ fileName: f.fileName, error: `PUT ${put.status}: ${put.text.slice(0, 200)}` })
  }
  return { assetIds, errors }
}

// ---------- answers ----------

const optionValue = (o) => (typeof o === 'object' && o !== null ? o.value ?? o.label : o)
const optionText = (o) => (typeof o === 'object' && o !== null ? `${o.label ?? ''} ${o.value ?? ''}` : String(o))

/**
 * Build the widget `answers` array: project description + answers resolved
 * from scenario fieldHints (specific-first order), with typed coercion:
 * option fields snap the hint to the closest real option (a real widget only
 * submits actual option values), booleans coerce to true/false, and number
 * fields with non-numeric hints stay unanswered (a number input would reject
 * the text). Optional fields are answered only when a hint matches. Every
 * decision is logged for the report.
 */
export function buildAnswers(scenario, widgetFields) {
  const answers = [{ fieldId: '_project_description', value: scenario.request }]
  const log = []
  for (const field of widgetFields) {
    const hay = `${field.fieldId} ${field.label || ''}`.toLowerCase()
    const hint = (scenario.fieldHints || []).find((h) => h.match.test(hay))
    if (!hint && !field.required && !field.criticalForPricing) continue
    const hasOptions = Array.isArray(field.options) && field.options.length > 0
    let value
    let how
    if (hint && hasOptions) {
      const want = String(hint.value).toLowerCase()
      let opt = field.options.find((o) => {
        const t = optionText(o).toLowerCase()
        return t.includes(want) || want.includes(t.trim())
      })
      if (opt === undefined) {
        // fallback: option sharing the MOST distinctive words with the hint
        const score = (o) => optionText(o).toLowerCase().split(/[^a-z0-9]+/)
          .filter((w) => w.length >= 2).filter((w) => want.includes(w)).length
        const best = [...field.options].sort((a, b) => score(b) - score(a))[0]
        if (score(best) > 0) opt = best
      }
      if (opt !== undefined) { value = optionValue(opt); how = 'fieldHint→option' }
      else { value = optionValue(field.options[0]); how = 'fieldHint-no-option-match→first' }
    } else if (hint && (field.type === 'boolean' || field.type === 'checkbox')) {
      // a hint matching a boolean field is an affirmation unless it clearly negates
      value = typeof hint.value === 'boolean' ? hint.value : !/^(no|false|n$|0$)/i.test(String(hint.value))
      how = 'fieldHint→bool'
    } else if (hint && field.type === 'number') {
      const n = Number(hint.value)
      if (Number.isFinite(n)) { value = n; how = 'fieldHint' }
      else { how = 'UNANSWERED-hint-not-numeric' }
    } else if (hint) {
      value = hint.value
      how = 'fieldHint'
    } else if (hasOptions) {
      const req = scenario.request.toLowerCase()
      const opt = field.options.find((o) => req.includes(optionText(o).toLowerCase().trim())) ?? field.options[0]
      value = optionValue(opt)
      how = 'option-guess'
    } else if (field.type === 'number') {
      how = 'UNANSWERED-number'
    } else if (field.type === 'boolean' || field.type === 'checkbox') {
      value = false
      how = 'default-false'
    } else {
      value = 'Please see the project description.'
      how = 'default-text'
    }
    if (value !== undefined) answers.push({ fieldId: field.fieldId, value })
    log.push({ fieldId: field.fieldId, label: field.label, type: field.type, required: field.required, value, how })
  }
  return { answers, log }
}

// ---------- quote polling / clarify ----------

const SETTLED = new Set(['sent', 'viewed', 'awaiting_clarification', 'pending_review', 'failed', 'accepted', 'expired'])

export async function pollQuote(cfg, quoteId, token, { timeoutMs = 600_000 } = {}) {
  const deadline = Date.now() + timeoutMs
  let last = null
  while (Date.now() < deadline) {
    const res = await http('GET', `${cfg.appUrl}/api/public/quotes/${quoteId}?token=${encodeURIComponent(token)}&poll=1`)
    last = res.json
    if (res.ok && last && SETTLED.has(last.status)) return last
    if (!res.ok && res.status !== 404) throw new Error(`poll failed HTTP ${res.status}: ${res.text.slice(0, 300)}`)
    await new Promise((r) => setTimeout(r, 3000))
  }
  throw new Error(`quote ${quoteId} not settled within ${timeoutMs}ms (last status: ${last?.status})`)
}

export function answerClarifications(scenario, questions) {
  const answers = []
  const log = []
  for (const q of questions || []) {
    const text = `${q.question || q.text || ''}`.toLowerCase()
    const hint = (scenario.clarify || []).find((c) => c.match.test(text))
    const answer = hint ? hint.answer : scenario.clarifyDefault || 'Whatever you think is standard — please use your best judgement.'
    answers.push({ questionId: q.id || q.questionId, answer })
    log.push({ question: q.question || q.text, answer, how: hint ? 'clarify-hint' : 'default' })
  }
  return { answers, log }
}

// ---------- misc ----------

export const runStamp = () => new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19)
export const shortId = () => crypto.randomBytes(4).toString('hex')

export function saveJson(dir, name, data) {
  mkdirSync(dir, { recursive: true })
  writeFileSync(path.join(dir, name), JSON.stringify(data, null, 2))
}
