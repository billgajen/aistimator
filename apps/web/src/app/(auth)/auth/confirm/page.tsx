import Link from 'next/link'
import { AUTH_LINK } from '@/components/auth/auth-form'

/**
 * T-173: the page a link in an account email opens. It uses nothing up: the
 * link is used only when the person presses the button (a POST), so a mail
 * scanner that opens every link in an email cannot spend it first.
 */
export default function ConfirmPage({ searchParams }: { searchParams: { type?: string; token_hash?: string } }) {
  const type = searchParams.type === 'recovery' ? 'recovery' : searchParams.type === 'signup' ? 'signup' : null
  const tokenHash = typeof searchParams.token_hash === 'string' ? searchParams.token_hash : ''

  if (!type || !tokenHash) {
    return (
      <div className="text-center" data-testid="confirm-bad-link">
        <h1 className="mb-2 font-display text-xl font-bold text-text-primary">This link is not complete</h1>
        <p className="mb-6 text-text-secondary">Open the link from the email again, or ask for a new one.</p>
        <Link href="/login" className={`${AUTH_LINK} text-sm`}>
          Back to login
        </Link>
      </div>
    )
  }

  const recovery = type === 'recovery'
  return (
    <div className="text-center">
      <h1 className="mb-2 font-display text-xl font-bold text-text-primary">{recovery ? 'Reset your password' : 'Confirm your email'}</h1>
      <p className="mb-6 text-text-secondary">
        {recovery ? 'Press the button to choose a new password.' : 'Press the button to finish creating your account.'}
      </p>
      <form method="POST" action="/api/auth/confirm">
        <input type="hidden" name="type" value={type} />
        <input type="hidden" name="token_hash" value={tokenHash} />
        <button
          type="submit"
          data-testid="confirm-button"
          className="inline-flex min-h-[44px] w-full items-center justify-center rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-on-primary hover:bg-primary-hover"
        >
          {recovery ? 'Choose a new password' : 'Confirm my email'}
        </button>
      </form>
    </div>
  )
}
