import type { Metadata } from 'next'
import { Bricolage_Grotesque, Instrument_Sans, Spline_Sans_Mono } from 'next/font/google'
import './globals.css'
import { PRODUCT_NAME } from '@estimator/shared'

const bricolage = Bricolage_Grotesque({
  subsets: ['latin'],
  variable: '--font-bricolage',
  display: 'swap',
})

const instrument = Instrument_Sans({
  subsets: ['latin'],
  variable: '--font-instrument',
  display: 'swap',
})

const splineMono = Spline_Sans_Mono({
  subsets: ['latin'],
  variable: '--font-spline-mono',
  display: 'swap',
})

export const metadata: Metadata = {
  title: PRODUCT_NAME,
  description: 'Instant, evidence-backed estimates for service businesses',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${bricolage.variable} ${instrument.variable} ${splineMono.variable}`}>
      <body className="font-body antialiased">{children}</body>
    </html>
  )
}
