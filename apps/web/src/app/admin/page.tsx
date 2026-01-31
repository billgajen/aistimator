import Link from 'next/link'

export default function AdminDashboard() {
  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900">Admin Dashboard</h1>
      <p className="mt-2 text-gray-600">
        Support tools for managing quotes and tenants across the platform.
      </p>

      <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {/* Quotes Card */}
        <Link
          href="/admin/quotes"
          className="block rounded-lg bg-white p-6 shadow-sm transition-shadow hover:shadow-md"
        >
          <div className="flex items-center gap-4">
            <div className="rounded-lg bg-blue-100 p-3">
              <svg
                className="h-6 w-6 text-blue-600"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                />
              </svg>
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Quotes</h2>
              <p className="text-sm text-gray-500">Search and manage quotes</p>
            </div>
          </div>
          <p className="mt-4 text-sm text-gray-600">
            Search quotes by ID or customer email. View details, retry failed jobs.
          </p>
        </Link>

        {/* Tenants Card */}
        <Link
          href="/admin/tenants"
          className="block rounded-lg bg-white p-6 shadow-sm transition-shadow hover:shadow-md"
        >
          <div className="flex items-center gap-4">
            <div className="rounded-lg bg-green-100 p-3">
              <svg
                className="h-6 w-6 text-green-600"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"
                />
              </svg>
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Tenants</h2>
              <p className="text-sm text-gray-500">View tenant details</p>
            </div>
          </div>
          <p className="mt-4 text-sm text-gray-600">
            Search tenants by name or ID. View subscription status, usage, and services.
          </p>
        </Link>

        {/* Activity Card */}
        <Link
          href="/admin/activity"
          className="block rounded-lg bg-white p-6 shadow-sm transition-shadow hover:shadow-md"
        >
          <div className="flex items-center gap-4">
            <div className="rounded-lg bg-purple-100 p-3">
              <svg
                className="h-6 w-6 text-purple-600"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Activity Log</h2>
              <p className="text-sm text-gray-500">Audit trail</p>
            </div>
          </div>
          <p className="mt-4 text-sm text-gray-600">
            View admin actions and system events for debugging and auditing.
          </p>
        </Link>
      </div>

      {/* Quick Actions */}
      <div className="mt-8 rounded-lg bg-yellow-50 p-4">
        <h3 className="font-medium text-yellow-800">Support Tips</h3>
        <ul className="mt-2 space-y-1 text-sm text-yellow-700">
          <li>Search quotes by ID (e.g., qte_xxx) or customer email</li>
          <li>Failed quotes can be retried from the quote detail page</li>
          <li>All admin actions are logged for audit purposes</li>
        </ul>
      </div>
    </div>
  )
}
