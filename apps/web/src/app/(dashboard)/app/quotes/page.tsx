'use client'

import { UnfinishedLeads } from '@/components/quotes/UnfinishedLeads'
import { QuoteTabs } from '@/components/quotes/QuoteTabs'
import { QuoteRowMenu, type QuoteRowMenuItem } from '@/components/quotes/QuoteRowMenu'
import { TurnBadge } from '@/components/quotes/TurnBadge'
import { useEffect, useState, useCallback, useRef } from 'react'
import {
  formatMoney,
  canCopyQuoteLink,
  canDownloadQuotePdf,
  canSendQuoteAgain,
  canViewPricingTrace,
  quoteTurn,
  QUOTE_TURN_COPY,
} from '@estimator/shared'
import Link from 'next/link'
import { copyLinkFallbackMessage } from '@/lib/quote-action-copy'
import { EmptyState, PageHeader } from '@/components/dashboard/EmptyState'
import type { QuoteListCounts, QuoteListItem, QuoteListTab, QuotesListResponse } from '@estimator/shared'

// One grid per row, so the last column has a fixed width: an `auto` column
// would be sized per row and the columns would not line up. Wide screens only;
// below that the rows stack.
const ROW_GRID = 'xl:grid xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_7rem_minmax(0,1.3fr)_15rem] xl:items-center xl:gap-x-5'

