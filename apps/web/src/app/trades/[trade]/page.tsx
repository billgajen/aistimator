import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { TRADES, getTrade } from '@/lib/marketing/trades'
import { TradeLanding } from '@/components/marketing/TradeLanding'

// T-144: one static page per launch trade
export function generateStaticParams() {
  return TRADES.filter((t) => t.slug !== 'painting').map((t) => ({ trade: t.slug }))
}

export function generateMetadata({ params }: { params: { trade: string } }): Metadata {
  const trade = getTrade(params.trade)
  return trade ? { title: trade.metaTitle, description: trade.metaDescription } : {}
}

export default function TradePageRoute({ params }: { params: { trade: string } }) {
  // Painting keeps its established URL
  if (params.trade === 'painting') redirect('/painting')
  const trade = getTrade(params.trade)
  if (!trade) notFound()
  return <TradeLanding trade={trade} />
}
