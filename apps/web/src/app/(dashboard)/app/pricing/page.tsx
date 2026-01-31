'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { PageHeader } from '@/components/dashboard/EmptyState'
import Link from 'next/link'

export const dynamic = 'force-dynamic'

/**
 * Pricing Rules Page (Deprecated)
 *
 * Pricing is now configured directly in the Service wizard.
 * This page redirects users to the Services page.
 */
export default function PricingPage() {
  const router = useRouter()

  useEffect(() => {
    // Auto-redirect after 5 seconds
    const timer = setTimeout(() => {
      router.push('/app/services')
    }, 5000)

    return () => clearTimeout(timer)
  }, [router])

  return (
    <div>
      <PageHeader
        title="Pricing Rules"
        description="Pricing configuration has moved"
      />

      <div className="mt-6 rounded-lg border border-blue-200 bg-blue-50 p-6">
        <div className="flex">
          <svg className="h-6 w-6 flex-shrink-0 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <div className="ml-4">
            <h3 className="text-lg font-medium text-blue-900">Pricing is Now in the Service Wizard</h3>
            <div className="mt-2 text-blue-700">
              <p className="mb-4">
                For a better experience, pricing configuration (base fees, line items, add-ons, and adjustments)
                is now part of the service setup wizard. This allows you to:
              </p>
              <ul className="mb-4 list-inside list-disc space-y-1">
                <li>Link pricing directly to customer questions</li>
                <li>Test your pricing with the Quote Simulator</li>
                <li>See validation errors before publishing</li>
                <li>Configure everything in one place</li>
              </ul>
              <p className="text-sm text-blue-600">
                Redirecting to Services in 5 seconds...
              </p>
            </div>
            <div className="mt-4">
              <Link
                href="/app/services"
                className="inline-flex items-center rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
              >
                Go to Services Now
                <svg className="ml-2 h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
