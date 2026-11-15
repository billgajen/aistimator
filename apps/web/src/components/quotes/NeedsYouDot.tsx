/**
 * T-165: the small dark marker that goes with the strong yellow wherever
 * something needs the owner (system.md, Status colours). Yellow alone could
 * be taken for a measurement note; yellow with this dot is "needs you".
 */
export function NeedsYouDot({ className = '' }: { className?: string }) {
  return <span className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-on-accent ${className}`} aria-hidden="true" data-testid="needs-you-dot" />
}
