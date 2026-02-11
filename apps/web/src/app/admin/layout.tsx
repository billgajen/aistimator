import Link from 'next/link'

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background">
      {/* Admin Header */}
      <header className="bg-text-primary text-surface">
        <div className="mx-auto max-w-7xl px-4 py-3 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Link href="/admin" className="font-display text-lg font-bold">
                Admin Panel
              </Link>
              <span className="rounded-full bg-tertiary/20 px-2.5 py-0.5 text-xs font-medium text-tertiary">
                Support Tools
              </span>
            </div>
            <nav className="flex items-center gap-4">
              <Link
                href="/admin/quotes"
                className="rounded-warm-lg px-3 py-1 text-sm text-surface/80 hover:bg-white/10 transition-colors"
              >
                Quotes
              </Link>
              <Link
                href="/admin/tenants"
                className="rounded-warm-lg px-3 py-1 text-sm text-surface/80 hover:bg-white/10 transition-colors"
              >
                Tenants
              </Link>
              <Link
                href="/admin/activity"
                className="rounded-warm-lg px-3 py-1 text-sm text-surface/80 hover:bg-white/10 transition-colors"
              >
                Activity
              </Link>
              <span className="mx-2 text-text-muted">|</span>
              <Link href="/app" className="rounded-warm-lg px-3 py-1 text-sm text-surface/80 hover:bg-white/10 transition-colors">
                Exit Admin
              </Link>
            </nav>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8 animate-fade-in-up">{children}</main>
    </div>
  )
}
