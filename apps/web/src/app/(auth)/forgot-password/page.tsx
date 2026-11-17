'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/Button'
import { AUTH_INPUT, AUTH_LABEL, AUTH_LINK, AuthError, AuthNotice, Honeypot, noticeFor, postAuth } from '@/components/auth/auth-form'

/** T-173: ask for a password reset email */
export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [honeypot, setHoneypot] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)

  useEffect(() => {
    setNotice(noticeFor(new URLSearchParams(window.location.search).get('notice')))
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)
    const result = await postAuth('/api/auth/forgot-password', { email, website: honeypot || undefined })
    setLoading(false)
    if (!result.ok) {
      setError(result.message)
      return
    }
    setSent(true)
  }

  if (sent) {
    return (
      <div className="text-center" data-testid="reset-sent">
        <h1 className="mb-2 font-display text-xl font-bold text-text-primary">Check your email</h1>
        <p className="mb-6 text-text-secondary">
          If <span className="font-medium">{email}</span> has an account, we have sent it a link to choose a new password.
          The link works once, for one hour.
        </p>
        <Link href="/login" className={`${AUTH_LINK} text-sm`}>
          Back to login
        </Link>
      </div>
    )
  }

  return (
    <>
      <h1 className="mb-2 text-center font-display text-xl font-bold text-text-primary">Reset your password</h1>
      <p className="mb-6 text-center text-sm text-text-secondary">Enter your email and we will send you a link to choose a new one.</p>

      <form onSubmit={handleSubmit} className="space-y-4">
        <AuthNotice message={notice} />
        <AuthError message={error} />

        <div>
          <label htmlFor="email" className={AUTH_LABEL}>
            Email
          </label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className={AUTH_INPUT}
            placeholder="you@example.com"
          />
        </div>

        <Honeypot value={honeypot} onChange={setHoneypot} />

        <Button type="submit" loading={loading} className="w-full">
          {loading ? 'Sending...' : 'Send the link'}
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-text-secondary">
        <Link href="/login" className={AUTH_LINK}>
          Back to login
        </Link>
      </p>
    </>
  )
}
