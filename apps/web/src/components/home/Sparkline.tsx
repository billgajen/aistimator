/**
 * T-169: the small line under each of Home's "Last 30 days" figures, and the
 * mark that says which way the figure moved.
 *
 * The line covers 60 days in 5-day steps: the 30 days before in a quiet grey,
 * the last 30 days in juniper, ending in a dot. That is the same comparison
 * the words under the figure make ("up 2"), drawn. It starts at zero, so a
 * small change is not made to look large.
 *
 * It is a picture: a screen reader gets the numbers as a sentence instead
 * (system.md, ruling 10). Nothing moves.
 */

const W = 120
const H = 32
const PAD = 4

export function Sparkline({ points, summary }: { points: number[]; summary: string }) {
  if (points.length < 2) return null
  const max = Math.max(...points, 0)
  const x = (i: number) => PAD + (i * (W - 2 * PAD)) / (points.length - 1)
  // Zero sits on the baseline; with nothing to show the line lies flat on it
  const y = (v: number) => (max > 0 ? H - PAD - (v / max) * (H - 2 * PAD) : H - PAD)
  const at = (i: number) => `${x(i).toFixed(1)},${y(points[i]!).toFixed(1)}`
  const half = Math.floor(points.length / 2)
  const before = points.map((_, i) => i).filter((i) => i <= half).map(at).join(' ')
  const now = points.map((_, i) => i).filter((i) => i >= half).map(at).join(' ')
  const last = points.length - 1

  return (
    <div className="mt-3" data-testid="sparkline">
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="block" fill="none" aria-hidden="true" focusable="false">
        <polyline points={before} className="text-field" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" data-part="before" />
        <polyline points={now} className="text-primary" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" data-part="now" />
        <circle cx={x(last)} cy={y(points[last]!)} r={3} className="fill-primary stroke-white" strokeWidth={1.5} />
      </svg>
      <p className="sr-only" data-testid="sparkline-summary">
        {summary}
      </p>
    </div>
  )
}

/**
 * Up, down or the same, as a shape: a triangle pointing up or down, or a
 * short bar. The words beside it say the same thing, so it is hidden from a
 * screen reader, and it never relies on colour.
 */
export function TrendMark({ direction }: { direction: 'up' | 'down' | 'same' }) {
  return (
    <svg className="h-3 w-3 shrink-0" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true" data-testid="trend-mark" data-direction={direction}>
      {direction === 'up' && <path d="M6 2l5 8H1z" />}
      {direction === 'down' && <path d="M6 10L1 2h10z" />}
      {direction === 'same' && <rect x="1" y="5" width="10" height="2" rx="1" />}
    </svg>
  )
}
