/**
 * Empty State Component
 *
 * Used as a placeholder for dashboard pages that are not yet implemented.
 */

import Link from 'next/link'
import { Button } from '@/components/ui/Button'

interface EmptyStateProps {
  title: string
  description: string
  icon?: React.ReactNode
  action?: {
    label: string
    href: string
  }
}

export function EmptyState({ title, description, icon, action }: EmptyStateProps) {
  return (
    <div className="flex min-h-[400px] flex-col items-center justify-center rounded-warm-2xl border-2 border-dashed border-border bg-surface p-12 text-center">
      {icon && <div className="mb-4 text-text-muted">{icon}</div>}
      <h3 className="text-lg font-medium text-text-primary">{title}</h3>
      <p className="mt-2 max-w-md text-sm text-text-secondary">{description}</p>
      {action && (
        <Link href={action.href} className="mt-6">
          <Button>{action.label}</Button>
        </Link>
      )}
    </div>
  )
}

/**
 * Page Header Component — re-exported from ui for backwards compatibility
 */
export { PageHeader } from '@/components/ui/PageHeader'

/**
 * Coming Soon Badge
 */
export function ComingSoonBadge() {
  return (
    <span className="ml-2 inline-flex items-center rounded-full bg-tertiary-light px-2 py-0.5 text-xs font-medium text-tertiary">
      Coming Soon
    </span>
  )
}
