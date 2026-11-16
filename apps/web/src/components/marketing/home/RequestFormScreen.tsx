import { brandStyleVars } from '@/lib/color'

/**
 * T-165: the request form as a customer meets it on a business's quote page
 * (the widget's first question step), at true size and in the business's
 * colour. A still screen: it takes data, has no state and sends nothing.
 * `answerClassName`, `photoClassName` and `buttonClassName` let the home
 * page's demo bring the answer and the photo in and press the button.
 *
 * T-170: `page` draws it as the business's hosted quote page fills a phone:
 * no card around it, and the logo on its own line above the name, so the
 * name has the screen's whole width and stays on one line.
 */
export function RequestFormScreen({
  businessName,
  logoUrl,
  primaryColor,
  serviceName,
  question,
  answer,
  photo,
  buttonLabel = 'Get my estimate',
  answerClassName = '',
  photoClassName = '',
  buttonClassName = '',
  answerStyle,
  photoStyle,
  buttonStyle,
  page = false,
  className = '',
}: {
  businessName: string
  logoUrl?: string | null
  primaryColor: string
  serviceName: string
  question: string
  answer: string
  /** T-167: with no `src` the photo is named, not pictured (we draw no look-alike of a real label) */
  photo?: { src?: string; alt?: string; label: string } | null
  buttonLabel?: string
  answerClassName?: string
  photoClassName?: string
  buttonClassName?: string
  answerStyle?: React.CSSProperties
  photoStyle?: React.CSSProperties
  buttonStyle?: React.CSSProperties
  /** T-170: as the hosted quote page on a phone (no card; the logo above the name) */
  page?: boolean
  className?: string
}) {
  const logo = logoUrl ? (
    // eslint-disable-next-line @next/next/no-img-element -- a small SVG shipped in public/
    <img src={logoUrl} alt="" width={120} height={32} className="h-8 w-auto shrink-0" />
  ) : null
  return (
    <div
      className={`${page ? 'flex-1 bg-white px-4 pb-5 pt-4' : 'rounded-3xl border border-border bg-white p-6 shadow-warm-lg'} text-left ${className}`}
      style={brandStyleVars(primaryColor)}
      data-testid="request-form-screen"
    >
      {page ? (
        <div>
          {logo}
          <p className="mt-3 text-xs font-semibold uppercase tracking-[0.16em] text-tertiary">Instant estimate</p>
          <p className="whitespace-nowrap font-display text-xl font-bold leading-tight text-text-primary" data-testid="phone-business-name">{businessName}</p>
        </div>
      ) : (
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-tertiary">Instant estimate</p>
            <p className="font-display text-xl font-bold leading-tight text-text-primary">{businessName}</p>
          </div>
          {logo}
        </div>
      )}

      <p className="mt-5 text-sm font-medium text-text-secondary">{serviceName}</p>
      <p className="mt-3 text-sm font-semibold text-text-primary">{question}</p>
      <div className="mt-2 flex min-h-[48px] items-center rounded-xl border border-field bg-background px-4 text-[15px] text-text-primary">
        <span className={answerClassName} style={answerStyle} data-testid="demo-answer">{answer}</span>
      </div>

      {photo ? (
        <>
          <p className="mt-4 text-sm font-semibold text-text-primary">{photo.label}</p>
          <div className="mt-2 flex min-h-[88px] items-center gap-3 rounded-xl border border-dashed border-field bg-background p-2">
            <span className={`flex items-center gap-3 ${photoClassName}`} style={photoStyle} data-testid="demo-photo">
              {photo.src ? (
                // eslint-disable-next-line @next/next/no-img-element -- a small file shipped in public/
                <img src={photo.src} alt={photo.alt ?? ''} width={96} height={72} className="h-[72px] w-24 rounded-lg border border-border object-cover" />
              ) : null}
              <span className={`text-sm text-text-secondary ${photo.src ? '' : 'px-2'}`}>
                <span className="figure">1</span> photo added
              </span>
            </span>
          </div>
        </>
      ) : null}

      <div className={`mt-5 rounded-xl bg-primary py-3.5 text-center text-[15px] font-semibold text-on-primary ${buttonClassName}`} style={buttonStyle}>
        {buttonLabel}
      </div>
    </div>
  )
}
