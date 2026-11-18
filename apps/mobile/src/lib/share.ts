/**
 * Handing the customer their quote link (pure).
 *
 * The link opens the customer's quote page. A quote the business made on site
 * is hidden until it is approved, so the app approves first and shares after.
 */

import { parseReadingEvidence } from '@qolumns/shared'

/** The words that go with the link in the phone's share sheet (a text, WhatsApp, an email) */
export function shareMessage(businessName: string, viewUrl: string): string {
  const from = businessName.trim()
  return `${from ? `Your estimate from ${from}` : 'Your estimate'}: ${viewUrl}`
}

export interface ReadingWords {
  /** "Read from the panel label: 100 A" */
  line: string
  /** The words on the label, for the business to check against what it sees */
  labelText: string | null
}

/**
 * What stands under a confirmation question. A label reading is said in one
 * plain line; the words read off the label follow on their own, marked as the
 * label's text. Anything that is not a reading is shown as it is.
 */
export function evidenceWords(evidence: string | undefined): ReadingWords | null {
  if (!evidence) return null
  const reading = parseReadingEvidence(evidence)
  if (!reading) return { line: evidence, labelText: null }
  const photo = reading.photo ? `, photo ${reading.photo}` : ''
  return { line: `Read from ${reading.where}${photo}: ${reading.value}`, labelText: reading.words ?? null }
}
