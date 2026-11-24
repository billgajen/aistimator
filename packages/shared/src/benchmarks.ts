/**
 * Cross-tenant rate benchmarks (T-115) — pure math, no IO.
 *
 * Privacy model: only aggregates (percentiles + tenant counts) are ever
 * produced; a benchmark requires rates from at least MIN_BENCHMARK_TENANTS
 * distinct OTHER tenants (k-anonymity) so no individual business's pricing
 * is inferable. Informational only — never feeds pricing (AD-001).
 */

export interface BenchmarkRateInput {
  tenantId: string
  serviceName: string
  unitLabel: string
  /** Per-unit rate in the tenant's currency */
  rate: number
}

export interface MyServiceInput {
  serviceId: string
  serviceName: string
  steps: Array<{ unitLabel: string; rate: number }>
}

export interface ServiceBenchmark {
  serviceId: string
  serviceName: string
  /** Normalized unit, e.g. 'sqm', 'room' */
  unit: string
  yourRate: number
  p25: number
  median: number
  p75: number
  /** Distinct other tenants contributing */
  sampleTenants: number
}

/** Minimum distinct OTHER tenants before a benchmark is shown (k-anonymity) */
export const MIN_BENCHMARK_TENANTS = 3

/**
 * T-201: the switch in Settings → Business ("Market benchmarks"), and the line
 * Analytics shows about it. `tenants.benchmarks_opt_in` holds it: on for a new
 * business; off means none of its rates are in anyone's benchmark and (the
 * T-115 rule) it sees none.
 */
export const BENCHMARK_SHARING_COPY = {
  title: 'Market benchmarks',
  label: 'Share my rates, without my name, in market benchmarks',
  /** The one sentence on what is shared */
  whatIsShared:
    'When this is on, the rates of your services (per room, per hour and so on) are added, without your name, to the typical range that similar businesses see on Analytics, and you see theirs.',
  savedOn: 'Saved. Your rates are shared without your name.',
  savedOff: 'Saved. Your rates are no longer shared, and Analytics shows you no benchmarks.',
  failed: 'Could not save. Please try again.',
  /** On Analytics, under the benchmarks: where the switch is */
  onLine: 'Your rates are shared without your name.',
  offLine: 'You can stop sharing at any time in Settings.',
  settingsLink: 'Change this in Settings',
} as const

const STOPWORDS = new Set([
  'the', 'and', 'of', 'for', 'a', 'an', 'to', 'in', 'on', 'with',
  'service', 'services', 'standard', 'full', 'basic', 'general',
])

/** Normalize unit labels so 'sq m', 'sqm', 'square metre' compare equal */
export function normalizeUnitLabel(label: string): string {
  const cleaned = label.toLowerCase().replace(/[^a-z0-9]/g, '')
  const aliases: Record<string, string> = {
    sqm: 'sqm',
    sqmetre: 'sqm',
    sqmeter: 'sqm',
    squaremetre: 'sqm',
    squaremeter: 'sqm',
    m2: 'sqm',
    sqft: 'sqft',
    squarefoot: 'sqft',
    squarefeet: 'sqft',
    ft2: 'sqft',
    hr: 'hour',
    hour: 'hour',
    hours: 'hour',
    room: 'room',
    rooms: 'room',
    wall: 'wall',
    walls: 'wall',
    linearft: 'linearft',
    linearfoot: 'linearft',
    linearm: 'linearm',
    linearmetre: 'linearm',
  }
  return aliases[cleaned] ?? cleaned
}

/** Significant lowercase tokens of a service name */
export function serviceTokens(name: string): Set<string> {
  return new Set(
    name
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 2 && !STOPWORDS.has(t))
  )
}

function tokensOverlap(a: Set<string>, b: Set<string>): boolean {
  for (const token of a) {
    if (b.has(token)) return true
  }
  return false
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  const index = (sorted.length - 1) * p
  const lower = Math.floor(index)
  const upper = Math.ceil(index)
  const weight = index - lower
  return sorted[lower]! * (1 - weight) + sorted[upper]! * weight
}

/**
 * Compute benchmarks for each of my per-unit rates against other tenants'
 * rates for comparable services (same normalized unit + overlapping service
 * name tokens). One rate per other tenant per group — a tenant with many
 * similar steps can't skew the distribution.
 */
export function computeBenchmarks(
  myServices: MyServiceInput[],
  others: BenchmarkRateInput[]
): ServiceBenchmark[] {
  const results: ServiceBenchmark[] = []

  for (const service of myServices) {
    const myTokens = serviceTokens(service.serviceName)

    for (const step of service.steps) {
      if (step.rate <= 0) continue
      const unit = normalizeUnitLabel(step.unitLabel)
      if (!unit) continue

      // One representative rate (median of their matching steps) per other tenant
      const perTenant = new Map<string, number[]>()
      for (const other of others) {
        if (other.rate <= 0) continue
        if (normalizeUnitLabel(other.unitLabel) !== unit) continue
        if (!tokensOverlap(myTokens, serviceTokens(other.serviceName))) continue
        const list = perTenant.get(other.tenantId) ?? []
        list.push(other.rate)
        perTenant.set(other.tenantId, list)
      }

      if (perTenant.size < MIN_BENCHMARK_TENANTS) continue

      const tenantRates = [...perTenant.values()]
        .map((rates) => {
          const sorted = [...rates].sort((a, b) => a - b)
          return percentile(sorted, 0.5)
        })
        .sort((a, b) => a - b)

      const round = (n: number) => Math.round(n * 100) / 100
      results.push({
        serviceId: service.serviceId,
        serviceName: service.serviceName,
        unit,
        yourRate: step.rate,
        p25: round(percentile(tenantRates, 0.25)),
        median: round(percentile(tenantRates, 0.5)),
        p75: round(percentile(tenantRates, 0.75)),
        sampleTenants: perTenant.size,
      })
    }
  }

  return results
}
