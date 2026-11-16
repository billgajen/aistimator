import type { QuotePhoto, QuoteUnderstanding, UnderstoodItem } from '@qolumns/shared'
import { UNDERSTOOD_COPY, understoodNothing } from '@/lib/quote-understanding'
import { CustomerPhotos } from './CustomerPhotos'

/**
 * T-169: "What Qolumns understood", near the top of the dashboard quote
 * page, before the pricing.
 *
 * It lists only what the AI produced for this quote (lib/quote-understanding.ts
 * builds the lines on the server): what it read from the photos, what it
 * picked up from the customer's words, the question it asked and the answer,
 * and the quote checker's findings as "Worth checking". That last group is
 * on since T-172 (`SHOW_WORTH_CHECKING` in lib/quote-understanding.ts), for
 * checks made with the business's money settings only; the server decides,
 * and this component renders whatever findings it is sent. The checker changes
 * nothing on a quote (AD-049) and no line here carries a price of the AI's (AD-001).
 *
 * The customer's photos sit at the top. When the AI produced nothing, there
 * is no panel: the photos, if any, show on their own, and with neither
 * nothing is rendered.
 */
export function UnderstoodPanel({
  understanding,
  photos,
  customerName,
}: {
  understanding: QuoteUnderstanding | undefined
  photos: QuotePhoto[]
  customerName: string
}) {
  const nothing = !understanding || understoodNothing(understanding)
  if (nothing && photos.length === 0) return null

  if (nothing) {
    return (
      <section className="mb-6 rounded-2xl bg-mist p-5" data-testid="photos-only">
        <CustomerPhotos photos={photos} customerName={customerName} />
      </section>
    )
  }

  const u = understanding
  const C = UNDERSTOOD_COPY
  return (
    <section className="mb-6 rounded-2xl bg-mist p-5" aria-labelledby="understood-title" data-testid="understood-panel">
      <h2 id="understood-title" className="font-display text-lg font-bold text-text-primary">
        {C.title}
      </h2>
      <p className="mt-1 text-sm text-text-secondary">{C.intro}</p>

      {photos.length > 0 && (
        <div className="mt-4">
          <CustomerPhotos photos={photos} customerName={customerName} />
        </div>
      )}

      <div className="mt-4 space-y-4">
        <Group title={C.photosTitle} items={u.photos} testid="understood-photos" />
        <Group title={C.wordsTitle} items={u.words} testid="understood-words" />
        <Group title={C.alsoNotedTitle} items={u.alsoNoted} testid="understood-also" />

        {u.asked.length > 0 && (
          <div data-testid="understood-asked">
            <GroupTitle>{C.askedTitle}</GroupTitle>
            <ul className="mt-2 space-y-2">
              {u.asked.map((q, i) => (
                <li key={i} className="rounded-lg bg-white px-4 py-3 text-sm">
                  <p className="text-text-primary">{q.question}</p>
                  <p className="mt-1 text-text-secondary" data-testid="understood-answer">
                    {q.answer === null ? (
                      C.noAnswer
                    ) : (
                      <>
                        {C.answered}: <span className="font-semibold text-text-primary">{q.answer}</span>
                      </>
                    )}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        )}

        {u.checks.length > 0 && (
          <div data-testid="understood-checks">
            <GroupTitle>{C.checksTitle}</GroupTitle>
            <p className="mt-1 text-sm text-text-secondary">
              {C.checksNote}
              {u.checksBeforeChange ? ` ${C.checksBeforeChange}` : ''}
            </p>
            <ul className="mt-2 space-y-2">
              {u.checks.map((item, i) => (
                <li key={i} className="flex gap-3 rounded-lg bg-white px-4 py-3 text-sm text-text-primary">
                  {/* a mark that is a shape, not a colour: "look at this" */}
                  <svg className="mt-0.5 h-4 w-4 shrink-0 text-tertiary" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                    <path fillRule="evenodd" d="M10 2a8 8 0 100 16 8 8 0 000-16zm0 4a1 1 0 011 1v3.5a1 1 0 11-2 0V7a1 1 0 011-1zm0 8.25a1.1 1.1 0 100-2.2 1.1 1.1 0 000 2.2z" clipRule="evenodd" />
                  </svg>
                  <span>{item.text}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  )
}

function GroupTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-text-secondary">{children}</h3>
}

function Group({ title, items, testid }: { title: string; items: UnderstoodItem[]; testid: string }) {
  if (items.length === 0) return null
  return (
    <div data-testid={testid}>
      <GroupTitle>{title}</GroupTitle>
      <ul className="mt-2 space-y-2">
        {items.map((item, i) => (
          <li key={i} className="rounded-lg bg-white px-4 py-3 text-sm">
            <p className="text-text-primary">{item.text}</p>
            {item.detail && <p className="mt-1 text-text-secondary">{item.detail}</p>}
          </li>
        ))}
      </ul>
    </div>
  )
}
