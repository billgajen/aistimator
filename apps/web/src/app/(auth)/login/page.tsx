'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { AUTH_INPUT, AUTH_LABEL, AUTH_LINK, AuthError, AuthNotice, noticeFor, postAuth } from '@/components/auth/auth-form'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  // A link from an email that no longer works lands here with a short note
  useEffect(() => {
    setNotice(noticeFor(new URLSearchParams(window.location.search).get('notice')))
  }, [])

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)

    try {
      // T-173: log-in goes through our server, which rate limits it and sets the session
      const result = await postAuth('/api/auth/login', { email, password })
      if (!result.ok) {
        setError(result.message)
        return
      }

      router.push('/app')
      router.refresh()
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <h1 className="mb-6 text-center font-display text-xl font-bold text-text-primary">Log in to your account</h1>

      <form onSubmit={handleLogin} className="space-y-4">
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

        <div>
          <label htmlFor="password" className={AUTH_LABEL}>
            Password
          </label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            className={AUTH_INPUT}
            placeholder="••••••••"
          />
          <p className="mt-2 text-sm">
            <Link href="/forgot-password" className={AUTH_LINK} data-testid="forgot-link">
              Forgot your password?
            </Link>
          </p>
        </div>

        <Button type="submit" loading={loading} className="w-full">
          {loading ? 'Logging in...' : 'Log in'}
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-text-secondary">
        Don&apos;t have an account?{' '}
        <Link href="/signup" className={AUTH_LINK} data-testid="signup-link">
          Sign up
        </Link>
      </p>
    </>
  )
}
