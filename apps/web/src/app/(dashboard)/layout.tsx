'use client'

import { usePathname } from 'next/navigation'
import Link from 'next/link'
import { useState } from 'react'

/**
 * Dashboard shell — "the studio desk".
 * No sidebar: a slim top bar with horizontal navigation, content floating
 * centered on one continuous porcelain plane. Navigation is furniture;
 * the work is the room.
 */

const NAV = [
  { href: '/app', label: 'Home', exact: true },
  { href: '/app/quotes', label: 'Quotes' },
  { href: '/app/services', label: 'Services' },
  { href: '/app/widget', label: 'Widget' },
  { href: '/app/analytics', label: 'Analytics' },
] as const

const MORE = [
  { href: '/app/branding', label: 'Branding' },
  { href: '/app/billing', label: 'Billing' },
  { href: '/app/settings', label: 'Settings' },
] as const

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [menuOpen, setMenuOpen] = useState(false)
  const pathname = usePathname()

  return (
    <div className="min-h-screen bg-background">
      {/* Top bar */}
      <header className="sticky top-0 z-40 border-b border-border/80 bg-background/90 backdrop-blur-md">
        <div className="mx-auto flex h-[60px] max-w-6xl items-center gap-6 px-4 sm:px-6">
          {/* Wordmark */}
          <Link href="/app" className="group flex items-baseline gap-2 shrink-0">
            <span className="font-display text-lg font-bold tracking-tight text-text-primary">
              Aistimator
            </span>
            <span className="hidden sm:block tape-rule w-8 opacity-50 group-hover:opacity-90 transition-opacity" />
          </Link>

          {/* Primary nav */}
          <nav className="hidden md:flex items-center gap-1">
            {NAV.map((item) => (
              <TopNavItem key={item.href} {...item} />
            ))}
            <MoreMenu items={MORE} pathname={pathname} />
          </nav>

          <div className="flex-1" />

          {/* Right side */}
          <div className="hidden md:flex items-center gap-2">
            <form action="/api/auth/signout" method="POST">
              <button
                type="submit"
                className="rounded-full px-3.5 py-1.5 text-[13px] font-medium text-text-muted hover:text-text-primary hover:bg-surface transition-colors"
              >
                Sign out
              </button>
            </form>
          </div>

          {/* Mobile menu button */}
          <button
            onClick={() => setMenuOpen(!menuOpen)}
            aria-label="Menu"
            className="md:hidden text-text-primary p-1"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              {menuOpen ? (
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              ) : (
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 7h16M4 12h16M4 17h16" />
              )}
            </svg>
          </button>
        </div>

        {/* Mobile menu sheet */}
        {menuOpen && (
          <div className="md:hidden border-t border-border bg-background px-4 pb-4 pt-2">
            {[...NAV, ...MORE].map((item) => {
              const isActive = 'exact' in item && item.exact ? pathname === item.href : pathname.startsWith(item.href)
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMenuOpen(false)}
                  className={`block rounded-warm-lg px-3 py-2.5 text-[15px] transition-colors ${
                    isActive
                      ? 'bg-mint text-primary font-semibold'
                      : 'text-text-secondary font-medium hover:bg-surface'
                  }`}
                >
                  {item.label}
                </Link>
              )
            })}
            <form action="/api/auth/signout" method="POST" className="mt-2 border-t border-border pt-2">
              <button
                type="submit"
                className="block w-full rounded-warm-lg px-3 py-2.5 text-left text-[15px] font-medium text-text-secondary hover:bg-surface transition-colors"
              >
                Sign out
              </button>
            </form>
          </div>
        )}
      </header>

      {/* Page content — one centered plane */}
      <main className="animate-fade-in-up mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-10">
        {children}
      </main>
    </div>
  )
}

function TopNavItem({ href, label, exact = false }: { href: string; label: string; exact?: boolean }) {
  const pathname = usePathname()
  const isActive = exact ? pathname === href : pathname.startsWith(href)

  return (
    <Link
      href={href}
      className={`relative rounded-full px-3.5 py-1.5 text-[13.5px] transition-colors ${
        isActive
          ? 'text-primary font-semibold bg-mint'
          : 'text-text-secondary font-medium hover:text-text-primary hover:bg-surface'
      }`}
    >
      {label}
    </Link>
  )
}

function MoreMenu({
  items,
  pathname,
}: {
  items: readonly { href: string; label: string }[]
  pathname: string
}) {
  const [open, setOpen] = useState(false)
  const anyActive = items.some((i) => pathname.startsWith(i.href))

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        className={`flex items-center gap-1 rounded-full px-3.5 py-1.5 text-[13.5px] transition-colors ${
          anyActive
            ? 'text-primary font-semibold bg-mint'
            : 'text-text-secondary font-medium hover:text-text-primary hover:bg-surface'
        }`}
      >
        More
        <svg className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-2 w-44 rounded-warm-xl border border-border bg-background p-1.5 shadow-warm-lg">
          {items.map((item) => {
            const isActive = pathname.startsWith(item.href)
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`block rounded-warm-lg px-3 py-2 text-[13.5px] transition-colors ${
                  isActive
                    ? 'bg-mint text-primary font-semibold'
                    : 'text-text-secondary font-medium hover:bg-surface hover:text-text-primary'
                }`}
              >
                {item.label}
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
