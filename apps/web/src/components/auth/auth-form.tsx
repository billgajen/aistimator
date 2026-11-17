/**
 * T-173: what the account pages share. No 'use client': the constants are
 * read by a server page too. The classes are the ones the log-in
 * and sign-up pages already used; nothing new is styled here.
 */
export const AUTH_INPUT =
  'w-full min-h-[44px] rounded-xl border border-field bg-white px-3 py-2 text-base text-text-primary placeholder:text-text-muted focus:border-primary focus:outline-none focus:ring-2'
export const AUTH_LABEL = 'mb-1.5 block text-sm font-medium text-text-primary'
export const AUTH_LINK = 'inline-flex min-h-[24px] items-center font-semibold text-primary underline underline-offset-4'

export function AuthError({ message }: { message: string | null }) {
  if (!message) return null
  return (
    <div className="rounded-xl bg-danger-light p-3 text-sm text-danger" role="alert" data-testid="auth-error">
      {message}
    </div>
  )
}

export function AuthNotice({ message }: { message: string | null }) {
  if (!message) return null
  return (
    <div className="rounded-xl border border-border bg-surface p-3 text-sm text-text-secondary" role="status" data-testid="auth-notice">
      {message}
    </div>
  )
}

/** Off-screen field people never see or reach; a filled one marks a bot (same as the request form's) */
export function Honeypot({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <div aria-hidden="true" style={{ position: 'absolute', left: '-9999px', top: 0, height: 0, overflow: 'hidden' }}>
      <label>
        Website
        <input type="text" name="website" tabIndex={-1} autoComplete="off" value={value} onChange={(e) => onChange(e.target.value)} />
      </label>
    </div>
  )
}

export interface AuthResult {
  ok: boolean
  message: string | null
}

/** POST to an account route. A refusal comes back as its plain message; what was typed stays in the form. */
export async function postAuth(path: string, body: Record<string, unknown>): Promise<AuthResult> {
  try {
    const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    if (res.ok) return { ok: true, message: null }
    const json = (await res.json().catch(() => null)) as { error?: { message?: string } } | null
    return { ok: false, message: json?.error?.message || 'Something went wrong. Please try again.' }
  } catch {
    return { ok: false, message: 'We could not reach the server. Check your connection and try again.' }
  }
}

/** The short notes a page shows when it was reached from a link that no longer works */
export function noticeFor(code: string | null): string | null {
  if (code === 'link-expired') return 'That link has expired or was already used.'
  if (code === 'too-many') return 'Too many tries in a short time. Please wait a minute and try again.'
  if (code === 'password-changed') return 'Your password is changed. You are logged in.'
  return null
}
