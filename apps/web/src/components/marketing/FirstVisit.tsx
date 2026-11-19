'use client'

import { useEffect } from 'react'
import { rememberFirstVisit } from '@/lib/signup-source'

/**
 * T-189: notes this tab's first visit (campaign tags, the site it came from,
 * the first page), once, in the tab's own storage. No cookie, nothing sent
 * anywhere: the sign-up form sends it if the person signs up. Renders nothing.
 */
export function FirstVisit() {
  useEffect(() => {
    rememberFirstVisit()
  }, [])
  return null
}
