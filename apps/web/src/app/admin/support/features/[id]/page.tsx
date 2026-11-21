'use client'

/**
 * T-197: one feature request in the support inbox: its title and summary,
 * the businesses that asked with their own words, and the owner's actions
 * (rename, edit the summary, merge, split, set a status). "Shipped" is
 * confirmed first and emails every business that voted, once.
 */
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'
import { FEATURE_STATUSES, SUPPORT_COPY, type FeatureStatus } from '@qolumns/shared'
import type { FeatureDetail } from '@/lib/support-admin'
import { FeatureStatusPill, shortDate } from '@/components/help/parts'
import { ADMIN_FIELD, ADMIN_MAIN, ADMIN_QUIET, ADMIN_SELECT, CARD, CARD_TITLE, ConfirmSend, act, type SendPreview } from '@/components/admin/SupportParts'

const C = SUPPORT_COPY

export default function FeaturePage({ params }: { params: { id: string } }) {
  const url = `/api/admin/support/features/${params.id}`
  const router = useRouter()
  const [feature, setFeature] = useState<FeatureDetail | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'missing'>('loading')
  const [note, setNote] = useState<{ text: string; tone: 'ok' | 'error' } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [summary, setSummary] = useState('')
  const [mergeInto, setMergeInto] = useState('')
  const [preview, setPreview] = useState<SendPreview | null>(null)

  const load = useCallback(async () => {
    try {
      const response = await fetch(url)
      if (!response.ok) return setState('missing')
      const data = (await response.json()) as { feature: FeatureDetail }
      setFeature(data.feature)
      setTitle(data.feature.title)
      setSummary(data.feature.summary)
      setState('ready')
    } catch {
      setState('missing')
    }
  }, [url])
  useEffect(() => {
    void load()
  }, [load])

  const run = async (name: string, body: Record<string, unknown>, done: string) => {
    setBusy(name)
    setNote(null)
    const result = await act<{ newId?: string }>(url, body)
    setBusy(null)
    setNote(result.ok ? { text: done, tone: 'ok' } : { text: result.message ?? 'That could not be done.', tone: 'error' })
    if (result.ok) await load()
    return result
  }

  if (state === 'loading') return <p className="text-text-muted">Loading…</p>
  if (state === 'missing' || !feature) return <p role="alert" className="rounded-xl bg-danger-light p-4 text-danger">That request could not be found.</p>

  const paying = feature.votes.filter((v) => v.paying).length
  const askShipped = async () => {
    setBusy('shipped')
    setNote(null)
    const result = await act<{ preview?: SendPreview }>(url, { action: 'shipped', confirm: false })
    setBusy(null)
    if (result.ok && result.data?.preview) setPreview(result.data.preview)
    else setNote({ text: result.message ?? 'The email could not be prepared.', tone: 'error' })
  }
  const confirmShipped = async () => {
    setBusy('shipped-confirm')
    const result = await act<{ businesses?: number; emailed?: number }>(url, { action: 'shipped', confirm: true })
    setBusy(null)
    if (!result.ok) return setNote({ text: result.message ?? 'That could not be done.', tone: 'error' })
    setPreview(null)
    setNote({ text: `Set to shipped. ${result.data?.emailed ?? 0} of ${result.data?.businesses ?? 0} businesses emailed.`, tone: 'ok' })
    await load()
  }

  return (
    <div className="space-y-6" data-testid="feature-page">
      <div>
        <Link href="/admin/support" className="text-sm font-semibold text-primary underline underline-offset-2">
          Back to the inbox
        </Link>
        <h1 className="mt-3 text-2xl font-bold text-text-primary" data-testid="feature-title">{feature.title}</h1>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-text-secondary">
          <FeatureStatusPill status={feature.status} />
          <span>
            <span className="figure">{feature.votes.length}</span> {feature.votes.length === 1 ? 'business' : 'businesses'} asked, <span className="figure">{paying}</span> paying
          </span>
          <span>· since <span className="figure">{shortDate(feature.createdAt)}</span></span>
        </div>
        {feature.ownWords && (
          <p className="mt-3 rounded-lg border border-tertiary-line bg-white px-4 py-3 text-sm text-text-secondary" data-testid="feature-own-words">
            This title is still the first business’s own words, so it is not offered to other businesses as a match. Give it a title to change that.
          </p>
        )}
        {feature.mergedInto && (
          <p className="mt-3 rounded-lg border border-border bg-surface px-4 py-3 text-sm text-text-secondary">
            Merged into{' '}
            <Link href={`/admin/support/features/${feature.mergedInto.id}`} className="font-semibold text-primary underline underline-offset-2">{feature.mergedInto.title}</Link>.
          </p>
        )}
      </div>

      {note && (
        <p role={note.tone === 'error' ? 'alert' : 'status'} className={`rounded-lg border px-4 py-3 text-sm ${note.tone === 'error' ? 'border-danger-line bg-danger-light text-danger' : 'border-secondary-line bg-secondary-light text-secondary'}`} data-testid="admin-note">
          {note.text}
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <section className={CARD} aria-labelledby="words" data-testid="feature-edit">
          <h2 id="words" className={CARD_TITLE}>Title and summary</h2>
          <label htmlFor="feature-title-input" className="mt-3 block text-sm font-semibold text-text-primary">Title</label>
          <input id="feature-title-input" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} className={`${ADMIN_FIELD} mt-1.5`} data-testid="feature-title-input" />
          <label htmlFor="feature-summary-input" className="mt-4 block text-sm font-semibold text-text-primary">One-line summary</label>
          <textarea id="feature-summary-input" value={summary} onChange={(e) => setSummary(e.target.value)} rows={2} maxLength={400} className={`${ADMIN_FIELD} mt-1.5`} data-testid="feature-summary-input" />
          <p className="mt-1 text-xs text-text-muted">Other businesses see the title and this line when theirs looks the same. Never who asked.</p>
          <button type="button" disabled={busy !== null || !title.trim()} onClick={() => run('rename', { action: 'rename', title, summary }, 'Saved.')} className={`${ADMIN_MAIN} mt-3`} data-testid="feature-save">
            Save
          </button>
        </section>

        <section className={CARD} aria-labelledby="fstatus" data-testid="feature-status-card">
          <h2 id="fstatus" className={CARD_TITLE}>Status</h2>
          <div className="mt-3 flex flex-wrap gap-2">
            {FEATURE_STATUSES.filter((s) => s !== 'shipped').map((s: FeatureStatus) => (
              <button key={s} type="button" disabled={busy !== null || feature.status === s} onClick={() => run('status', { action: 'status', status: s }, `Set to “${C.featureStatus[s]}”.`)} className={feature.status === s ? ADMIN_MAIN : ADMIN_QUIET} data-testid="set-feature-status" data-status={s}>
                {C.featureStatus[s]}
              </button>
            ))}
            <button type="button" disabled={busy !== null} onClick={askShipped} className={feature.status === 'shipped' ? ADMIN_MAIN : ADMIN_QUIET} data-testid="set-shipped">
              {busy === 'shipped' ? 'Preparing…' : `${C.featureStatus.shipped}…`}
            </button>
          </div>
          {preview && <ConfirmSend preview={preview} action="shipped" busy={busy === 'shipped-confirm'} onConfirm={confirmShipped} onCancel={() => setPreview(null)} />}

          {!feature.mergedInto && (
            <div className="mt-5 border-t border-border pt-4">
              <p className="text-sm font-semibold text-text-primary">Merge</p>
              <div className="mt-1.5 flex flex-wrap gap-2">
                <select value={mergeInto} onChange={(e) => setMergeInto(e.target.value)} className={`${ADMIN_SELECT} min-w-0 flex-1`} aria-label="Merge into another request" data-testid="feature-merge-select">
                  <option value="">Merge into another request…</option>
                  {feature.mergeTargets.map((target) => (
                    <option key={target.id} value={target.id}>{target.title}</option>
                  ))}
                </select>
                <button
                  type="button"
                  disabled={busy !== null || !mergeInto}
                  onClick={async () => {
                    const target = mergeInto
                    const result = await run('merge', { action: 'merge', into: target }, 'Merged.')
                    if (result.ok) router.push(`/admin/support/features/${target}`)
                  }}
                  className={ADMIN_QUIET}
                  data-testid="feature-merge-button"
                >
                  Merge
                </button>
              </div>
              {feature.merged.length > 0 && <p className="mt-2 text-sm text-text-secondary" data-testid="feature-merged">Merged into this one: {feature.merged.map((m) => m.title).join('; ')}</p>}
            </div>
          )}
        </section>
      </div>

      <section className={CARD} aria-labelledby="votes" data-testid="feature-votes">
        <h2 id="votes" className={CARD_TITLE}>The businesses that asked</h2>
        {feature.votes.length === 0 ? (
          <p className="mt-2 text-sm text-text-muted">Nobody is on this request now.</p>
        ) : (
          <ul className="mt-3 divide-y divide-border">
            {feature.votes.map((vote) => (
              <li key={vote.id} className="flex flex-wrap items-start gap-3 py-3" data-testid="feature-vote-row">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-text-primary">
                    {vote.business}
                    <span className="ml-2 font-normal text-text-muted">
                      {vote.plan ?? 'no plan'}
                      {vote.paying ? ', paying' : ''} · <span className="figure">{shortDate(vote.createdAt)}</span>
                    </span>
                  </p>
                  <p className="mt-1 whitespace-pre-wrap break-words text-sm text-text-secondary">{vote.body || '(added a vote, no words)'}</p>
                </div>
                {feature.votes.length > 1 && (
                  <button type="button" disabled={busy !== null} onClick={() => run('split', { action: 'split', voteId: vote.id }, 'Split out into a request of its own.')} className={ADMIN_QUIET} data-testid="feature-split">
                    Split out
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
