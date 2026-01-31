import Link from 'next/link'

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-100">
      {/* Admin Header */}
      <header className="bg-red-600 text-white">
        <div className="mx-auto max-w-7xl px-4 py-3 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Link href="/admin" className="text-lg font-bold">
                Admin Panel
              </Link>
              <span className="rounded bg-red-800 px-2 py-1 text-xs">Support Tools</span>
            </div>
            <nav className="flex items-center gap-4">
              <Link
                href="/admin/quotes"
                className="rounded px-3 py-1 text-sm hover:bg-red-700"
              >
                Quotes
              </Link>
              <Link
                href="/admin/tenants"
                className="rounded px-3 py-1 text-sm hover:bg-red-700"
              >
                Tenants
              </Link>
              <Link
                href="/admin/activity"
                className="rounded px-3 py-1 text-sm hover:bg-red-700"
              >
                Activity
              </Link>
              <span className="mx-2 text-red-300">|</span>
              <Link href="/app" className="rounded px-3 py-1 text-sm hover:bg-red-700">
                Exit Admin
              </Link>
            </nav>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">{children}</main>
    </div>
  )
}
