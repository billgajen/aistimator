/**
 * T-204: the customer's "Download PDF": where it is asked for, and the one
 * line a customer reads when the document could not be made. Plain values, so
 * the page's button, the public route and the checks all read the same ones.
 */

/** Where the customer's PDF is asked for: the same address the page itself is on (a business's own address included) */
export function customerPdfPath(quoteId: string, token: string): string {
  return `/api/public/quotes/${encodeURIComponent(quoteId)}/pdf?token=${encodeURIComponent(token)}`
}

/** What the customer reads when the document could not be made. Never the PDF service's own words. */
export const PDF_FAILED_LINE = 'The PDF could not be made just now. Please try again in a minute.'
