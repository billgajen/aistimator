import { qrMatrix } from '@/lib/qr'

/**
 * T-165: a QR code as an SVG, from the same encoder as the Quote link page
 * (lib/qr). It is a real code: point a phone at it and it opens `value`.
 */
export function QrSvg({ value, label, className = '' }: { value: string; /** what the code opens, for a screen reader; leave it out where the code sits inside a larger described picture */ label?: string; className?: string }) {
  const matrix = qrMatrix(value)
  const n = matrix.length
  const quiet = 2
  const path = matrix.flatMap((row, y) => row.map((dark, x) => (dark ? `M${x + quiet} ${y + quiet}h1v1h-1z` : ''))).join('')
  return (
    <svg viewBox={`0 0 ${n + quiet * 2} ${n + quiet * 2}`} {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })} className={className} shapeRendering="crispEdges" data-testid="qr-svg">
      <rect width="100%" height="100%" fill="#ffffff" />
      <path d={path} fill="currentColor" />
    </svg>
  )
}
