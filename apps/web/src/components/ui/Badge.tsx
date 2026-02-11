import { cn } from '@/lib/cn'

type BadgeVariant = 'processing' | 'success' | 'danger' | 'info' | 'neutral' | 'ai'

interface BadgeProps {
  variant?: BadgeVariant
  className?: string
  children: React.ReactNode
}

const variantStyles: Record<BadgeVariant, string> = {
  processing: 'bg-primary-light text-primary',
  success: 'bg-secondary-light text-secondary',
  danger: 'bg-danger-light text-danger',
  info: 'bg-primary-light text-primary',
  neutral: 'bg-background text-text-secondary border border-border',
  ai: 'bg-tertiary-light text-tertiary',
}

export function Badge({ variant = 'neutral', className, children }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold',
        variantStyles[variant],
        className,
      )}
    >
      {children}
    </span>
  )
}
