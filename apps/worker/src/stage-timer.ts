/**
 * Wall-clock time per processing stage, stored in the pricing trace
 * (`pricing_trace_json.timings`) so slow quotes can be diagnosed from the
 * database: production log tails don't carry per-line timestamps.
 */

export interface StageTimings {
  totalMs: number
  /** Enqueue → consumer start (queue path only) */
  queueWaitMs?: number
  /** Stage name → ms. Stages run in order unless named `…_parallel`. */
  stages: Record<string, number>
  /** Individual measurement pass durations, ms */
  measurementPassesMs?: number[]
  /** True when the clarification reprice ran with no AI calls */
  repriceOnly?: boolean
  /**
   * T-203: how often a model was busy while this quote was priced, over every
   * run of its job. `busyRetries` = waits made for a busy provider;
   * `overflowCalls` = calls sent to an overflow model. Always present (0 when
   * there were none), so a run can be read without guessing.
   */
  busyRetries: number
  overflowCalls: number
  /** Times the job was put back because a model was busy on every provider (only when > 0) */
  busyRequeues?: number
  /** What the last run alone used, when earlier runs were put back (the queue check counts by window) */
  lastRun?: { busyRetries: number; overflowCalls: number }
  /** When these timings were written */
  finishedAt: string
}

/** T-203: where the busy counts come from (the run's log, and what earlier runs of the job met) */
export interface BusySource {
  log: { busyRetries: number; overflowCalls: number }
  before?: { requeues: number; busyRetries: number; overflowCalls: number }
}

export class StageTimer {
  private readonly startedAt = Date.now()
  private readonly stages: Record<string, number> = {}
  private passes: number[] = []
  queueWaitMs?: number
  repriceOnly?: boolean
  /** T-203: set by the processor */
  busy?: BusySource

  /** Time an async stage. Repeated names accumulate. */
  async time<T>(stage: string, fn: () => Promise<T>): Promise<T> {
    const t0 = Date.now()
    try {
      return await fn()
    } finally {
      this.add(stage, Date.now() - t0)
    }
  }

  add(stage: string, ms: number): void {
    this.stages[stage] = (this.stages[stage] ?? 0) + Math.round(ms)
  }

  setMeasurementPasses(ms: number[]): void {
    this.passes = ms.map((m) => Math.round(m))
  }

  summary(): StageTimings {
    return {
      totalMs: Date.now() - this.startedAt,
      ...(this.queueWaitMs !== undefined && { queueWaitMs: Math.round(this.queueWaitMs) }),
      stages: { ...this.stages },
      ...(this.passes.length > 0 && { measurementPassesMs: this.passes }),
      ...(this.repriceOnly && { repriceOnly: true }),
      busyRetries: (this.busy?.before?.busyRetries ?? 0) + (this.busy?.log.busyRetries ?? 0),
      overflowCalls: (this.busy?.before?.overflowCalls ?? 0) + (this.busy?.log.overflowCalls ?? 0),
      ...(this.busy?.before && this.busy.before.requeues > 0 && {
        busyRequeues: this.busy.before.requeues,
        lastRun: { busyRetries: this.busy.log.busyRetries, overflowCalls: this.busy.log.overflowCalls },
      }),
      finishedAt: new Date().toISOString(),
    }
  }
}
