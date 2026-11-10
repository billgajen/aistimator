'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import { NAV_LINKS } from '@/lib/marketing/nav'

/** T-154: a working menu on small screens (hidden from md up) */
export function MobileMenu() {
  const [open, setOpen] = useState(false)
  const pathname = usePathname()
  useEffect(() => setOpen(false), [pathname])

  return (
    <div className="md:hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="site-menu"
        aria-label={open ? 'Close menu' : 'Open menu'}
        className="inline-flex h-11 w-11 items-center justify-center rounded-lg text-text-primary hover:bg-surface"
        data-testid="site-menu-button"
      >
        <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
          {open ? <path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" /> : <path strokeLinecap="round" d="M4 7h16M4 12h16M4 17h16" />}
        </svg>
      </button>
      {open && (
        <div id="site-menu" className="absolute inset-x-0 top-full border-b border-border bg-background shadow-warm-md" data-testid="site-menu">
          <ul className="mx-auto max-w-6xl px-4 py-2">
            {NAV_LINKS.map((l) => (
              <li key={l.href}>
                <Link href={l.href} onClick={() => setOpen(false)} className="flex min-h-[48px] items-center border-b border-border/60 text-base font-semibold text-text-primary last:border-0">
                  {l.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
