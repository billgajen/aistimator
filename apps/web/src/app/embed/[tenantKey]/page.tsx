'use client'

import { EstimateWidget } from '@/components/embed/EstimateWidget'

/**
 * Embedded widget page, loaded in an iframe on the business's website by
 * public/widget.js (AD-024). The widget itself lives in EstimateWidget so the
 * hosted quote page (/quote/[slug], T-149) renders the same implementation.
 */
export default function EmbedPage({ params }: { params: { tenantKey: string } }) {
  return <EstimateWidget tenantKey={params.tenantKey} />
}
