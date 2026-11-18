'use client'

import { useEffect } from 'react'

export default function QuoteError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    // Log the error to console for debugging
    console.error('Quote page error:', error)
  }, [error])

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="text-center max-w-md px-4">
        <div className="text-danger text-5xl mb-4">⚠️</div>
        <h1 className="text-xl font-semibold text-text-primary mb-2">
          Unable to load quote
        </h1>
        <p className="text-text-secondary mb-6">
          Something went wrong while loading your quote. Please try again.
        </p>
        <button
          onClick={() => reset()}
          className="inline-flex items-center px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary-hover transition-colors"
        >
          Try again
        </button>
      </div>
    </div>
  )
}
