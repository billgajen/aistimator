'use client'

import { usePathname } from 'next/navigation'
import Link from 'next/link'
import { useState } from 'react'
import { PRODUCT_NAME } from '@estimator/shared'

/**
 * Dashboard shell — "the studio desk", panel edition.
 * A floating inset left panel (white card, detached from the edges) over the
 * continuous porcelain plane — platform structure, modern materials.
 * No edge-to-edge walls, no dark panels.
 */
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false)

  const panel = (
    <div className="flex h-full flex-col rounded-warm-2xl bg-white shadow-warm-md">
      {/* Wordmark */}
      <div className="px-5 pt-5 pb-4">
        <Link href="/app" className="group inline-block">
          <span className="font-display text-[22px] font-bold tracking-tight text-text-primary">
            {PRODUCT_NAME}
          </span>
          <div className="tape-rule mt-1.5 w-24 opacity-50 group-hover:opacity-90 transition-opacity" />
        </Link>
      </div>

      {/* Navigation — T-152: five items. Analytics opens from Home ("See all
          numbers"); SMS and WhatsApp pages stay reachable by URL (WhatsApp is
          on Share). */}
      <nav className="flex-1 overflow-y-auto px-3" aria-label="Main">
        <div className="space-y-0.5">
          {NAV_ITEMS.map((item) => (
            <NavItem key={item.href} {...item} />
          ))}
        </div>
      </nav>

      {/* Sign out */}
      <div className="border-t border-border px-3 py-3">
        <form action="/api/auth/signout" method="POST">
          <button
            type="submit"
            className="flex w-full items-center gap-3 rounded-warm-lg px-3 py-2.5 text-[15px] font-medium text-text-muted hover:bg-surface hover:text-text-primary transition-colors"
          >
            <SignOutIcon className="h-5 w-5" />
            Sign out
          </button>
        </form>
      </div>
    </div>
  )

  return (
    <div className="min-h-screen bg-background">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-ink/40 backdrop-blur-[2px] lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Floating panel — desktop fixed, mobile slide-in */}
      <aside
        className={`fixed inset-y-3 left-3 z-50 w-72 transform transition-transform duration-200 lg:translate-x-0 ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-[calc(100%+1rem)]'
        }`}
      >
        {panel}
      </aside>

      {/* Main content */}
      <div className="lg:pl-[19.5rem]">
        {/* Mobile top bar */}
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border/80 bg-background/90 backdrop-blur-md px-4 lg:hidden">
          <button
            onClick={() => setSidebarOpen(true)}
            aria-label="Open menu"
            className="text-text-primary p-1"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 7h16M4 12h16M4 17h16" />
            </svg>
          </button>
          <span className="font-display text-lg font-bold tracking-tight text-text-primary">{PRODUCT_NAME}</span>
        </header>

        <main className="animate-fade-in-up mx-auto max-w-[1860px] px-4 py-8 sm:px-8 sm:py-10">
          {children}
        </main>
      </div>
    </div>
  )
}

// Navigation components

const NAV_ITEMS: Array<{ href: string; label: string; icon: React.ComponentType<{ className?: string }>; exact?: boolean }> = [
  { href: '/app', label: 'Home', icon: HomeIcon, exact: true },
  { href: '/app/quotes', label: 'Quotes', icon: QuotesIcon },
  { href: '/app/prices', label: 'Prices', icon: PricesIcon },
  { href: '/app/share', label: 'Share', icon: ShareIcon },
  { href: '/app/settings', label: 'Settings', icon: SettingsIcon },
]

function NavItem({
  href,
  icon: Icon,
  label,
  exact = false,
}: {
  href: string
  icon: React.ComponentType<{ className?: string }>
  label: string
  exact?: boolean
}) {
  const pathname = usePathname()
  const isActive = exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`)

  return (
    <Link
      href={href}
      className={`flex items-center gap-3 rounded-warm-lg px-3 py-2.5 text-[15px] transition-colors ${
        isActive
          ? 'bg-mint text-primary font-semibold'
          : 'text-text-secondary font-medium hover:bg-surface hover:text-text-primary'
      }`}
    >
      <Icon className={`h-5 w-5 flex-shrink-0 ${isActive ? 'text-primary' : 'text-text-muted'}`} />
      {label}
    </Link>
  )
}

// Icons

function HomeIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
    </svg>
  )
}

function PricesIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.568 3H5.25A2.25 2.25 0 003 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581c.699.699 1.78.872 2.607.33a18.095 18.095 0 005.223-5.223c.542-.827.369-1.908-.33-2.607L11.16 3.66A2.25 2.25 0 009.568 3z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6 6h.008v.008H6V6z" />
    </svg>
  )
}

function ShareIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244" />
    </svg>
  )
}

function QuotesIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
    </svg>
  )
}

function SettingsIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  )
}

function SignOutIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
    </svg>
  )
}
