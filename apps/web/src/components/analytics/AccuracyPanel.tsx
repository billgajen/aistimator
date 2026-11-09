'use client'

/**
 * Estimate accuracy against final invoices (T-143): per service and per
 * grade, against the Docs/09 beta targets (median error < 10%, ≥ 80% of
 * quotes within ±10%).
 */
import { useEffect, useState } from 'react'
import type { AccuracyGroup, AccuracyReport } from '@estimator/shared'

const pct = (n: number) => `${(n * 100).toFixed(1)}%`

function Row({ g, targets }: { g: AccuracyGroup; targets: AccuracyReport['targets'] }) {
  const errOk = g.medianAbsError < targets.medianAbsError
  const withinOk = g.withinTenPct >= targets.withinTenPct
  return (
    <tr className="border-t border-border">
      <td className="py-2 pr-4 text-text-primary">{g.key}</td>
      <td className="figure py-2 pr-4 text-right">{g.count}</td>
      <td className={`figure py-2 pr-4 text-right ${errOk ? 'text-primary' : 'text-tertiary'}`}>{pct(g.medianAbsError)}</td>
      <td className={`figure py-2 pr-4 text-right ${withinOk ? 'text-primary' : 'text-tertiary'}`}>{pct(g.withinTenPct)}</td>
      <td className="figure py-2 text-right text-text-secondary">
        {g.medianBias > 0 ? '+' : ''}
        {pct(g.medianBias)}
      </td>
    </tr>
  )
}

function Table({ title, groups, targets }: { title: string; groups: AccuracyGroup[]; targets: AccuracyReport['targets'] }) {
  if (groups.length === 0) return null
  return (
    <div className="mt-4 overflow-x-auto">
      <p className="text-sm font-medium text-text-primary mb-1">{title}</p>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-text-muted">
            <th className="py-1 pr-4 font-medium" />
            <th className="py-1 pr-4 text-right font-medium">Invoiced</th>
            <th className="py-1 pr-4 text-right font-medium">Median error</th>
            <th className="py-1 pr-4 text-right font-medium">Within ±10%</th>
            <th className="py-1 text-right font-medium">Bias</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => (
            <Row key={g.key} g={g} targets={targets} />
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function AccuracyPanel() {
  const [report, setReport] = useState<AccuracyReport | null>(null)

  useEffect(() => {
    fetch('/api/analytics/accuracy')
      .then((r) => (r.ok ? r.json() : null))
      .then((json: AccuracyReport | null) => setReport(json))
      .catch(() => setReport(null))
  }, [])

  if (!report) return null
  return (
    <div className="mb-8 rounded-warm-lg bg-surface p-6 shadow-warm">
      <h3 className="text-lg font-semibold text-text-primary">Estimate accuracy</h3>
      {!report.overall ? (
        <p className="mt-2 text-sm text-text-muted">
          Record the final invoice on finished jobs (open a quote → Final invoice). Accuracy appears here from the first one.
        </p>
      ) : (
        <>
          <p className="mt-1 text-sm text-text-muted">
            How far your quotes were from what you finally invoiced. Target: median error under{' '}
            {pct(report.targets.medianAbsError)}, at least {pct(report.targets.withinTenPct)} of quotes within ±10%.
            Positive bias means quotes run low.
          </p>
          <Table title="Overall" groups={[report.overall]} targets={report.targets} />
          <Table title="By service" groups={report.byService} targets={report.targets} />
          <Table title="By estimate grade" groups={report.byGrade} targets={report.targets} />
        </>
      )}
    </div>
  )
}
