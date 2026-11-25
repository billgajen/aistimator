'use client'

import { useEffect, useState } from 'react'
import { TRY_IT_COPY, limitLine } from '@/lib/try-it-copy'

/**
 * T-202: "You have made 5 test estimates in the last 24 hours. You can make
 * another after 3:40 pm tomorrow." The time is written in the reader's own
 * time zone, so it is filled in once the page is in the browser (the server
 * does not know the zone); until then the line stands without a time.
 */
export function LimitLine({ availableAt, className }: { availableAt: string | null; className?: string }) {
  const [line, setLine] = useState<string>(TRY_IT_COPY.limitPlain)
  useEffect(() => setLine(limitLine(availableAt)), [availableAt])
  return (
    <p className={className} role="status" data-testid="try-it-limit" data-available-at={availableAt ?? ''}>
      {line}
    </p>
  )
}
