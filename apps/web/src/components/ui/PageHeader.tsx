import { cn } from '@/lib/cn'

interface PageHeaderProps {
  title: React.ReactNode
  description?: string
  actions?: React.ReactNode
  /** T-207: something small under the title and its line (a page's guide link) */
  below?: React.ReactNode
  className?: string
}

export function PageHeader({ title, description, actions, below, className }: PageHeaderProps) {
  return (
    <div className={cn('mb-8', className)}>
      {/* T-169: the actions wrap under the title on a narrow screen, never push the page wider */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="font-display text-3xl font-bold tracking-tight text-text-primary">{title}</h1>
          {description && (
            <p className="mt-1.5 text-sm text-text-secondary">{description}</p>
          )}
          {below && <div className="mt-1.5">{below}</div>}
        </div>
        {actions && <div className="flex max-w-full flex-wrap gap-3">{actions}</div>}
      </div>
      <div className="tape-rule mt-5 opacity-60" />
    </div>
  )
}
