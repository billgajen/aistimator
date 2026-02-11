import { cn } from '@/lib/cn'

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  hover?: boolean
  children: React.ReactNode
}

export function Card({ hover = false, className, children, ...props }: CardProps) {
  return (
    <div
      className={cn(
        'rounded-xl border border-border bg-background',
        hover && 'transition-shadow hover:shadow-warm-hover',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  )
}

interface CardHeaderProps {
  title: string
  description?: string
  actions?: React.ReactNode
  className?: string
}

export function CardHeader({ title, description, actions, className }: CardHeaderProps) {
  return (
    <div className={cn('flex items-start justify-between border-b border-border px-6 py-4', className)}>
      <div>
        <h3 className="font-display text-lg font-bold text-text-primary">{title}</h3>
        {description && (
          <p className="mt-0.5 text-sm text-text-secondary">{description}</p>
        )}
      </div>
      {actions && <div className="flex gap-2">{actions}</div>}
    </div>
  )
}

interface CardContentProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode
}

export function CardContent({ className, children, ...props }: CardContentProps) {
  return (
    <div className={cn('px-6 py-4', className)} {...props}>
      {children}
    </div>
  )
}
