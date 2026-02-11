'use client'

import { useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/Button'

export default function SignupPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [businessName, setBusinessName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)
  const supabase = createClient()

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)

    try {
      // Sign up the user - tenant is created automatically via database trigger
      const { error: signUpError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            business_name: businessName,
          },
        },
      })

      if (signUpError) {
        setError(signUpError.message)
        return
      }

      // Show success message - user needs to verify email
      setSuccess(true)
    } catch {
      setError('An unexpected error occurred')
    } finally {
      setLoading(false)
    }
  }

  // Show success message after signup
  if (success) {
    return (
      <div className="text-center">
        <div className="mb-4 flex justify-center">
          <svg className="h-16 w-16 text-secondary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
          </svg>
        </div>
        <h1 className="mb-2 font-display text-xl font-bold text-text-primary">Check your email</h1>
        <p className="mb-6 text-text-secondary">
          We sent a verification link to <span className="font-medium">{email}</span>.
          Click the link to activate your account.
        </p>
        <Link
          href="/login"
          className="text-sm text-primary hover:underline"
        >
          Back to login
        </Link>
      </div>
    )
  }

  return (
    <>
      <h1 className="mb-6 text-center font-display text-xl font-bold text-text-primary">Create your account</h1>

      <form onSubmit={handleSignup} className="space-y-4">
        {error && (
          <div className="rounded-warm-lg bg-danger-light p-3 text-sm text-danger">{error}</div>
        )}

        <div>
          <label htmlFor="businessName" className="mb-1.5 block text-sm font-medium text-text-primary">
            Business name
          </label>
          <input
            id="businessName"
            type="text"
            value={businessName}
            onChange={(e) => setBusinessName(e.target.value)}
            required
            className="w-full rounded-warm-lg border border-border bg-surface px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
            placeholder="Acme Services"
          />
        </div>

        <div>
          <label htmlFor="email" className="mb-1.5 block text-sm font-medium text-text-primary">
            Email
          </label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="w-full rounded-warm-lg border border-border bg-surface px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
            placeholder="you@example.com"
          />
        </div>

        <div>
          <label htmlFor="password" className="mb-1.5 block text-sm font-medium text-text-primary">
            Password
          </label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
            className="w-full rounded-warm-lg border border-border bg-surface px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
            placeholder="••••••••"
          />
          <p className="mt-1 text-xs text-text-muted">Minimum 8 characters</p>
        </div>

        <Button type="submit" loading={loading} className="w-full">
          {loading ? 'Creating account...' : 'Create account'}
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-text-secondary">
        Already have an account?{' '}
        <Link href="/login" className="text-primary hover:underline">
          Log in
        </Link>
      </p>
    </>
  )
}
