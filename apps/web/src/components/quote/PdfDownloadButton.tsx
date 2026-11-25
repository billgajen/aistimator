'use client'

import { useState } from 'react'
import { PDF_FAILED_LINE, customerPdfPath } from '@/lib/customer-pdf'

/**
 * T-204: "Download PDF" on the customer's page, offered once the quote has
 * gone to them as final (the public quote API decides: `actions.pdfUrl`).
 *
 * The first download makes the document, which takes a few seconds, so the
 * button says so while it waits and the customer stays on the page; the file
 * then saves under its own name. It is a link underneath: with scripts off,
 * or pressed with a modifier key, the same address answers with the file.
 */
export function PdfDownloadButton({ quoteId, token }: { quoteId: string; token: string }) {
  const [state, setState] = useState<'idle' | 'working' | 'failed'>('idle')
  const [message, setMessage] = useState(PDF_FAILED_LINE)
  const href = customerPdfPath(quoteId, token)

  async function download(event: React.MouseEvent<HTMLAnchorElement>) {
    // a new tab or a "save link as" is the browser's own business
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return
    event.preventDefault()
    if (state === 'working') return
    setState('working')
    try {
      const response = await fetch(`${href}&format=json`)
      const data = (await response.json().catch(() => null)) as { downloadUrl?: string; error?: { message?: string } } | null
      if (!response.ok || !data?.downloadUrl) {
        // a "too many tries" answer says when to come back; anything else gets the one plain line
        setMessage(response.status === 429 && data?.error?.message ? data.error.message : PDF_FAILED_LINE)
        setState('failed')
        return
      }
      // the address answers as a file to save, so the page stays where it is
      window.location.assign(data.downloadUrl)
      setState('idle')
    } catch {
      setMessage(PDF_FAILED_LINE)
      setState('failed')
    }
  }

  return (
    <div className="flex flex-col items-end gap-1.5">
      <a
        href={href}
        onClick={download}
        aria-busy={state === 'working'}
        data-testid="download-pdf"
        className="inline-flex min-h-[44px] items-center gap-2 whitespace-nowrap rounded-lg border border-field bg-surface px-3.5 text-sm font-semibold text-text-primary transition hover:border-border-strong"
      >
        <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
        {state === 'working' ? 'Preparing PDF…' : 'Download PDF'}
      </a>
      {state === 'failed' && (
        <p className="max-w-[14rem] text-right text-xs text-danger" role="alert" data-testid="download-pdf-failed">
          {message}
        </p>
      )}
    </div>
  )
}
