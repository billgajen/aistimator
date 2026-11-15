'use client'

import { usePathname } from 'next/navigation'

/**
 * T-165: what sits beside the sign-in form at desktop width: a real estimate
 * document, so the page shows what you are signing in to. Only on /login
 * (sign-up keeps its single column) and only from `lg` up; on a phone the
 * form is the whole page.
 */
export function LoginAside({ children }: { children: React.ReactNode }) {
  if (usePathname() !== '/login') return null
  return (
    <div className="hidden w-full max-w-sm shrink-0 lg:block" role="img" aria-label="An example of the estimate a customer receives: the business’s name, the total, and each line of the price." data-testid="login-document">
      {children}
    </div>
  )
}
