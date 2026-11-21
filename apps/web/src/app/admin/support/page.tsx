'use client'

/**
 * T-197: the support inbox. Platform admin only (the middleware and every
 * route it reads check it). Three tabs: Problems (problem reports and
 * estimate reports together, by priority), Feature requests (by votes), All.
 */
import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { FEATURE_OPEN_STATUSES, FEATURE_STATUSES, SUPPORT_CAUSES, SUPPORT_COPY, SUPPORT_OPEN_STATUSES, SUPPORT_REPORT_KINDS, SUPPORT_SEVERITIES, SUPPORT_STATUSES, ageWords } from '@qolumns/shared'
import type { FeatureRow, ProblemRow } from '@/lib/support-admin'
import { FeatureStatusPill, StatusPill } from '@/components/help/parts'
import { SeverityMark } from '@/components/admin/SupportParts'

type Tab = 'problems' | 'features' | 'all'
const TABS: Array<{ key: Tab; label: string }> = [
  { key: 'problems', label: 'Problems' },
  { key: 'features', label: 'Feature requests' },
  { key: 'all', label: 'All' },
]
const C = SUPPORT_COPY
const SELECT = 'min-h-[40px] rounded-lg border border-field bg-white px-3 text-sm text-text-primary focus:border-primary focus:outline-none focus:ring-2'
const TH = 'px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-text-muted'
/** The inbox opens on what still needs the owner: "New" and "Looking into it" (and requests not yet decided) */
const OPEN = 'open'
const isOpen = (status: string) => (SUPPORT_OPEN_STATUSES as readonly string[]).includes(status) || (FEATURE_OPEN_STATUSES as readonly string[]).includes(status)
const statusFits = (wanted: string, status: string) => !wanted || (wanted === OPEN ? isOpen(status) : status === wanted)

