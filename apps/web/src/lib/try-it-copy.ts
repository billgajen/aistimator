/**
 * T-202: the words and the numbers of "Try it yourself" (the test estimate a
 * business makes from inside its dashboard). Pure and safe for a page to read;
 * lib/test-estimates.ts does the deciding on the server.
 */

/** Test estimates one business can make in 24 hours */
export const TEST_ESTIMATES_PER_DAY = 5

/** The page inside the dashboard that shows the business its own request form in test mode */
export const TRY_IT_PATH = '/app/try-it'

export const TRY_IT_COPY = {
  title: 'Try it yourself',
  line: 'See what your customers see',
  button: 'Try it yourself',
  again: 'Try it again',
  opening: 'Opening…',
  about: 'Ask for a job as if you were a customer. A test estimate does not count toward your plan, and you can delete it afterwards.',
  banner: 'Test mode: this is what your customers see. This request does not count toward your plan.',
  back: 'Back to your dashboard',
  noService: 'Switch on a service first: a customer needs one to ask about.',
  noServiceLink: 'Go to Services',
  notStarted: 'Could not start the test. Try again.',
  /** `when` is the time in the reader's own time zone, written by the page */
  limit: (when: string) => `You have made ${TEST_ESTIMATES_PER_DAY} test estimates in the last 24 hours. You can make another after ${when}.`,
  /** Said by the server, which does not know the reader's time zone: the page adds the time */
  limitPlain: `You have made ${TEST_ESTIMATES_PER_DAY} test estimates in the last 24 hours.`,
  notSignedIn: 'A test request can only be sent from your own dashboard. Sign in, then start it again from Home.',
  oldLink: 'This test link no longer works. Start a new test from your dashboard.',
  delete: {
    button: 'Delete this test',
    title: 'Delete this test estimate?',
    body: 'This removes the test request, its estimate, its photos and its page for good. The link you were given stops working. It cannot be undone.',
    counted: `It still counts as one of your ${TEST_ESTIMATES_PER_DAY} test estimates for the day.`,
    confirm: 'Delete the test',
    cancel: 'Cancel',
    deleting: 'Deleting…',
    failed: 'Could not delete the test. Try again.',
    notATest: 'Only a test estimate can be deleted.',
  },
} as const

/**
 * "3:40 pm today" / "9:05 am tomorrow" / "Thu 9:05 am", in the reader's own
 * time zone (or the one given). Pure when `timeZone` and `locale` are given.
 */
export function whenAvailable(availableAtIso: string, now: Date = new Date(), options: { locale?: string; timeZone?: string } = {}): string {
  const at = new Date(availableAtIso)
  if (Number.isNaN(at.getTime())) return 'tomorrow'
  const day = (date: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: options.timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date)
  const time = new Intl.DateTimeFormat(options.locale, { timeZone: options.timeZone, hour: 'numeric', minute: '2-digit' }).format(at)
  if (day(at) === day(now)) return `${time} today`
  if (day(at) === day(new Date(now.getTime() + 24 * 60 * 60 * 1000))) return `${time} tomorrow`
  return `${new Intl.DateTimeFormat(options.locale, { timeZone: options.timeZone, weekday: 'short' }).format(at)} ${time}`
}

/** The line a page shows when the day's tests are used up; without a time it says so plainly */
export function limitLine(availableAtIso: string | null | undefined, now: Date = new Date(), options: { locale?: string; timeZone?: string } = {}): string {
  return availableAtIso ? TRY_IT_COPY.limit(whenAvailable(availableAtIso, now, options)) : `${TRY_IT_COPY.limitPlain} Try again tomorrow.`
}
