'use client'

/**
 * T-197: "Report a problem". One box, an optional screenshot, and the list of
 * what we attach, shown before it is sent. The report is saved even when the
 * screenshot cannot be added.
 */
import { useMemo, useRef, useState } from 'react'
import { SUPPORT_COPY, supportContextLines } from '@qolumns/shared'
import { gatherContext, lastShownError } from '@/lib/help-context'
import { UPLOAD_IMAGE_TYPES, UPLOAD_MAX_IMAGE_BYTES } from '@/lib/upload-limits'
import { FIELD, FormError, LABEL, MAIN_BUTTON, Thanks, postJson } from './parts'

const C = SUPPORT_COPY.problem

/** Put the image in private storage the way every dashboard upload goes; the id of the stored file, or null */
async function uploadScreenshot(file: File): Promise<string | null> {
  const init = await postJson<{ uploads?: Array<{ assetId: string; uploadUrl: string }> }>('/api/uploads/init', {
    files: [{ fileName: file.name || 'screenshot', contentType: file.type, sizeBytes: file.size }],
  })
  const upload = init.data?.uploads?.[0]
  if (!init.ok || !upload) return null
  try {
    const put = await fetch(upload.uploadUrl, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file })
    return put.ok ? upload.assetId : null
  } catch {
    return null
  }
}

export function ProblemForm({ pathname, plan, initialText, onSent, onDone }: { pathname: string; plan: string | null; /** T-198: words carried over from a conversation with the assistant */ initialText?: string; onSent: () => void; onDone: () => void }) {
  const [text, setText] = useState(initialText ?? '')
  const [file, setFile] = useState<File | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [thanks, setThanks] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  // gathered once, when the form opens: what the business reads is what is sent
  const context = useMemo(
    () => gatherContext({ pathname, userAgent: navigator.userAgent, width: window.innerWidth, height: window.innerHeight, lastError: lastShownError(document), plan }),
    [pathname, plan]
  )
  const lines = supportContextLines(context)

  const pick = (picked: File | null) => {
    setError(null)
    if (picked && !UPLOAD_IMAGE_TYPES.includes(picked.type)) {
      setFile(null)
      setError('A screenshot must be an image (JPEG, PNG, WebP or HEIC).')
      return
    }
    if (picked && picked.size > UPLOAD_MAX_IMAGE_BYTES) {
      setFile(null)
      setError('That image is over 10 MB. Choose a smaller one.')
      return
    }
    setFile(picked)
  }

  const send = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!text.trim()) {
      setError(C.required)
      return
    }
    setSending(true)
    setError(null)
    const assetId = file ? await uploadScreenshot(file) : null
    const result = await postJson<{ message?: string }>('/api/support/reports', { kind: 'problem', body: text, screenshotAssetId: assetId, context })
    setSending(false)
    if (!result.ok) {
      setError(result.data?.error?.message ?? SUPPORT_COPY.failed)
      return
    }
    onSent()
    setThanks(`${result.data?.message ?? C.thanks}${file && !assetId ? ' Your screenshot could not be added.' : ''}`)
  }

  if (thanks) return <Thanks message={thanks} onDone={onDone} />

  return (
    <form onSubmit={send} className="space-y-5" data-testid="problem-form" noValidate>
      <div>
        <label htmlFor="help-problem" className={LABEL}>
          {C.label} <span className="font-normal text-text-muted">(required)</span>
        </label>
        <textarea id="help-problem" value={text} onChange={(e) => setText(e.target.value)} rows={5} maxLength={4000} className={FIELD} data-testid="problem-text" />
      </div>

      <div>
        <label htmlFor="help-screenshot" className={LABEL}>
          {C.screenshot}
        </label>
        <input
          id="help-screenshot"
          ref={fileInput}
          type="file"
          accept={UPLOAD_IMAGE_TYPES.join(',')}
          onChange={(e) => pick(e.target.files?.[0] ?? null)}
          className="block w-full text-sm text-text-secondary file:mr-3 file:min-h-[44px] file:rounded-lg file:border file:border-solid file:border-field file:bg-white file:px-4 file:text-sm file:font-semibold file:text-text-primary"
          data-testid="problem-screenshot"
        />
        <p className="mt-1 text-xs text-text-muted">{C.screenshotHint}</p>
      </div>

      {lines.length > 0 && (
        <div className="rounded-xl bg-surface px-4 py-3" data-testid="problem-include">
          <p className="text-sm font-semibold text-text-primary">{C.include}</p>
          <dl className="mt-2 space-y-1.5 text-sm">
            {lines.map((line) => (
              <div key={line.label} className="flex flex-col sm:flex-row sm:gap-2">
                <dt className="shrink-0 text-text-muted">{line.label}</dt>
                <dd className="min-w-0 break-words text-text-secondary">{line.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}

      <FormError message={error} />
      <button type="submit" disabled={sending} className={MAIN_BUTTON} data-testid="problem-send">
        {sending ? C.sending : C.send}
      </button>
    </form>
  )
}
