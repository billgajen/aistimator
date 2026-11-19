/**
 * What is happening to a job between "Price this job" and its price (T-184).
 * Pure.
 *
 * Every stage here is something the app knows for certain: how many photos
 * have reached the server, whether the job has been sent, and the two states
 * the server reports while it works (queued, then generating). The steps
 * inside the pricing itself (reading the photos, measuring, wording) are not
 * reported by the server today, so they are not pretended here.
 */
import { isQuoteProcessing } from '@qolumns/shared'

export type StageState = 'done' | 'now' | 'next' | 'stuck'

export interface Stage {
  key: 'photos' | 'sent' | 'pricing' | 'ready'
  label: string
  /** A second line: "2 of 3 uploaded" */
  note: string | null
  state: StageState
}

export interface StageInput {
  /** Photos the quote carries, and how many have reached the server */
  photosTotal: number
  photosDone: number
  /** The job has reached the server (a quote exists) */
  sent: boolean
  /** The quote's status once it exists */
  status?: string | null
  /** The phone is waiting for a signal */
  waitingForSignal?: boolean
}

export const STAGE_COPY = {
  photos: (total: number) => (total === 1 ? 'Photo uploaded' : 'Photos uploaded'),
  noPhotos: 'No photos to upload',
  sent: 'Job sent',
  pricing: 'Working out the price',
  ready: 'Price ready',
  waiting: 'Waiting for a signal. It carries on by itself.',
  queued: 'In the queue',
  uploaded: (done: number, total: number) => `${done} of ${total} uploaded`,
} as const

export function pricingStages(input: StageInput): Stage[] {
  const total = Math.max(0, input.photosTotal)
  const done = Math.min(total, Math.max(0, input.photosDone))
  const photosDone = input.sent || done >= total
  const working = input.sent && isQuoteProcessing(input.status ?? 'queued')
  const ready = input.sent && !working
  const stuck = input.waitingForSignal === true

  const stateOf = (isDone: boolean, isNow: boolean): StageState => (isDone ? 'done' : isNow ? (stuck ? 'stuck' : 'now') : 'next')
  return [
    {
      key: 'photos',
      label: total === 0 ? STAGE_COPY.noPhotos : STAGE_COPY.photos(total),
      note: total > 0 && !photosDone ? STAGE_COPY.uploaded(done, total) : null,
      state: stateOf(photosDone, true),
    },
    { key: 'sent', label: STAGE_COPY.sent, note: !input.sent && photosDone && stuck ? STAGE_COPY.waiting : null, state: stateOf(input.sent, photosDone) },
    {
      key: 'pricing',
      label: STAGE_COPY.pricing,
      note: working && input.status === 'queued' ? STAGE_COPY.queued : null,
      state: stateOf(ready, input.sent),
    },
    { key: 'ready', label: STAGE_COPY.ready, note: null, state: ready ? 'done' : 'next' },
  ]
}
