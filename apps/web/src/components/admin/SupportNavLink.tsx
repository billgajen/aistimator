'use client'

/**
 * T-197: the admin menu's Support item, with the count of new items (problems
 * still "New", feature requests not opened yet). Read again on every page
 * change; a count that cannot be read shows no number. It takes the admin
 * bar's own link style from the layout, so the bar's colours stay in one file.
 */
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'

export function SupportNavLink({ className }: { className: string }) {
  const pathname = usePathname()
  const [count, setCount] = useState(0)
  useEffect(() => {
    fetch('/api/admin/support?count=1')
      .then((res) => (res.ok ? res.json() : null))
      .then((json: { count?: number } | null) => {
        if (typeof json?.count === 'number') setCount(json.count)
      })
      .catch(() => undefined)
  }, [pathname])
  return (
    <Link href="/admin/support" className={`inline-flex items-center gap-2 ${className}`} data-testid="admin-support-link">
      Support
      {count > 0 && (
        <span className="figure rounded-full bg-accent px-2 py-0.5 text-xs font-semibold text-on-accent" data-testid="admin-support-count" aria-label={`${count} new`}>
          {count}
        </span>
      )}
    </Link>
  )
}
