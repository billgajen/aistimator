import { cn } from '@/lib/cn'
import { forwardRef } from 'react'

interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string
  error?: string
  helpText?: string
  children: React.ReactNode
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  function Select({ label, error, helpText, className, id, children, ...props }, ref) {
    const selectId = id || (label ? label.toLowerCase().replace(/\s+/g, '-') : undefined)

    return (
      <div>
        {label && (
          <label
            htmlFor={selectId}
            className="mb-1.5 block text-sm font-medium text-text-primary"
          >
            {label}
          </label>
        )}
        <select
          ref={ref}
          id={selectId}
          className={cn(
            'w-full rounded-lg border bg-surface px-3.5 py-2.5 text-sm text-text-primary transition-colors',
            error
              ? 'border-danger focus:border-danger focus:ring-2 focus:ring-danger/20'
              : 'border-border focus:border-primary focus:ring-2 focus:ring-primary/20',
            'focus:outline-none',
            className,
          )}
          {...props}
        >
          {children}
        </select>
        {error && <p className="mt-1 text-sm text-danger">{error}</p>}
        {helpText && !error && (
          <p className="mt-1 text-sm text-text-muted">{helpText}</p>
        )}
      </div>
    )
  },
)
