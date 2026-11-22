/**
 * T-199: the small tag beside a feature the free start lends ("Pro"), so a
 * business knows what it would keep on that plan. The same outlined pill as
 * "Coming soon": words in a shape, never colour alone, and never yellow.
 * The name comes from the plan definitions (`freeStartTag`), never typed.
 */
export function PlanTag({ name, className = '' }: { name: string | null | undefined; className?: string }) {
  if (!name) return null
  return (
    <span
      className={`inline-block whitespace-nowrap rounded-full border border-field bg-white px-2 py-0.5 align-middle font-body text-xs font-semibold tracking-normal text-text-secondary ${className}`}
      data-testid="plan-tag"
    >
      <span className="sr-only">Part of </span>
      {name}
    </span>
  )
}
