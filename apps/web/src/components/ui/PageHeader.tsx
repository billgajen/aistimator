import { cn } from '@/lib/cn'

interface PageHeaderProps {
  title: React.ReactNode
  description?: string
  actions?: React.ReactNode
  className?: string
}

export function PageHeader({ title, description, actions, className }: PageHeaderProps) {
  return (
    <div className={cn('mb-8', className)}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-bold tracking-tight text-text-primary">{title}</h1>
          {description && (
            <p className="mt-1.5 text-sm text-text-secondary">{description}</p>
          )}
        </div>
        {actions && <div className="flex gap-3 shrink-0">{actions}</div>}
      </div>
      <div className="tape-rule mt-5 opacity-60" />
    </div>
  )
}
