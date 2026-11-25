/**
 * T-204 (item 29): what one run of one quote could not read from the
 * customer's photos. One log is shared by the photo steps of the run; the
 * processor holds the quote for the business when it is not empty (see
 * packages/shared/src/photos-unread.ts).
 */
import type { PhotoFailure, PhotoStep, PhotosUnread } from '@qolumns/shared'

export class PhotoReadLog {
  private readonly failures: Array<{ step: PhotoStep; why: PhotoFailure }> = []

  missed(step: PhotoStep, why: PhotoFailure): void {
    if (!this.failures.some((f) => f.step === step && f.why === why)) this.failures.push({ step, why })
    // the step and the kind of failure: nothing of the request
    console.warn(`[Photos] ${step} could not be read (${why}); the quote will be held for the business`)
  }

  get failed(): boolean {
    return this.failures.length > 0
  }

  record(now: Date = new Date()): PhotosUnread {
    return { steps: this.failures.map((f) => ({ ...f })), at: now.toISOString() }
  }
}

/** A timeout, an answer that could not be used, or any other error: from the error's own name and kind, never its message's content */
export function failureKind(error: unknown): PhotoFailure {
  const name = error instanceof Error ? error.name : ''
  const message = error instanceof Error ? error.message : ''
  if (name === 'AiCallTimeoutError' || name === 'AbortError' || name === 'TimeoutError' || /timed out|timeout/i.test(message)) return 'timeout'
  if (name === 'SyntaxError' || /\bJSON\b|parse/i.test(message)) return 'bad_answer'
  return 'error'
}
