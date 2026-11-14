import { PRODUCT_NAME } from '@qolumns/shared'
import { cn } from '@/lib/cn'

/**
 * T-164: the name drawn in the display font, two ways, for the owner to
 * choose on /design: as written ("Qolumns") or all lower case. Real pages
 * keep their current text logo until the choice is made.
 */
export function Wordmark({ form, className }: { form: 'capital' | 'lower'; className?: string }) {
  return (
    <span className={cn('font-display font-extrabold tracking-tight text-text-primary', className)} data-testid={`wordmark-${form}`}>
      {form === 'lower' ? PRODUCT_NAME.toLowerCase() : PRODUCT_NAME}
    </span>
  )
}
