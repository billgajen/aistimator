import type { Metadata } from 'next'

// Force dynamic rendering for auth pages
export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Estimator - Auth',
}

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