export default function SupportInboxPage() {
  const [tab, setTab] = useState<Tab>('problems')
  const [problems, setProblems] = useState<ProblemRow[]>([])
  const [features, setFeatures] = useState<FeatureRow[]>([])
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading')
  const [kind, setKind] = useState('')
  const [status, setStatus] = useState(OPEN)
  const [severity, setSeverity] = useState('')
  const [cause, setCause] = useState('')
  const [template, setTemplate] = useState('')

  useEffect(() => {
    fetch('/api/admin/support')
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error('failed'))))
      .then((data: { problems: ProblemRow[]; features: FeatureRow[] }) => {
        setProblems(data.problems)
        setFeatures(data.features)
        setState('ready')
      })
      .catch(() => setState('failed'))
  }, [])

  const templates = useMemo(() => [...new Set(problems.map((p) => p.serviceTemplate).filter((t): t is string => Boolean(t)))].sort(), [problems])
  const shownProblems = problems.filter(
    (p) =>
      (!kind || p.reportKind === kind) &&
      statusFits(status, p.status) &&
      (!severity || (severity === 'unsorted' ? !p.severity : p.severity === severity)) &&
      (!cause || p.likelyCause === cause) &&
      (!template || p.serviceTemplate === template)
  )
  const shownFeatures = features.filter((f) => statusFits(status, f.status))
  // the number on each tab is what is still open, whatever the filters show
  const openProblems = problems.filter((p) => isOpen(p.status)).length
  const openFeatures = features.filter((f) => isOpen(f.status)).length
  const now = new Date()

  return (
    <div data-testid="support-inbox">
      <h1 className="text-2xl font-bold text-text-primary">Support</h1>
      <p className="mt-2 text-text-secondary">Every report from a business in one queue. The AI sorts and drafts; you decide.</p>

      <div className="mt-6 flex flex-wrap gap-2" role="tablist" aria-label="Inbox">
        {TABS.map((item) => (
          <button
            key={item.key}
            role="tab"
            aria-selected={tab === item.key}
            onClick={() => {
              setTab(item.key)
              setStatus(OPEN)
            }}
            className={`min-h-[40px] rounded-lg px-4 text-sm font-semibold transition-colors ${tab === item.key ? 'bg-primary text-white' : 'border border-field bg-white text-text-primary hover:bg-surface'}`}
            data-testid="inbox-tab"
            data-tab={item.key}
          >
            {item.label}
            <span className="figure ml-2 font-normal">{item.key === 'problems' ? openProblems : item.key === 'features' ? openFeatures : openProblems + openFeatures}</span>
          </button>
        ))}
      </div>

      <div className="mt-4 flex flex-wrap gap-2" data-testid="inbox-filters">
        {tab !== 'features' && (
          <select value={kind} onChange={(e) => setKind(e.target.value)} className={SELECT} aria-label="Kind">
            <option value="">Any kind</option>
            {SUPPORT_REPORT_KINDS.map((k) => (
              <option key={k} value={k}>{C.reportKind[k]}</option>
            ))}
          </select>
        )}
        <select value={status} onChange={(e) => setStatus(e.target.value)} className={SELECT} aria-label="Status">
          <option value={OPEN}>Open</option>
          <option value="">Any status</option>
          {tab !== 'features' && SUPPORT_STATUSES.map((s) => (
            <option key={s} value={s}>{C.ownerStatus[s]}</option>
          ))}
          {tab !== 'problems' && FEATURE_STATUSES.map((s) => (
            <option key={s} value={s}>{C.featureStatus[s]}</option>
          ))}
        </select>
        {tab !== 'features' && (
          <>
            <select value={severity} onChange={(e) => setSeverity(e.target.value)} className={SELECT} aria-label="Severity">
              <option value="">Any severity</option>
              {SUPPORT_SEVERITIES.map((s) => (
                <option key={s} value={s}>{C.severity[s]}</option>
              ))}
              <option value="unsorted">Not sorted</option>
            </select>
            <select value={cause} onChange={(e) => setCause(e.target.value)} className={SELECT} aria-label="Likely cause">
              <option value="">Any likely cause</option>
              {SUPPORT_CAUSES.map((c) => (
                <option key={c} value={c}>{C.cause[c]}</option>
              ))}
            </select>
            <select value={template} onChange={(e) => setTemplate(e.target.value)} className={SELECT} aria-label="Service template">
              <option value="">Any service template</option>
              {templates.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </>
        )}
      </div>

      {state === 'failed' && <p role="alert" className="mt-6 rounded-xl bg-danger-light p-4 text-danger">The inbox could not be loaded.</p>}
      {state === 'loading' && <p className="mt-6 text-text-muted">Loading…</p>}

      {state === 'ready' && tab !== 'features' && (
        <div className="mt-6 overflow-x-auto rounded-xl bg-white shadow-warm-md" data-testid="problems-table">
          <table className="min-w-full divide-y divide-border">
            <thead className="bg-surface">
              <tr>
                <th className={TH}>Problem</th>
                <th className={TH}>Kind</th>
                <th className={TH}>Severity</th>
                <th className={TH}>Businesses</th>
                <th className={TH}>Status</th>
                <th className={TH}>Age</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {shownProblems.map((p) => (
                <tr key={p.id} className="hover:bg-background" data-testid="problem-row" data-id={p.id}>
                  <td className="max-w-md px-4 py-3">
                    <Link href={`/admin/support/problems/${p.id}`} className="text-sm font-semibold text-primary underline-offset-2 hover:underline">
                      {p.title}
                    </Link>
                    <p className="mt-0.5 text-xs text-text-muted">
                      {p.business}
                      {p.isTest && ' · test estimate'}
                      {p.sortState === 'failed' && ' · sorting failed'}
                      {p.sortState === 'waiting' && ' · waiting to be sorted'}
                      {p.mergeSuggested && ' · looks like one already open'}
                      {p.approved && ' · approved for fixing'}
                    </p>
                  </td>
                  <td className="px-4 py-3 text-sm text-text-secondary">
                    {C.reportKind[p.reportKind]}
                    {p.aiKind && <span className="block text-xs text-text-muted">{C.aiKind[p.aiKind]}</span>}
                  </td>
                  <td className="px-4 py-3"><SeverityMark severity={p.severity} /></td>
                  <td className="figure px-4 py-3 text-sm text-text-primary">{p.businesses}</td>
                  <td className="px-4 py-3"><StatusPill status={p.status} owner /></td>
                  <td className="figure whitespace-nowrap px-4 py-3 text-sm text-text-secondary">{ageWords(p.createdAt, now)}</td>
                </tr>
              ))}
              {shownProblems.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-sm text-text-muted">No problems here.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {state === 'ready' && tab !== 'problems' && (
        <div className="mt-6 overflow-x-auto rounded-xl bg-white shadow-warm-md" data-testid="features-table">
          <table className="min-w-full divide-y divide-border">
            <thead className="bg-surface">
              <tr>
                <th className={TH}>Feature request</th>
                <th className={TH}>Votes</th>
                <th className={TH}>Paying</th>
                <th className={TH}>Status</th>
                <th className={TH}>Age</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {shownFeatures.map((f) => (
                <tr key={f.id} className="hover:bg-background" data-testid="feature-row" data-id={f.id}>
                  <td className="max-w-md px-4 py-3">
                    <Link href={`/admin/support/features/${f.id}`} className="text-sm font-semibold text-primary underline-offset-2 hover:underline">
                      {f.title}
                    </Link>
                    <p className="mt-0.5 text-xs text-text-muted">
                      {f.summary || (f.ownWords ? 'In the business’s own words: not shown to other businesses until it has a title.' : '')}
                      {f.isNew && ' · new'}
                    </p>
                  </td>
                  <td className="figure px-4 py-3 text-sm text-text-primary">{f.votes}</td>
                  <td className="figure px-4 py-3 text-sm text-text-secondary">{f.paying}</td>
                  <td className="px-4 py-3"><FeatureStatusPill status={f.status} /></td>
                  <td className="figure whitespace-nowrap px-4 py-3 text-sm text-text-secondary">{ageWords(f.createdAt, now)}</td>
                </tr>
              ))}
              {shownFeatures.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-sm text-text-muted">No feature requests here.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
