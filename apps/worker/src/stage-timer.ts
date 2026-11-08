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
}

export class StageTimer {
  private readonly startedAt = Date.now()
  private readonly stages: Record<string, number> = {}
  private passes: number[] = []
  queueWaitMs?: number
  repriceOnly?: boolean

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
    }
  }
}
