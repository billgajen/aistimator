import { cn } from '@/lib/cn'

interface PageHeaderProps {
  title: React.ReactNode
  description?: string
  actions?: React.ReactNode
  className?: string
}

export function PageHeader({ title, description, actions, className }: PageHeaderProps) {
  return (
    <div className={cn('mb-8 flex items-start justify-between', className)}>
      <div>
        <h1 className="font-display text-3xl font-extrabold tracking-tight text-text-primary">{title}</h1>
        {description && (
          <p className="mt-1 text-sm text-text-secondary">{description}</p>
        )}
      </div>
      {actions && <div className="flex gap-3">{actions}</div>}
    </div>
  )
}
