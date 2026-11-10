'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

/** T-152: the tabs of the one Settings area. */
export const SETTINGS_TABS = [
  { href: '/app/settings', label: 'Business' },
  { href: '/app/settings/branding', label: 'Branding' },
  { href: '/app/settings/billing', label: 'Billing' },
  { href: '/app/settings/notifications', label: 'Notifications' },
] as const

export function SettingsTabs({ brandingDone }: { brandingDone: boolean }) {
  const pathname = usePathname()
  return (
    <nav aria-label="Settings" className="-mx-1 flex gap-1 overflow-x-auto border-b border-border px-1">
      {SETTINGS_TABS.map((tab) => {
        const active = tab.href === '/app/settings' ? pathname === tab.href : pathname.startsWith(tab.href)
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? 'page' : undefined}
            className={`-mb-px inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm transition-colors ${
              active
                ? 'border-primary font-semibold text-primary'
                : 'border-transparent font-medium text-text-secondary hover:text-text-primary'
            }`}
          >
            {tab.label}
            {tab.label === 'Branding' && brandingDone && (
              <svg className="h-3.5 w-3.5 text-primary" fill="currentColor" viewBox="0 0 20 20" aria-label="Set up" data-testid="branding-done">
                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
              </svg>
            )}
          </Link>
        )
      })}
    </nav>
  )
}
