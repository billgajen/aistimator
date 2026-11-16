'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/Button'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const router = useRouter()
  const supabase = createClient()

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)

    try {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      })

      if (error) {
        setError(error.message)
        return
      }

      router.push('/app')
      router.refresh()
    } catch {
      setError('An unexpected error occurred')
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <h1 className="mb-6 text-center font-display text-xl font-bold text-text-primary">Log in to your account</h1>

      <form onSubmit={handleLogin} className="space-y-4">
        {error && (
          <div className="rounded-xl bg-danger-light p-3 text-sm text-danger">{error}</div>
        )}

        <div>
          <label htmlFor="email" className="mb-1.5 block text-sm font-medium text-text-primary">
            Email
          </label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="w-full min-h-[44px] rounded-xl border border-field bg-white px-3 py-2 text-base text-text-primary placeholder:text-text-muted focus:border-primary focus:outline-none focus:ring-2"
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
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            className="w-full min-h-[44px] rounded-xl border border-field bg-white px-3 py-2 text-base text-text-primary placeholder:text-text-muted focus:border-primary focus:outline-none focus:ring-2"
            placeholder="••••••••"
          />
        </div>

        <Button type="submit" loading={loading} className="w-full">
          {loading ? 'Logging in...' : 'Log in'}
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-text-secondary">
        Don&apos;t have an account?{' '}
        <Link href="/signup" className="inline-flex min-h-[24px] items-center font-semibold text-primary underline underline-offset-4" data-testid="signup-link">
          Sign up
        </Link>
      </p>
    </>
  )
}
