import Link from 'next/link'

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-background p-24">
      <div className="animate-fade-in-up text-center">
        <h1 className="font-display text-6xl font-extrabold tracking-tight text-text-primary">Estimator</h1>
        <p className="mt-4 text-lg text-text-secondary">AI-powered estimate platform</p>
        <div className="mt-8 flex gap-4 justify-center">
          <Link
            href="/login"
            className="rounded-lg bg-primary px-8 py-3 text-sm font-semibold text-white transition-colors hover:bg-primary-hover"
          >
            Sign in
          </Link>
          <Link
            href="/signup"
            className="rounded-lg border border-border bg-surface px-8 py-3 text-sm font-semibold text-text-primary transition-colors hover:border-border-strong hover:bg-background"
          >
            Get started
          </Link>
        </div>
      </div>
    </main>
  )
}
