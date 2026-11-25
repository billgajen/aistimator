/**
 * T-204: how long, and how often, a customer's page checks for an estimate
 * that is still being prepared.
 *
 * Until now the quote page checked every 4 seconds for about 10 minutes and
 * the request form every 3 seconds for 5. Since T-203 a request that met a
 * busy AI provider can be put back for up to 15 minutes (BUSY_MAX_MINUTES in
 * the worker's queue-consumer), so both pages gave up before a request that
 * was still going to be priced.
 *
 * Now both pages follow this one schedule: quickly for the first few minutes
 * (when nearly every estimate arrives), then less often, for 16 minutes in
 * all. What the customer reads does not change: the "taking longer than
 * usual" line after a minute (failed-request.ts), and the email, are as they
 * were.
 */
export const WAITING_POLL = {
  /** The gap between checks at first */
  quickEveryMs: 3_000,
  /** How long the quick checks last */
  quickForMs: 3 * 60_000,
  /** The gap between checks after that */
  slowEveryMs: 12_000,
  /** When the page stops checking: a minute more than the longest a put-back request can take */
  totalMs: 16 * 60_000,
} as const

/**
 * How long to wait before the next check, given how long the page has been
 * checking; null when it is time to stop.
 */
export function nextWaitingPollMs(elapsedMs: number): number | null {
  const elapsed = Math.max(0, elapsedMs)
  if (elapsed >= WAITING_POLL.totalMs) return null
  const gap = elapsed < WAITING_POLL.quickForMs ? WAITING_POLL.quickEveryMs : WAITING_POLL.slowEveryMs
  // never past the end: the last check lands on the 16th minute, not after it
  return Math.min(gap, WAITING_POLL.totalMs - elapsed)
}

/** How many checks the whole schedule makes (for the tests, and for anyone sizing the load) */
export function waitingPollCount(): number {
  let elapsed = 0
  let count = 0
  for (;;) {
    const gap = nextWaitingPollMs(elapsed)
    if (gap === null) return count
    elapsed += gap
    count += 1
  }
}

export interface WaitingPollClock {
  now: () => number
  setTimeout: (run: () => void, ms: number) => unknown
  clearTimeout: (timer: unknown) => void
}

// The shared package is compiled with no browser or Node types, so the timers are read off the
// global object by name (every place this runs has them: a browser, Node, the worker).
const timers = globalThis as unknown as { setTimeout: (run: () => void, ms: number) => unknown; clearTimeout: (timer: unknown) => void }
const realClock: WaitingPollClock = {
  now: () => Date.now(),
  setTimeout: (run, ms) => timers.setTimeout(run, ms),
  clearTimeout: (timer) => timers.clearTimeout(timer),
}

/**
 * Run `check` on the schedule until it answers "done" (true), the schedule
 * ends (`onGiveUp`), or the returned function is called (the page went away).
 * One check at a time: the next is timed from when the last one finished, so
 * a slow answer never stacks checks up. A check that throws is one missed
 * check, not the end.
 */
export function startWaitingPoll(
  check: () => Promise<boolean | void> | boolean | void,
  onGiveUp: () => void,
  clock: WaitingPollClock = realClock
): () => void {
  const startedAt = clock.now()
  let stopped = false
  let timer: unknown

  const schedule = () => {
    if (stopped) return
    const gap = nextWaitingPollMs(clock.now() - startedAt)
    if (gap === null) {
      stopped = true
      onGiveUp()
      return
    }
    timer = clock.setTimeout(async () => {
      if (stopped) return
      let done = false
      try {
        done = (await check()) === true
      } catch {
        // best-effort: the next check tries again
      }
      if (done) {
        stopped = true
        return
      }
      schedule()
    }, gap)
  }
  schedule()

  return () => {
    stopped = true
    if (timer !== undefined) clock.clearTimeout(timer)
  }
}
