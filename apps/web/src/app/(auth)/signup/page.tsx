'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/Button'
import { MetaPixel, trackMeta } from '@/components/marketing/MetaPixel'
import { useTurnstile } from '@/components/embed/useTurnstile'
import { AUTH_INPUT, AUTH_LABEL, AUTH_LINK, AuthError, Honeypot, postAuth } from '@/components/auth/auth-form'
import { readFirstVisit, rememberFirstVisit } from '@/lib/signup-source'

const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY

export default function SignupPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [businessName, setBusinessName] = useState('')
  const [honeypot, setHoneypot] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)
  // T-173: the human check, invisible unless Cloudflare asks for a tap
  const { containerRef: turnstileRef, getToken: getTurnstileToken } = useTurnstile(TURNSTILE_SITE_KEY)

  // T-189: someone who opens this page first (an advert's link) has their first visit noted here
  useEffect(() => {
    rememberFirstVisit()
  }, [])

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)

    try {
      // T-150: the plan picked on the pricing page (/signup?plan=…) rides along
      // in the user's metadata; the tenant (created on verification) keeps it
      // for the billing page to pre-select. Never starts checkout.
      const plan = new URLSearchParams(window.location.search).get('plan')

      // T-173: sign-up goes through our server (rate limit, human check, and
      // the confirmation email sent by us). The business is created when the
      // address is confirmed, by the database trigger, as before.
      const turnstileToken = await getTurnstileToken()
      const result = await postAuth('/api/auth/signup', {
        email,
        password,
        businessName,
        ...(plan && { plan }),
        // T-189: how they found us, from this tab's first visit (no cookie)
        source: readFirstVisit() ?? undefined,
        turnstileToken: turnstileToken || undefined,
        website: honeypot || undefined,
      })
      if (!result.ok) {
        // what was typed stays in the form
        setError(result.message)
        return
      }

      // T-144: one CompleteRegistration, sent by the Pixel and the
      // Conversions API with the same id (Meta deduplicates). No-op unless configured.
      const eventId = crypto.randomUUID().replace(/-/g, '')
      trackMeta('CompleteRegistration', {}, eventId)
      fetch('/api/marketing/event', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventName: 'CompleteRegistration', eventId, email, pageUrl: window.location.href }),
      }).catch(() => undefined)

      // Show success message - user needs to verify email
      setSuccess(true)
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  // Show success message after signup
  if (success) {
    return (
      <div className="text-center" data-testid="signup-sent">
        <div className="mb-4 flex justify-center">
          <svg className="h-16 w-16 text-secondary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
          </svg>
        </div>
        <h1 className="mb-2 font-display text-xl font-bold text-text-primary">Check your email</h1>
        <p className="mb-6 text-text-secondary">
          We sent a link to <span className="font-medium">{email}</span>.
          Open it to confirm your address and finish creating your account.
        </p>
        <Link href="/login" className={`${AUTH_LINK} text-sm`}>
          Back to login
        </Link>
      </div>
    )
  }

  return (
    <>
      <MetaPixel />
      <h1 className="mb-6 text-center font-display text-xl font-bold text-text-primary">Create your account</h1>

      <form onSubmit={handleSignup} className="space-y-4">
        <AuthError message={error} />

        <div>
          <label htmlFor="businessName" className={AUTH_LABEL}>
            Business name
          </label>
          <input
            id="businessName"
            type="text"
            value={businessName}
            onChange={(e) => setBusinessName(e.target.value)}
            required
            maxLength={120}
            className={AUTH_INPUT}
            placeholder="Acme Services"
          />
        </div>

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

        <div>
          <label htmlFor="password" className={AUTH_LABEL}>
            Password
          </label>
          <input
            id="password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
            className={AUTH_INPUT}
            placeholder="••••••••"
          />
          <p className="mt-1 text-xs text-text-muted">Minimum 8 characters</p>
        </div>

        <Honeypot value={honeypot} onChange={setHoneypot} />
        {/* The human check mounts here only if Cloudflare asks for a tap */}
        <div ref={turnstileRef} className="flex justify-center empty:hidden" />

        <Button type="submit" loading={loading} className="w-full">
          {loading ? 'Creating account...' : 'Create account'}
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-text-secondary">
        Already have an account?{' '}
        <Link href="/login" className={AUTH_LINK} data-testid="login-link">
          Log in
        </Link>
      </p>
    </>
  )
}
