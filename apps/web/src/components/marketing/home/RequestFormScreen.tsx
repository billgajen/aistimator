import { brandStyleVars } from '@/lib/color'

/**
 * T-165: the request form as a customer meets it on a business's quote page
 * (the widget's first question step), at true size and in the business's
 * colour. A still screen: it takes data, has no state and sends nothing.
 * `answerClassName`, `photoClassName` and `buttonClassName` let the home
 * page's demo bring the answer and the photo in and press the button.
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
  className = '',
}: {
  businessName: string
  logoUrl?: string | null
  primaryColor: string
  serviceName: string
  question: string
  answer: string
  photo?: { src: string; alt: string; label: string } | null
  buttonLabel?: string
  answerClassName?: string
  photoClassName?: string
  buttonClassName?: string
  answerStyle?: React.CSSProperties
  photoStyle?: React.CSSProperties
  buttonStyle?: React.CSSProperties
  className?: string
}) {
  return (
    <div className={`rounded-3xl border border-border bg-white p-6 text-left shadow-warm-lg ${className}`} style={brandStyleVars(primaryColor)} data-testid="request-form-screen">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-tertiary">Instant estimate</p>
          <p className="font-display text-xl font-bold leading-tight text-text-primary">{businessName}</p>
        </div>
        {logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- a small SVG shipped in public/
          <img src={logoUrl} alt="" className="h-8 w-auto shrink-0" />
        ) : null}
      </div>

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
              {/* eslint-disable-next-line @next/next/no-img-element -- a small file shipped in public/ */}
              <img src={photo.src} alt={photo.alt} width={96} height={72} className="h-[72px] w-24 rounded-lg border border-border object-cover" />
              <span className="text-sm text-text-secondary">
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
