/**
 * T-197: what the Help panel attaches to a problem report, gathered in the
 * browser: the page, the quote if the page is one, the browser, the screen
 * size and the last error the page showed. The business sees this list
 * before it sends ("We'll include"); the server keeps only these fields
 * (`cleanSupportContext`) and adds the plan itself.
 */
import { browserName, quoteIdOfPath, type SupportContext } from '@qolumns/shared'

let lastScriptError: string | null = null

/** Remember the last error the page raised. Returns the function that stops listening. */
export function watchPageErrors(target: Pick<Window, 'addEventListener' | 'removeEventListener'>): () => void {
  const onError = (event: Event) => {
    const message = (event as ErrorEvent).message
    if (typeof message === 'string' && message.trim()) lastScriptError = message.trim().slice(0, 300)
  }
  const onRejection = (event: Event) => {
    const reason = (event as PromiseRejectionEvent).reason as { message?: unknown } | string | undefined
    const message = typeof reason === 'string' ? reason : typeof reason?.message === 'string' ? reason.message : ''
    if (message.trim()) lastScriptError = message.trim().slice(0, 300)
  }
  target.addEventListener('error', onError)
  target.addEventListener('unhandledrejection', onRejection)
  return () => {
    target.removeEventListener('error', onError)
    target.removeEventListener('unhandledrejection', onRejection)
  }
}

/**
 * The last error the page showed: an error message on the page itself (not
 * one inside the Help panel), else the last error the page raised.
 */
export function lastShownError(doc: Pick<Document, 'querySelectorAll'>): string | undefined {
  const alerts = Array.from(doc.querySelectorAll('[role="alert"]')).filter((el) => !(el as Element).closest('[data-help-panel]'))
  const shown = alerts.map((el) => (el.textContent ?? '').replace(/\s+/g, ' ').trim()).filter(Boolean).pop()
  return (shown ?? lastScriptError ?? undefined)?.slice(0, 300)
}

/** Everything the browser can say about where the business is. The plan is added from what the server answered. */
export function gatherContext(input: { pathname: string; userAgent: string; width: number; height: number; lastError?: string; plan?: string | null }): SupportContext {
  const context: SupportContext = { page: input.pathname, browser: browserName(input.userAgent), screen: `${Math.round(input.width)} × ${Math.round(input.height)}` }
  const quoteId = quoteIdOfPath(input.pathname)
  if (quoteId) context.quoteId = quoteId
  if (input.plan) context.plan = input.plan
  if (input.lastError) context.lastError = input.lastError
  return context
}
