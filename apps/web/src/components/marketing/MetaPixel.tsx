'use client'

/**
 * Meta Pixel for OUR marketing pages (T-144). Rendered by SiteNav and the
 * signup page only, never the dashboard, the widget or a customer's quote
 * page. Off without NEXT_PUBLIC_META_PIXEL_ID, and off when the browser sends
 * Global Privacy Control (a legal opt-out signal in several US states).
 */
import Script from 'next/script'
import { useEffect, useState } from 'react'

type Fbq = (...args: unknown[]) => void
declare global {
  interface Window {
    fbq?: Fbq
  }
  interface Navigator {
    globalPrivacyControl?: boolean
  }
}

const PIXEL_ID = process.env.NEXT_PUBLIC_META_PIXEL_ID

function trackingAllowed(): boolean {
  return Boolean(PIXEL_ID) && typeof navigator !== 'undefined' && navigator.globalPrivacyControl !== true
}

/** Fire a standard event with a dedup id shared with the Conversions API. */
export function trackMeta(eventName: string, params: Record<string, unknown> = {}, eventId?: string): void {
  if (!trackingAllowed() || typeof window === 'undefined' || !window.fbq) return
  window.fbq('track', eventName, params, eventId ? { eventID: eventId } : undefined)
}

export function MetaPixel() {
  const [allowed, setAllowed] = useState(false)
  useEffect(() => setAllowed(trackingAllowed()), [])
  if (!allowed) return null
  return (
    <Script id="meta-pixel" strategy="afterInteractive">
      {`!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init',${JSON.stringify(PIXEL_ID)});fbq('track','PageView');`}
    </Script>
  )
}