export default function QuotesPage() {
  const [quotes, setQuotes] = useState<QuoteListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  // T-158: the list is split by whose turn it is. `null` until the first
  // response says where to open (Needs you when it has any, otherwise All).
  const [tab, setTab] = useState<QuoteListTab | null>(null)
  const [counts, setCounts] = useState<QuoteListCounts | null>(null)
  const [ready, setReady] = useState(false)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [openMenu, setOpenMenu] = useState<string | null>(null)
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null)
  // The tab the server just picked: its quotes are already on screen
  const resolvedTab = useRef<QuoteListTab | null>(null)

  // T-151: Home links straight to the unfinished requests
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('filter') === 'unfinished') setTab('unfinished')
    setReady(true)
  }, [])

  const fetchQuotes = useCallback(async (cursor?: string | null, append = false) => {
    try {
      if (append) {
        setLoadingMore(true)
      } else {
        setLoading(true)
      }

      const params = new URLSearchParams()
      if (search) params.set('search', search)
      // The Unfinished tab lists requests, not quotes: it only needs the counts
      params.set('group', tab === null ? 'default' : tab === 'unfinished' ? 'all' : tab)
      if (tab === 'unfinished') params.set('limit', '1')
      if (cursor) params.set('cursor', cursor)

      const response = await fetch(`/api/quotes?${params.toString()}`)
      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error?.message || 'Failed to fetch quotes')
      }
      const list = data as QuotesListResponse

      if (append) {
        setQuotes((prev) => [...prev, ...list.items])
      } else {
        setQuotes(list.items)
      }
      setNextCursor(list.nextCursor)
      if (list.counts) setCounts(list.counts)
      if (tab === null && list.group) {
        resolvedTab.current = list.group
        setTab(list.group)
      }
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch quotes')
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }, [search, tab])

  useEffect(() => {
    if (!ready) return
    // The first response picked this tab and already carried its quotes
    if (tab !== null && resolvedTab.current === tab) {
      resolvedTab.current = null
      return
    }
    const debounce = setTimeout(() => {
      fetchQuotes()
    }, 300)
    return () => clearTimeout(debounce)
  }, [fetchQuotes, ready, tab])

  const closeMenu = useCallback(() => setOpenMenu(null), [])

  const selectTab = (next: QuoteListTab) => {
    if (next === tab) return
    // Don't leave the last tab's quotes on screen while the next ones load
    setLoading(true)
    setOpenMenu(null)
    setTab(next)
  }

  const showToast = (message: string, type: 'success' | 'error') => {
    setToast({ message, type })
    setTimeout(() => setToast(null), 3000)
  }

  const handleCopyLink = async (quoteId: string) => {
    setActionLoading(quoteId)
    try {
      const response = await fetch(`/api/quotes/${quoteId}/link`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force: true }), // Always generate fresh link for sharing
      })
      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error?.message || 'Failed to generate link')
      }

      try {
        await navigator.clipboard.writeText(data.quoteViewUrl)
        showToast('Quote link copied to clipboard', 'success')
      } catch {
        // The browser refused the clipboard: leave the link on screen to copy by hand
        setToast({ message: copyLinkFallbackMessage(data.quoteViewUrl), type: 'success' })
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to copy link', 'error')
    } finally {
      setActionLoading(null)
    }
  }

  const handleResendEmail = async (quoteId: string) => {
    setActionLoading(quoteId)
    try {
      const response = await fetch(`/api/quotes/${quoteId}/resend`, {
        method: 'POST',
      })
      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error?.message || 'Failed to resend email')
      }

      showToast(`Quote email sent to ${data.sentTo}`, 'success')
      // Refresh: the quote's detail line and the tab counts change
      fetchQuotes()
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to resend email', 'error')
    } finally {
      setActionLoading(null)
    }
  }

  const handleGeneratePdf = async (quoteId: string) => {
    setActionLoading(quoteId)
    try {
      const response = await fetch(`/api/quotes/${quoteId}/pdf`, {
        method: 'POST',
      })
      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error?.message || 'Failed to generate PDF')
      }

      if (data.downloadUrl) {
        window.open(data.downloadUrl, '_blank')
        showToast('PDF generated successfully', 'success')
      } else {
        showToast('PDF generated but download URL not available', 'error')
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to generate PDF', 'error')
    } finally {
      setActionLoading(null)
    }
  }

  const handleDownloadPdf = async (quoteId: string) => {
    setActionLoading(quoteId)
    try {
      const response = await fetch(`/api/quotes/${quoteId}/pdf`)
      const data = await response.json()

      if (!response.ok) {
        // If PDF doesn't exist, try generating it
        if (data.error?.code === 'PDF_NOT_FOUND') {
          await handleGeneratePdf(quoteId)
          return
        }
        throw new Error(data.error?.message || 'Failed to download PDF')
      }

      window.open(data.downloadUrl, '_blank')
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to download PDF', 'error')
    } finally {
      setActionLoading(null)
    }
  }

  // T-133: Intl formatting for any ISO currency
  const formatCurrency = (amount: number, currency: string) => formatMoney(amount, currency)

  /** The other actions, with words, each by the rule its route applies (T-157) */
  const menuItems = (quote: QuoteListItem, nextIsSendAgain: boolean): QuoteRowMenuItem[] => {
    const M = QUOTE_TURN_COPY.more
    const items: QuoteRowMenuItem[] = [{ key: 'open', label: M.open, href: `/app/quotes/${quote.quoteId}` }]
    if (!nextIsSendAgain && canSendQuoteAgain(quote.status, { hasEmail: Boolean(quote.customerEmail) })) {
      items.push({ key: 'send-again', label: M.sendAgain, onSelect: () => handleResendEmail(quote.quoteId) })
    }
    if (canCopyQuoteLink(quote.status)) {
      items.push({ key: 'copy-link', label: M.copyLink, onSelect: () => handleCopyLink(quote.quoteId) })
    }
    if (canDownloadQuotePdf(quote.status)) {
      items.push({ key: 'download-pdf', label: M.downloadPdf, onSelect: () => handleDownloadPdf(quote.quoteId) })
    }
    if (canViewPricingTrace(quote.status)) {
      items.push({ key: 'pricing-trace', label: M.pricingTrace, href: `/app/quotes/${quote.quoteId}/trace` })
    }
    return items
  }

  const group = tab === null || tab === 'unfinished' ? 'all' : tab

  return (
    <div>
      <PageHeader
        title="Quotes"
        description="See whose turn it is on every quote"
      />

      {/* Toast notification */}
      {toast && (
        <div
          className={`fixed top-4 right-4 z-50 max-w-md break-words px-4 py-3 rounded-warm-lg shadow-warm-lg ${
            toast.type === 'success'
              ? 'bg-secondary-light text-secondary border border-secondary/20'
              : 'bg-danger-light text-danger border border-danger/20'
          }`}
        >
          {toast.message}
        </div>
      )}

      {/* T-158: tabs by whose turn it is, with counts */}
      <QuoteTabs active={tab} counts={counts} onSelect={selectTab} />

      {tab === 'unfinished' ? <UnfinishedLeads /> : (<>
      <div className="mb-6">
        <input
          type="text"
          placeholder="Search by customer name or email..."
          className="w-full max-w-md rounded-warm-lg border border-border bg-surface px-4 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {/* Error state */}
      {error && (
        <div className="mb-6 rounded-warm-lg bg-danger-light border border-danger/20 p-4 text-danger">
          {error}
        </div>
      )}

      {/* Loading state */}
      {loading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
        </div>
      ) : quotes.length === 0 ? (
        <EmptyState
          title={QUOTE_TURN_COPY.empty[group]}
          description={
            search
              ? 'No quotes match your search. Try a different name or email.'
              : group === 'all'
                ? 'Quotes will appear here once customers submit requests through your widget. Embed the widget on your website to start receiving quotes.'
                : 'Quotes show here when they reach this stage.'
          }
          icon={
            <svg className="h-12 w-12" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          }
          action={
            !search && group === 'all'
              ? {
                  label: 'Share your quote link',
                  href: '/app/share',
                }
              : undefined
          }
        />
      ) : (
        <>
          {/* Quotes: a grid on a wide screen, stacked rows on a phone */}
          <div className="rounded-xl border border-border bg-background">
            <div className={`hidden border-b border-border px-6 py-4 text-[11px] font-bold uppercase tracking-widest text-text-muted ${ROW_GRID}`}>
              <span>Customer</span>
              <span>Service</span>
              <span>Total</span>
              <span>Status</span>
              <span className="text-right">{QUOTE_TURN_COPY.nextStepColumn}</span>
            </div>
            <ul className="divide-y divide-border">
              {quotes.map((quote) => {
                const turn = quoteTurn({
                  status: quote.status,
                  customerName: quote.customerName,
                  hasEmail: Boolean(quote.customerEmail),
                  total: quote.total,
                  held: quote.held === true,
                  createdAt: quote.createdAt,
                  sentAt: quote.sentAt,
                  viewedAt: quote.viewedAt,
                  acceptedAt: quote.acceptedAt,
                  paidAt: quote.paidAt,
                  declinedAt: quote.declinedAt,
                  expiresAt: quote.expiresAt,
                })
                const busy = actionLoading === quote.quoteId
                const href = `/app/quotes/${quote.quoteId}`
                return (
                  <li
                    key={quote.quoteId}
                    className={`flex flex-col gap-3 px-4 py-4 transition-colors hover:bg-surface sm:px-6 ${ROW_GRID}`}
                    data-testid="quote-row"
                    data-quote-id={quote.quoteId}
                    data-group={turn.group}
                  >
                    <div className="min-w-0">
                      <Link href={href} className="block truncate text-sm font-semibold text-text-primary hover:underline">
                        {quote.customerName}
                        {quote.isTest && <TestBadge />}
                      </Link>
                      {quote.customerEmail && <div className="truncate text-sm text-text-secondary">{quote.customerEmail}</div>}
                    </div>
                    <div className="min-w-0 truncate text-sm text-text-primary">{quote.serviceName}</div>
                    <div className="figure text-sm font-medium text-text-primary">
                      {quote.total > 0 ? formatCurrency(quote.total, quote.currency) : '—'}
                    </div>
                    <TurnBadge turn={turn} />
                    <div className="flex items-center gap-2 xl:justify-end">
                      {turn.action === 'send_again' ? (
                        <button
                          type="button"
                          onClick={() => handleResendEmail(quote.quoteId)}
                          disabled={busy}
                          className="rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary-hover disabled:opacity-50"
                          data-testid="next-step-button"
                        >
                          {busy ? QUOTE_TURN_COPY.pageButtons.sendingAgain : turn.buttonLabel}
                        </button>
                      ) : turn.action ? (
                        <Link
                          href={href}
                          className="rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary-hover"
                          data-testid="next-step-button"
                        >
                          {turn.buttonLabel}
                        </Link>
                      ) : null}
                      <QuoteRowMenu
                        quoteId={quote.quoteId}
                        items={menuItems(quote, turn.action === 'send_again')}
                        open={openMenu === quote.quoteId}
                        busy={busy}
                        onToggle={() => setOpenMenu((current) => (current === quote.quoteId ? null : quote.quoteId))}
                        onClose={closeMenu}
                      />
                      {busy && <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary"></div>}
                    </div>
                  </li>
                )
              })}
            </ul>
          </div>

          {/* Load more button */}
          {nextCursor && (
            <div className="mt-6 text-center">
              <button
                onClick={() => fetchQuotes(nextCursor, true)}
                disabled={loadingMore}
                className="px-4 py-2 text-sm font-medium text-primary hover:text-primary-hover disabled:opacity-50 transition-colors"
              >
                {loadingMore ? (
                  <span className="flex items-center gap-2">
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary"></div>
                    Loading...
                  </span>
                ) : (
                  'Load more'
                )}
              </button>
            </div>
          )}
        </>
      )}
      </>)}
    </div>
  )
}

/** T-150: the owner's test request from setup */
function TestBadge() {
  return (
    <span className="ml-2 inline-flex items-center rounded-full bg-butter px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-tertiary" title="A test request from setup. It doesn't count toward your plan.">
      Test
    </span>
  )
}
