import { Picture, QuestionScreen, TakeoffScreen, LedgerScreen, RangeScreen, UnderstoodScreen } from '@/components/marketing/screens/ProductScreens'
import type { MarketingExample } from '@/lib/marketing/examples'
import type { NOTICES } from '@/lib/marketing/home-copy'

type Notice = (typeof NOTICES.examples)[number]

/**
 * T-167: "What it notices": what the product does with a request, each with
 * the screen where the result appears (no icon stands in for a screen).
 * Nothing moves (Home's one moment is the price sentence, further down).
 *
 * T-173, the owner's order: what the customer wrote (a message beside what was
 * made of it, the full width), what the photos show (its two examples side by
 * side), then an extra they mention and the question, side by side.
 *
 * The words come from lib/marketing/home-copy.ts (NOTICES); the figures and
 * names from the trade templates (lib/marketing/examples.ts): the painting
 * template's service, its trim extra and its measured wall area, and the
 * water heater template's label.
 */
export function WhatItNotices({
  examples,
  heater,
  painting,
  range,
  business,
}: {
  examples: ReadonlyArray<Notice>
  /** the water heater example: the label reading */
  heater: MarketingExample
  /** the painting example: the service, the extra and the measured wall area */
  painting: MarketingExample
  range: { low: number; high: number }
  business: { name: string; primaryColor: string }
}) {
  const color = business.primaryColor
  const screens: Record<string, React.ReactNode> = {
    label: heater.reading ? <QuestionScreen value={heater.reading.value} readFrom={heater.reading.readFrom} primaryColor={color} /> : null,
    walls: painting.measured ? (
      <TakeoffScreen primaryColor={color} rows={[painting.measured]} className="bg-white shadow-warm-md" />
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
  const heading = 'font-display text-xl font-bold text-text-primary sm:text-2xl'
  return (
    <ul className="mt-12 grid gap-x-12 gap-y-14 lg:grid-cols-2" data-testid="notices-list">
      {examples.map((example) => {
        if (example.id === 'words') {
          const u = example.understood
          return (
            <li key={example.id} className="lg:col-span-2" data-testid="notice" data-notice={example.id}>
              <h3 className={heading}>{example.title}</h3>
              <p className="mt-2 max-w-2xl text-text-secondary">{example.text}</p>
              {painting.extra && (
                <Picture label={example.screen} className="mt-5 max-w-3xl">
                  <UnderstoodScreen
                    primaryColor={color}
                    wroteTitle={example.wroteTitle}
                    message={example.message}
                    understoodTitle={example.understoodTitle}
                    rows={[
                      { id: 'service', label: u.service.label, value: painting.extra.service, text: u.service.text },
                      { id: 'size', label: u.size.label, value: u.size.value, text: u.size.text },
                      { id: 'extra', label: u.extra.label, value: painting.extra.label, text: u.extra.text },
                    ]}
                  />
                </Picture>
              )}
            </li>
          )
        }
        if (example.id === 'photos') {
          return (
            <li key={example.id} className="lg:col-span-2" data-testid="notice" data-notice={example.id}>
              <h3 className={heading}>{example.title}</h3>
              <p className="mt-2 max-w-2xl text-text-secondary">{example.text}</p>
              <ul className="mt-8 grid gap-x-12 gap-y-10 lg:grid-cols-2" data-testid="notice-parts">
                {example.parts.map((part) => (
                  <li key={part.id} data-testid="notice-part" data-notice-part={part.id}>
                    <h4 className="font-display text-lg font-bold text-text-primary">{part.title}</h4>
                    <p className="mt-2 max-w-md text-text-secondary">{part.text}</p>
                    {'note' in part && (
                      <p className="mt-2 max-w-md text-sm text-text-secondary" data-testid="notice-note">
                        {part.note}
                      </p>
                    )}
                    <Picture label={part.screen} className="mt-5 max-w-md">
                      {screens[part.id]}
                    </Picture>
                  </li>
                ))}
              </ul>
            </li>
          )
        }
        return (
          <li key={example.id} data-testid="notice" data-notice={example.id}>
            <h3 className={heading}>{example.title}</h3>
            <p className="mt-2 max-w-md text-text-secondary">{example.text}</p>
            <Picture label={example.screen} className="mt-5 max-w-md">
              {screens[example.id]}
            </Picture>
          </li>
        )
      })}
    </ul>
  )
}
