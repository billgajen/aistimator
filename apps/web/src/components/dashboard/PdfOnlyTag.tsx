/**
 * T-201: the small tag beside a Quote Template tick box that changes the PDF
 * of a quote and nothing else. The customer's estimate page always shows the
 * price lines, the assumptions and the exclusions a quote has; these three
 * boxes only decide what is printed on the PDF. Until T-201 nothing said so.
 * The same outlined pill as "Coming soon" and the plan tag: words in a shape,
 * never colour alone.
 */
export const PDF_ONLY_TAG = 'PDF only'

/** One line for the top of the section, in both places the boxes are shown */
export const PDF_ONLY_LINE = 'The three tick boxes change the PDF only. Your customer’s estimate page always shows the price lines, assumptions and exclusions.'

export function PdfOnlyTag({ className = '' }: { className?: string }) {
  return (
    <span
      className={`ml-2 inline-block whitespace-nowrap rounded-full border border-field bg-white px-2 py-0.5 align-middle font-body text-xs font-semibold tracking-normal text-text-secondary ${className}`}
      data-testid="pdf-only-tag"
    >
      {PDF_ONLY_TAG}
    </span>
  )
}
