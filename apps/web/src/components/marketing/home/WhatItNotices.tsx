import { Picture, QuestionScreen, TakeoffScreen, LedgerScreen, RangeScreen } from '@/components/marketing/screens/ProductScreens'
import { SCREEN_WORDS } from '@/lib/marketing/screen-words'
import type { MarketingExample } from '@/lib/marketing/examples'

/**
 * T-167: "What it notices" — four things the product does with a request,
 * each with the real screen where the result appears (no icon stands in for
 * a screen). Two columns of unequal pieces; nothing moves (Home's one moment
 * is the price sentence, further down).
 *
 * The words come from lib/marketing/home-copy.ts (NOTICES); the figures from
 * the trade templates (lib/marketing/examples.ts): the water heater template's
 * label, the painting template's measured wall area and its trim extra.
 */
export function WhatItNotices({
  examples,
  heater,
  painting,
  range,
  business,
}: {
  examples: ReadonlyArray<{ id: string; title: string; text: string; screen: string }>
  /** the water heater example: the label reading */
  heater: MarketingExample
  /** the painting example: the measured wall area and the extra */
  painting: MarketingExample
  range: { low: number; high: number }
  business: { name: string; primaryColor: string }
}) {
  const color = business.primaryColor
  const screens: Record<string, React.ReactNode> = {
    label: heater.reading ? <QuestionScreen value={heater.reading.value} readFrom={heater.reading.readFrom} primaryColor={color} /> : null,
    walls: painting.measured ? (
      <TakeoffScreen primaryColor={color} rows={[{ ...painting.measured, method: SCREEN_WORDS.estimate.fromPhotos }]} className="bg-white shadow-warm-md" />
    ) : null,
    extra: painting.extra ? (
      <LedgerScreen
        primaryColor={color}
        lines={[...painting.lines, { label: painting.extra.label, amount: painting.extra.amount, added: true }]}
        total={painting.total + painting.extra.amount}
      />
    ) : null,
    range: <RangeScreen businessName={business.name} customerName={heater.customerName} low={range.low} high={range.high} primaryColor={color} />,
  }
  return (
    <ul className="mt-12 grid gap-x-12 gap-y-14 lg:grid-cols-2" data-testid="notices-list">
      {examples.map((example) => (
        <li key={example.id} data-testid="notice" data-notice={example.id}>
          <h3 className="font-display text-xl font-bold text-text-primary sm:text-2xl">{example.title}</h3>
          <p className="mt-2 max-w-md text-text-secondary">{example.text}</p>
          <Picture label={example.screen} className="mt-5 max-w-md">
            {screens[example.id]}
          </Picture>
        </li>
      ))}
    </ul>
  )
}
