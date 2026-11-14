import type { Metadata } from 'next'
import { PRODUCT_NAME } from '@qolumns/shared'
import { marketingExample } from '@/lib/marketing/examples'
import { HERO } from '@/lib/marketing/home-copy'
import { ProductStrip } from '@/components/marketing/ProductStrip'
import { DesignPreview } from '@/components/design/DesignPreview'

/**
 * T-164: the design system as it renders, from the real tokens and the real
 * components (Docs/design/system.md decides; this page shows). Not linked
 * from anywhere and not indexed: it is for the owner to choose the accent
 * and the wordmark, and for a ticket to check a component against.
 */
export const metadata: Metadata = {
  title: `Design preview — ${PRODUCT_NAME}`,
  robots: { index: false, follow: false, nocache: true },
}

export default function DesignPage() {
  // The product screen is a server component: rendered here, shown inside the band
  return <DesignPreview productScreen={<ProductStrip example={marketingExample()} captions={HERO.frames} />} />
}
