/** T-149: an unknown or inactive quote link. Plain, no business details. */
export default function QuoteLinkNotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-sm text-center">
        <h1 className="font-display text-xl font-bold text-text-primary">This page isn&apos;t available</h1>
        <p className="mt-2 text-sm text-text-secondary">
          Check the link you were given, or contact the business directly.
        </p>
      </div>
    </main>
  )
}
