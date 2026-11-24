'use client'

import { useEffect } from 'react'
import { OWN_VISIT_PARAM } from '@/lib/quote-link-url'

/**
 * T-201: the dashboard's "Open" buttons mark the quote link as the business's
 * own visit (`?own=1`), so it does not tick "Share your quote link". This
 * takes the mark off the address bar once the page is open: a business that
 * then copies the address from its browser sends its customers the plain link.
 */
export function OwnVisitMark() {
  useEffect(() => {
    try {
      const url = new URL(window.location.href)
      if (!url.searchParams.has(OWN_VISIT_PARAM)) return
      url.searchParams.delete(OWN_VISIT_PARAM)
      window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`)
    } catch {
      // the address stays as it is; nothing depends on this
    }
  }, [])
  return null
}
