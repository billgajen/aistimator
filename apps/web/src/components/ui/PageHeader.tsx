import { cn } from '@/lib/cn'

interface PageHeaderProps {
  title: React.ReactNode
  description?: string
  actions?: React.ReactNode
  /** T-207: something small under the title and its line (a page's guide link) */
  below?: React.ReactNode
  /**
   * T-208: from 768 px the actions keep the title's row and are never wrapped; the title's block gives way
   * instead (its line wraps). For a page whose buttons would otherwise drop under the title at tablet widths.
   * Under 768 px they wrap under the title as on every page.
   */
  actionsBeside?: boolean
  className?: string
}

export function PageHeader({ title, description, actions, below, actionsBeside, className }: PageHeaderProps) {
  return (
    <div className={cn('mb-8', className)}>
      {/* T-169: the actions wrap under the title on a narrow screen, never push the page wider */}
      <div className={cn('flex flex-wrap items-start justify-between gap-4', actionsBeside && 'md:flex-nowrap')}>
        <div className="min-w-0">
          <h1 className="font-display text-3xl font-bold tracking-tight text-text-primary">{title}</h1>
          {description && (
            <p className="mt-1.5 text-sm text-text-secondary">{description}</p>
          )}
          {below && <div className="mt-1.5">{below}</div>}
        </div>
        {actions && <div className={cn('flex max-w-full flex-wrap gap-3', actionsBeside && 'md:shrink-0 md:flex-nowrap')}>{actions}</div>}
      </div>
      <div className="tape-rule mt-5 opacity-60" />
    </div>
  )
}
