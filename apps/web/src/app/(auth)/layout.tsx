import type { Metadata } from 'next'

// Force dynamic rendering for auth pages
export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Estimator - Auth',
}

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-md">
        {/* Brand mark */}
        <div className="mb-8 text-center">
          <h2 className="font-display text-3xl font-extrabold tracking-tight text-text-primary">Estimator</h2>
          <p className="mt-2 text-sm font-medium text-text-secondary">AI-powered estimates for your business</p>
        </div>
        {/* Auth card */}
        <div className="animate-fade-in-up rounded-2xl border border-border bg-background p-8 shadow-warm-md">
          {children}
        </div>
      </div>
    </div>
  )
}
