import { PRODUCT_NAME } from '@qolumns/shared'
import { cn } from '@/lib/cn'

/**
 * The wordmark: the name as text, in the display font (the owner's choice,
 * T-165). One component, so the header, the footer, the sign-in pages and the
 * dashboard draw it the same way. Size and colour come from the caller.
 */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn('font-display font-extrabold tracking-tight text-text-primary', className)} data-testid="wordmark">
      {PRODUCT_NAME}
    </span>
  )
}
