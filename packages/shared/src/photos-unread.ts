/**
 * T-204 (item 29): a quote whose photos could not be read is never sent by
 * itself.
 *
 * The worker reads a customer's photos in up to four AI steps: the general
 * reading, the measurement, the label reading and the extras the photos show.
 * When one of them fails (an error, a timeout, an answer that cannot be used,
 * a photo that will not load) the pipeline carries on with what a failed step
 * already falls back to, as it always has. What changed: such a quote is held
 * for the business, hidden from the customer until approved, and says why.
 *
 * (A provider that is only BUSY is a different case, T-203: that run is not
 * saved at all, and the job is put back on the queue.)
 *
 * This file is the words and the stored shape, shared by the worker (which
 * writes `content_json.photosUnread`) and everything that shows it.
 */

/** The note on the quote, as the ticket words it */
export const PHOTOS_UNREAD_NOTE = 'Photos could not be read'

export type PhotoStep = 'photos' | 'measurement' | 'label' | 'extras'
export type PhotoFailure = 'error' | 'timeout' | 'bad_answer' | 'not_loaded' | 'no_model'

export interface PhotosUnread {
  /** Which reading failed, and how. Never the provider's words: an error message can repeat the request. */
  steps: Array<{ step: PhotoStep; why: PhotoFailure }>
  at: string
}

const STEP_WORDS: Record<PhotoStep, string> = {
  photos: 'the photos',
  measurement: 'the sizes in the photos',
  label: 'the label in the photos',
  extras: 'the extras the photos show',
}

const WHY_WORDS: Record<PhotoFailure, string> = {
  error: 'the reading failed',
  timeout: 'the reading took too long',
  bad_answer: 'the reading came back unusable',
  not_loaded: 'the photos could not be opened',
  no_model: 'the photo reader was not available',
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

/** The stored record on a quote's content, or null */
export function photosUnreadOf(content: unknown): PhotosUnread | null {
  const raw = isRecord(content) ? content.photosUnread : null
  if (!isRecord(raw) || !Array.isArray(raw.steps)) return null
  const steps = (raw.steps as unknown[]).filter((s): s is { step: PhotoStep; why: PhotoFailure } => isRecord(s) && typeof s.step === 'string' && s.step in STEP_WORDS && typeof s.why === 'string' && s.why in WHY_WORDS)
  return steps.length > 0 ? { steps, at: typeof raw.at === 'string' ? raw.at : '' } : null
}

/** What could not be read, in one plain sentence for the business */
export function photosUnreadSentence(unread: Pick<PhotosUnread, 'steps'>): string {
  const parts = [...new Set(unread.steps.map((s) => `${STEP_WORDS[s.step]} (${WHY_WORDS[s.why]})`))]
  const list = parts.length <= 1 ? parts.join('') : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
  return `Qolumns could not read ${list}, so this price was worked out without that. The customer has not been sent it. Check it against the photos, change it if you need to, then approve.`
}

/** Why the quote is held, as stored with the hold (`quality_gate_json.reason`) */
export function photosUnreadReason(unread: Pick<PhotosUnread, 'steps'>, also?: string | null): string {
  const base = `${PHOTOS_UNREAD_NOTE}. ${photosUnreadSentence(unread)}`
  return also ? `${base} Also: ${also}` : base
}
