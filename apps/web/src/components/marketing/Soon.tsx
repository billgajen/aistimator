import { lineMark, soonMark, type NotLiveYet, type PlanLine } from '@/lib/marketing/plan-claims'

/**
 * T-187: the "Coming soon" mark. It is never typed on a page: it is drawn
 * from the one live flag of the thing it marks (lib/marketing/plan-claims.ts),
 * and draws nothing once that flag is set. So the day the on-site app is
 * live, one edit removes the mark from Home, Pricing and Features together.
 *
 *   <Soon of="app" />        one of the three things shown before they are live
 *   <Soon line={planLine} /> any plan line
 *
 * A mark that is words in a shape, never colour alone. `onDark` is for a
 * juniper ground.
 */
export function Soon({ of, line, onDark = false, className = '' }: { of?: NotLiveYet; line?: PlanLine; onDark?: boolean; className?: string }) {
  const mark = of ? soonMark(of) : line ? lineMark(line) : null
  if (!mark) return null
  return (
    <span
      className={`inline-block whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-semibold ${onDark ? 'border-on-primary text-on-primary' : 'border-field bg-white text-text-secondary'} ${className}`}
      data-testid="coming-soon"
    >
      {mark}
    </span>
  )
}
