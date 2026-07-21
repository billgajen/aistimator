/**
 * Website content extraction for service onboarding (T-105).
 *
 * Fetches a business's website server-side, discovers likely pricing/services
 * pages, and returns plain text for AI service extraction. Dependency-free:
 * regex-based HTML stripping is sufficient for LLM input.
 */

const MAX_PAGES = 4
const MAX_REDIRECTS = 3
const FETCH_TIMEOUT_MS = 10000
const MAX_PAGE_BYTES = 1_500_000
const MAX_COMBINED_CHARS = 30000

/** Link paths/anchor text that suggest a page describes services or pricing */
const RELEVANT_KEYWORDS = [
  'pricing',
  'price',
  'prices',
  'services',
  'service',
  'rates',
  'packages',
  'plans',
  'menu',
  'cost',
  'quote',
  'estimate',
  'book',
  'treatments',
  'what-we-do',
]

/**
 * SSRF guard: only allow http(s) URLs on default ports to public-looking hosts.
 * Blocks loopback, private ranges, link-local, and metadata endpoints.
 * (DNS-rebinding to private IPs is out of scope for v1 — serverless deployment
 * limits internal network exposure; documented in CHANGELOG.)
 */
export function validatePublicUrl(input: string): { ok: true; url: URL } | { ok: false; reason: string } {
  let url: URL
  try {
    url = new URL(input.includes('://') ? input : `https://${input}`)
  } catch {
    return { ok: false, reason: 'Invalid URL' }
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return { ok: false, reason: 'Only http(s) URLs are supported' }
  }
  if (url.port && url.port !== '80' && url.port !== '443') {
    return { ok: false, reason: 'Non-standard ports are not supported' }
  }
  if (url.username || url.password) {
    return { ok: false, reason: 'URLs with credentials are not supported' }
  }

  const host = url.hostname.toLowerCase()
  if (
    host === 'localhost' ||
    host === '0.0.0.0' ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host === '169.254.169.254' || // cloud metadata
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    /^169\.254\./.test(host) ||
    host === '[::1]' ||
    host.startsWith('[fe80:') ||
    host.startsWith('[fc') ||
    host.startsWith('[fd')
  ) {
    return { ok: false, reason: 'Private or local addresses are not allowed' }
  }
  if (!host.includes('.')) {
    return { ok: false, reason: 'Invalid hostname' }
  }

  return { ok: true, url }
}

/**
 * Strip HTML to readable text: drop script/style/nav/footer/header blocks,
 * convert structural tags to line breaks, decode common entities.
 */
export function htmlToText(html: string): string {
  let text = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|svg|iframe)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<(nav|footer)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<(br|\/p|\/div|\/li|\/tr|\/h[1-6])[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')

  const entities: Record<string, string> = {
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&#39;': "'",
    '&apos;': "'",
    '&nbsp;': ' ',
    '&pound;': '£',
    '&euro;': '€',
    '&dollar;': '$',
  }
  text = text.replace(/&[a-z#0-9]+;/gi, (e) => entities[e.toLowerCase()] ?? ' ')

  return text
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => line.length > 0)
    .join('\n')
}

/**
 * Discover same-origin links, scored by how likely they describe services/pricing.
 */
export function findRelevantLinks(html: string, baseUrl: URL): string[] {
  const scored = new Map<string, number>()
  const linkRegex = /<a\s[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi

  let match: RegExpExecArray | null
  while ((match = linkRegex.exec(html)) !== null) {
    const hrefRaw = match[1]
    const anchorRaw = match[2] ?? ''
    if (!hrefRaw) continue
    let href: URL
    try {
      href = new URL(hrefRaw, baseUrl)
    } catch {
      continue
    }
    if (href.origin !== baseUrl.origin) continue
    if (href.pathname === baseUrl.pathname) continue
    if (/\.(pdf|jpg|jpeg|png|gif|webp|zip|mp4|css|js)$/i.test(href.pathname)) continue

    const anchorText = htmlToText(anchorRaw).toLowerCase()
    const path = href.pathname.toLowerCase()
    let score = 0
    for (const keyword of RELEVANT_KEYWORDS) {
      if (path.includes(keyword)) score += 2
      if (anchorText.includes(keyword)) score += 1
    }
    if (score > 0) {
      const key = `${href.origin}${href.pathname}`
      scored.set(key, Math.max(scored.get(key) ?? 0, score))
    }
  }

  return [...scored.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_PAGES - 1)
    .map(([link]) => link)
}

/**
 * Fetch one page with timeout, size cap, and per-hop redirect validation.
 */
async function fetchPage(url: URL): Promise<string | null> {
  let current = url
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
    try {
      const response = await fetch(current.toString(), {
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; EstimatorBot/1.0; service setup)',
          Accept: 'text/html,application/xhtml+xml',
        },
      })

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location')
        if (!location) return null
        const next = validatePublicUrl(new URL(location, current).toString())
        if (!next.ok) return null // redirect into private space — refuse
        current = next.url
        continue
      }

      if (!response.ok) return null
      const contentType = response.headers.get('content-type') || ''
      if (!contentType.includes('text/html') && !contentType.includes('xhtml')) return null

      const buffer = await response.arrayBuffer()
      if (buffer.byteLength > MAX_PAGE_BYTES) return null
      return new TextDecoder('utf-8', { fatal: false }).decode(buffer)
    } catch {
      return null
    } finally {
      clearTimeout(timer)
    }
  }
  return null
}

export interface WebsiteContent {
  pages: Array<{ url: string; text: string }>
  combinedText: string
}

/**
 * Fetch the given page plus up to 3 relevant same-origin pages and return
 * their readable text, capped for LLM input.
 */
export async function fetchWebsiteContent(inputUrl: string): Promise<WebsiteContent> {
  const validated = validatePublicUrl(inputUrl)
  if (!validated.ok) {
    throw new Error(validated.reason)
  }

  const mainHtml = await fetchPage(validated.url)
  if (!mainHtml) {
    throw new Error('Could not fetch that page — check the URL is correct and publicly accessible')
  }

  const pages: Array<{ url: string; text: string }> = [
    { url: validated.url.toString(), text: htmlToText(mainHtml) },
  ]

  const links = findRelevantLinks(mainHtml, validated.url)
  const linkedPages = await Promise.all(
    links.map(async (link) => {
      const check = validatePublicUrl(link)
      if (!check.ok) return null
      const html = await fetchPage(check.url)
      return html ? { url: link, text: htmlToText(html) } : null
    })
  )
  pages.push(...linkedPages.filter((p): p is { url: string; text: string } => p !== null))

  // Budget the combined text evenly-ish: main page first, then relevant pages
  let combined = ''
  for (const page of pages) {
    if (combined.length >= MAX_COMBINED_CHARS) break
    const remaining = MAX_COMBINED_CHARS - combined.length
    combined += `\n\n===== PAGE: ${page.url} =====\n${page.text.slice(0, remaining)}`
  }

  return { pages, combinedText: combined.trim() }
}
