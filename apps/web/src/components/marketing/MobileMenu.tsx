'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import { PRODUCT_NAME, freeOfferLabel } from '@estimator/shared'
import { NAV_LINKS } from '@/lib/marketing/nav'
import { lockPageScroll } from '@/lib/marketing/scroll-lock'

/**
 * Each marketing page renders its own nav, so a link to another page mounts a
 * new menu button: this tells the new one to take focus. Module scope survives
 * client-side navigation.
 */
let focusButtonOnMount = false

/**
 * T-154: a working menu on small screens (hidden from md up).
 * T-155: when open it covers the whole screen (nothing of the page shows
 * behind it, and the page can't scroll), with the five links and one sign-up
 * button. Closes on a link, the X or Escape, and gives focus back to the
 * menu button.
 */
export function MobileMenu({ defaultOpen = false }: { defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  const pathname = usePathname()
  const buttonRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)

  const close = useCallback(() => {
    setOpen(false)
    // after the panel unmounts, the menu button is focusable again
    requestAnimationFrame(() => buttonRef.current?.focus())
  }, [])

  useEffect(() => setOpen(false), [pathname])

  useEffect(() => {
    if (!focusButtonOnMount) return
    focusButtonOnMount = false
    buttonRef.current?.focus()
  }, [])

  const onLink = (href: string) => {
    if (href === pathname) return close()
    focusButtonOnMount = true
    setOpen(false)
  }

  useEffect(() => {
    if (!open) return
    const unlock = lockPageScroll(document.documentElement, document.body)
    closeRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        close()
        return
      }
      if (e.key !== 'Tab' || !panelRef.current) return
      // keep Tab inside the open menu
      const items = [...panelRef.current.querySelectorAll<HTMLElement>('a[href], button')]
      const first = items[0]
      const last = items[items.length - 1]
      if (!first || !last) return
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
    // widening past the phone layout hides the menu: unlock the page too
    const wide = window.matchMedia('(min-width: 768px)')
    const onWide = () => wide.matches && setOpen(false)
    document.addEventListener('keydown', onKey)
    wide.addEventListener('change', onWide)
    return () => {
      unlock()
      document.removeEventListener('keydown', onKey)
      wide.removeEventListener('change', onWide)
    }
  }, [open, close])

  return (
    <div className="md:hidden">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen(true)}
        aria-expanded={open}
        aria-controls="site-menu"
        aria-label="Open menu"
        className="inline-flex h-11 w-11 items-center justify-center rounded-lg text-text-primary hover:bg-surface"
        data-testid="site-menu-button"
      >
        <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
          <path strokeLinecap="round" d="M4 7h16M4 12h16M4 17h16" />
        </svg>
      </button>
      {open && (
        <div
          ref={panelRef}
          id="site-menu"
          role="dialog"
          aria-modal="true"
          aria-label="Menu"
          className="fixed inset-0 z-50 flex flex-col overflow-y-auto overscroll-contain bg-background"
          data-testid="site-menu"
        >
          <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
            <span className="inline-flex min-h-[44px] items-center font-display text-lg font-extrabold tracking-tight text-text-primary">{PRODUCT_NAME}</span>
            <button
              ref={closeRef}
              type="button"
              onClick={close}
              aria-label="Close menu"
              className="inline-flex h-11 w-11 items-center justify-center rounded-lg text-text-primary hover:bg-surface"
              data-testid="site-menu-close"
            >
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                <path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>
          <ul className="px-4 py-2">
            {NAV_LINKS.map((l) => (
              <li key={l.href}>
                <Link href={l.href} onClick={() => onLink(l.href)} className="flex min-h-[48px] items-center border-b border-border/60 text-base font-semibold text-text-primary">
                  {l.label}
                </Link>
              </li>
            ))}
          </ul>
          <div className="px-4 pb-8 pt-4">
            <Link
              href="/signup"
              onClick={() => onLink('/signup')}
              className="flex min-h-[48px] w-full items-center justify-center rounded-lg bg-primary px-6 py-3 text-center text-sm font-semibold text-white transition-colors hover:bg-primary-hover"
              data-testid="site-menu-signup"
            >
              {freeOfferLabel()}
            </Link>
          </div>
        </div>
      )}
    </div>
  )
}
