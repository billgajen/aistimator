/**
 * T-201: the business's "Default Terms & Conditions" (Settings → Business,
 * `tenants.default_terms_text`), as the customer reads them: on the estimate
 * page and on the PDF, below the price. Until T-201 the text was saved and
 * printed nowhere.
 *
 * Pure. The business's own words, never changed: only the space around them
 * is trimmed, and text that is empty or only spaces is no terms at all (the
 * page and the PDF then print no heading either).
 *
 * The text is read when the page or the PDF is made. It is not copied onto
 * each quote: a business that changes its terms changes them on every
 * estimate page from then on, and a PDF already made keeps the terms it was
 * made with.
 */

/** The heading above the terms, on the page and on the PDF */
export const TERMS_HEADING = 'Terms and conditions'

/** The most that is printed: a page of text, so a pasted contract cannot bury the price */
export const TERMS_MAX_CHARS = 6000

/** The terms to print, or null when the business has none */
export function customerTerms(stored: unknown): string | null {
  if (typeof stored !== 'string') return null
  const text = stored.replace(/\r\n?/g, '\n').trim()
  if (!text) return null
  return text.length > TERMS_MAX_CHARS ? `${text.slice(0, TERMS_MAX_CHARS).trimEnd()}…` : text
}

/** The terms as paragraphs (a blank line starts a new one), each as its lines: for the PDF, which has no CSS for line breaks to rely on */
export function termsParagraphs(terms: string): string[][] {
  return terms
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.split('\n').map((line) => line.trim()).filter(Boolean))
    .filter((lines) => lines.length > 0)
}
