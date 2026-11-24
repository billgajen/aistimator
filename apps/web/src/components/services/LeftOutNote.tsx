import { LEFT_OUT_ADVICE, hasLeftOut, leftOutLines, type LeftOut } from '@/lib/pricing-left-out'

/**
 * T-201: what "Describe your pricing" could not keep in one service (ten
 * price lines, ten questions), named, shown in the review before anything is
 * applied. Renders nothing when everything fitted.
 */
export function LeftOutNote({ leftOut }: { leftOut: LeftOut | null | undefined }) {
  if (!hasLeftOut(leftOut)) return null
  return (
    <div className="rounded-lg border border-danger-line bg-danger-light p-4" role="alert" data-testid="compile-left-out">
      <h4 className="mb-2 text-sm font-bold text-danger">Not everything fitted in one service</h4>
      <ul className="space-y-2 text-sm text-danger">
        {leftOutLines(leftOut).map((part) => (
          <li key={part.title}>
            <span className="font-semibold">{part.title}</span>
            {part.names.length > 0 && <span>: {part.names.join(', ')}</span>}
          </li>
        ))}
      </ul>
      <p className="mt-2 text-sm text-danger">{LEFT_OUT_ADVICE}</p>
    </div>
  )
}
