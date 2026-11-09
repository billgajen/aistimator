import type { Metadata } from 'next'
import { getTrade } from '@/lib/marketing/trades'
import { TradeLanding } from '@/components/marketing/TradeLanding'

// T-144: the painting page now uses the US trade template (AD-025: US first)
const trade = getTrade('painting')!

export const metadata: Metadata = { title: trade.metaTitle, description: trade.metaDescription }

export default function PaintingLandingPage() {
  return <TradeLanding trade={trade} />
}
