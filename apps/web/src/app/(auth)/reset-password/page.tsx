'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { AUTH_INPUT, AUTH_LABEL, AUTH_LINK, AuthError, postAuth } from '@/components/auth/auth-form'

/**
 * T-173: choose a new password. Reached from the link in the reset email,
 * which logs the person in; the route refuses anyone who is not logged in.
 */
export default function ResetPasswordPage() {
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)
    const result = await postAuth('/api/auth/reset-password', { password })
    setLoading(false)
    if (!result.ok) {
      setError(result.message)
      return
    }
    router.push('/app')
    router.refresh()
  }

  return (
    <>
      <h1 className="mb-6 text-center font-display text-xl font-bold text-text-primary">Choose a new password</h1>

      <form onSubmit={handleSubmit} className="space-y-4">
        <AuthError message={error} />

        <div>
          <label htmlFor="password" className={AUTH_LABEL}>
            New password
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

        <Button type="submit" loading={loading} className="w-full">
          {loading ? 'Saving...' : 'Save the new password'}
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-text-secondary">
        <Link href="/forgot-password" className={AUTH_LINK}>
          Send me a new link
        </Link>
      </p>
    </>
  )
}
