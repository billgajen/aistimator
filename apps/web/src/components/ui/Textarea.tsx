import { cn } from '@/lib/cn'
import { forwardRef } from 'react'

interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string
  error?: string
  helpText?: string
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  function Textarea({ label, error, helpText, className, id, ...props }, ref) {
    const textareaId = id || (label ? label.toLowerCase().replace(/\s+/g, '-') : undefined)

    return (
      <div>
        {label && (
          <label
            htmlFor={textareaId}
            className="mb-1.5 block text-sm font-medium text-text-primary"
          >
            {label}
          </label>
        )}
        <textarea
          ref={ref}
          id={textareaId}
          className={cn(
            'w-full rounded-lg border bg-surface px-3.5 py-2.5 text-sm text-text-primary placeholder:text-text-muted transition-colors',
            error
              ? 'border-danger focus:border-danger focus:ring-2 focus:ring-danger/20'
              : 'border-border focus:border-primary focus:ring-2 focus:ring-primary/20',
            'focus:outline-none',
            className,
          )}
          {...props}
        />
        {error && <p className="mt-1 text-sm text-danger">{error}</p>}
        {helpText && !error && (
          <p className="mt-1 text-sm text-text-muted">{helpText}</p>
        )}
      </div>
    )
  },
)
