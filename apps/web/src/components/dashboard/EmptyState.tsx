/**
 * Empty State Component
 *
 * Used as a placeholder for dashboard pages that are not yet implemented.
 */

import Link from 'next/link'

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
    <div className="flex min-h-[400px] flex-col items-center justify-center rounded-lg border-2 border-dashed border-gray-300 bg-white p-12 text-center">
      {icon && <div className="mb-4 text-gray-400">{icon}</div>}
      <h3 className="text-lg font-medium text-gray-900">{title}</h3>
      <p className="mt-2 max-w-md text-sm text-gray-500">{description}</p>
      {action && (
        <Link
          href={action.href}
          className="mt-6 inline-flex items-center rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          {action.label}
        </Link>
      )}
    </div>
  )
}

/**
 * Page Header Component
 */
interface PageHeaderProps {
  title: React.ReactNode
  description?: string
  actions?: React.ReactNode
}

export function PageHeader({ title, description, actions }: PageHeaderProps) {
  return (
    <div className="mb-8 flex items-start justify-between">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">{title}</h1>
        {description && <p className="mt-1 text-sm text-gray-500">{description}</p>}
      </div>
      {actions && <div className="flex gap-3">{actions}</div>}
    </div>
  )
}

/**
 * Coming Soon Badge
 */
export function ComingSoonBadge() {
  return (
    <span className="ml-2 inline-flex items-center rounded-full bg-yellow-100 px-2 py-0.5 text-xs font-medium text-yellow-800">
      Coming Soon
    </span>
  )
}
