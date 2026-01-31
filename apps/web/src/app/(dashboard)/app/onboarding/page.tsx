import { PageHeader } from '@/components/dashboard/EmptyState'
import Link from 'next/link'

export const dynamic = 'force-dynamic'

/**
 * Onboarding / Setup Checklist Page
 *
 * Guides new users through the setup process.
 */
export default function OnboardingPage() {
  // TODO: Fetch actual completion status from database
  const steps = [
    {
      id: 'services',
      title: 'Add your first service',
      description: 'Define the services you offer to customers',
      href: '/app/services',
      completed: false,
    },
    {
      id: 'pricing',
      title: 'Configure pricing rules',
      description: 'Set up base fees, add-ons, and multipliers',
      href: '/app/pricing',
      completed: false,
    },
    {
      id: 'widget',
      title: 'Set up your widget',
      description: 'Configure the quote request form fields',
      href: '/app/widget',
      completed: false,
    },
    {
      id: 'branding',
      title: 'Customize branding',
      description: 'Add your logo and choose colors',
      href: '/app/branding',
      completed: false,
    },
    {
      id: 'embed',
      title: 'Embed on your website',
      description: 'Copy the embed code to your website',
      href: '/app/widget',
      completed: false,
    },
  ]

  const completedCount = steps.filter((s) => s.completed).length
  const progress = Math.round((completedCount / steps.length) * 100)

  return (
    <div>
      <PageHeader
        title="Setup Checklist"
        description="Complete these steps to start receiving quotes"
      />

      {/* Progress bar */}
      <div className="mb-8 rounded-lg bg-white p-6 shadow-sm">
        <div className="flex items-center justify-between text-sm">
          <span className="font-medium text-gray-700">Setup Progress</span>
          <span className="text-gray-500">{completedCount} of {steps.length} complete</span>
        </div>
        <div className="mt-3 h-2 w-full rounded-full bg-gray-200">
          <div
            className="h-2 rounded-full bg-blue-600 transition-all"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {/* Steps list */}
      <div className="space-y-4">
        {steps.map((step, index) => (
          <Link
            key={step.id}
            href={step.href}
            className="flex items-center gap-4 rounded-lg bg-white p-4 shadow-sm transition-shadow hover:shadow-md"
          >
            {/* Step number/check */}
            <div
              className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full ${
                step.completed
                  ? 'bg-green-100 text-green-600'
                  : 'bg-gray-100 text-gray-500'
              }`}
            >
              {step.completed ? (
                <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 20 20">
                  <path
                    fillRule="evenodd"
                    d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                    clipRule="evenodd"
                  />
                </svg>
              ) : (
                <span className="text-sm font-medium">{index + 1}</span>
              )}
            </div>

            {/* Content */}
            <div className="flex-1">
              <h3 className="font-medium text-gray-900">{step.title}</h3>
              <p className="text-sm text-gray-500">{step.description}</p>
            </div>

            {/* Arrow */}
            <svg
              className="h-5 w-5 text-gray-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 5l7 7-7 7"
              />
            </svg>
          </Link>
        ))}
      </div>

      {/* Test mode notice */}
      <div className="mt-8 rounded-lg border border-blue-200 bg-blue-50 p-4">
        <div className="flex items-start gap-3">
          <svg
            className="h-5 w-5 text-blue-600"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          <div>
            <h4 className="font-medium text-blue-800">Test Mode Active</h4>
            <p className="mt-1 text-sm text-blue-700">
              Your widget is in test mode. Quotes will be marked as test and won&apos;t count toward your limit.
              You can switch to live mode in Settings once you&apos;re ready.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
