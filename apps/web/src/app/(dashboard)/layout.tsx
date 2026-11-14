'use client'

import { usePathname, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { Suspense, useCallback, useEffect, useState } from 'react'
import { PRODUCT_NAME, QUOTE_TURN_COPY } from '@estimator/shared'
import { UNFINISHED_CHANGED_EVENT } from '@/lib/unfinished-leads'

/**
 * Dashboard shell — "the studio desk", panel edition.
 * A floating inset left panel (white card, detached from the edges) over the
 * continuous porcelain plane — platform structure, modern materials.
 * No edge-to-edge walls, no dark panels.
 */
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const pathname = usePathname()
  // T-160: unfinished requests the business has not seen yet (the menu badge).
  // Read again on every page change, and when the Unfinished list says it changed.
  const [newUnfinished, setNewUnfinished] = useState(0)
  const loadNewUnfinished = useCallback(() => {
    fetch('/api/leads/new-count')
      .then((res) => (res.ok ? res.json() : null))
      .then((json: { count?: number } | null) => {
        if (typeof json?.count === 'number') setNewUnfinished(json.count)
      })
      .catch(() => undefined)
  }, [])
  useEffect(() => {
    loadNewUnfinished()
  }, [loadNewUnfinished, pathname])
  useEffect(() => {
    window.addEventListener(UNFINISHED_CHANGED_EVENT, loadNewUnfinished)
    return () => window.removeEventListener(UNFINISHED_CHANGED_EVENT, loadNewUnfinished)
  }, [loadNewUnfinished])
  const closeMenu = useCallback(() => setSidebarOpen(false), [])

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

      {/* Navigation — T-160: three sections (Work, Set up, Account). The same
          panel is the phone menu. SMS has no item; /app/sms opens by address. */}
      <nav className="flex-1 overflow-y-auto px-3 pb-3" aria-label="Main">
        {/* The Unfinished item is told apart from Quotes by the address's
            ?filter, which needs a Suspense boundary on prerendered pages */}
        <Suspense fallback={<NavSections pathname={pathname} filter={null} badge={newUnfinished} onNavigate={closeMenu} />}>
          <NavWithFilter pathname={pathname} badge={newUnfinished} onNavigate={closeMenu} />
        </Suspense>
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

type NavKey = 'home' | 'quotes' | 'unfinished' | 'analytics' | 'services' | 'quote-link' | 'whatsapp' | 'settings'

interface NavEntry {
  key: NavKey
  href: string
  label: string
  icon: React.ComponentType<{ className?: string }>
}

const M = QUOTE_TURN_COPY.menu

/** T-160 (AD-044): the menu in sections. Labels come from the shared map. */
const NAV_SECTIONS: Array<{ key: 'work' | 'set-up' | 'account'; label: string; items: NavEntry[] }> = [
  {
    key: 'work',
    label: M.sections.work,
    items: [
      { key: 'home', href: '/app', label: M.home, icon: HomeIcon },
      { key: 'quotes', href: '/app/quotes', label: M.quotes, icon: QuotesIcon },
      // The Unfinished tab of the quotes list
      { key: 'unfinished', href: '/app/quotes?filter=unfinished', label: M.unfinished, icon: UnfinishedIcon },
      { key: 'analytics', href: '/app/analytics', label: M.analytics, icon: AnalyticsIcon },
    ],
  },
  {
    key: 'set-up',
    label: M.sections.setUp,
    items: [
      { key: 'services', href: '/app/services', label: M.services, icon: PricesIcon },
      { key: 'quote-link', href: '/app/quote-link', label: M.quoteLink, icon: ShareIcon },
      { key: 'whatsapp', href: '/app/whatsapp', label: M.whatsapp, icon: WhatsAppIcon },
    ],
  },
  {
    key: 'account',
    label: M.sections.account,
    items: [{ key: 'settings', href: '/app/settings', label: M.settings, icon: SettingsIcon }],
  },
]

/** Which item the current address belongs to */
function isActiveItem(key: NavKey, href: string, pathname: string, filter: string | null): boolean {
  const onUnfinished = pathname === '/app/quotes' && filter === 'unfinished'
  if (key === 'home') return pathname === '/app'
  if (key === 'unfinished') return onUnfinished
  if (key === 'quotes') return !onUnfinished && (pathname === '/app/quotes' || pathname.startsWith('/app/quotes/'))
  return pathname === href || pathname.startsWith(`${href}/`)
}

function NavWithFilter(props: { pathname: string; badge: number; onNavigate: () => void }) {
  const filter = useSearchParams().get('filter')
  return <NavSections {...props} filter={filter} />
}

function NavSections({
  pathname,
  filter,
  badge,
  onNavigate,
}: {
  pathname: string
  filter: string | null
  badge: number
  onNavigate: () => void
}) {
  return (
    <div className="space-y-4">
      {NAV_SECTIONS.map((section) => (
        <div key={section.key} data-testid="nav-section" data-section={section.key}>
          <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-text-muted">{section.label}</p>
          <div className="space-y-0.5">
            {section.items.map((item) => (
              <NavItem
                key={item.key}
                item={item}
                active={isActiveItem(item.key, item.href, pathname, filter)}
                badge={item.key === 'unfinished' ? badge : 0}
                onNavigate={onNavigate}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

function NavItem({ item, active, badge, onNavigate }: { item: NavEntry; active: boolean; badge: number; onNavigate: () => void }) {
  const Icon = item.icon
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? 'page' : undefined}
      data-testid="nav-item"
      data-key={item.key}
      className={`flex items-center gap-3 rounded-warm-lg px-3 py-2.5 text-[15px] transition-colors ${
        active
          ? 'bg-mint text-primary font-semibold'
          : 'text-text-secondary font-medium hover:bg-surface hover:text-text-primary'
      }`}
    >
      <Icon className={`h-5 w-5 flex-shrink-0 ${active ? 'text-primary' : 'text-text-muted'}`} />
      <span className="min-w-0 flex-1 truncate">{item.label}</span>
      {badge > 0 && (
        <span
          className="figure rounded-full bg-butter px-2 py-0.5 text-xs font-semibold text-tertiary"
          data-testid="nav-badge"
          aria-label={`${badge} new`}
        >
          {badge}
        </span>
      )}
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

function UnfinishedIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  )
}

function AnalyticsIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
    </svg>
  )
}

function WhatsAppIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z" />
    </svg>
  )
}
