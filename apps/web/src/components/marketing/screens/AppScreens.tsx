import { QUOTE_TURN_COPY, certaintySentence, formatMoney, lineDetail, quoteStory, sourceForBusiness, type QuoteStep, type QuoteTurnTone } from '@qolumns/shared'
import { STATUS_TONE } from '@/lib/status-tone'
import { NeedsYouDot } from '@/components/quotes/NeedsYouDot'
import { SCREEN_WORDS } from '@/lib/marketing/screen-words'
import { say } from '@/lib/whatsapp-assistant-rules'

/**
 * T-187: the on-site app's screens, and a WhatsApp chat, for the marketing
 * pages (system.md, Imagery: "real product screens at true size").
 *
 * The app is React Native, so its screens cannot be mounted on a web page.
 * These are the same screens drawn again in HTML: the same order, the app's
 * own words (lib/marketing/screen-words.ts, checked against the app's source
 * by a unit test), and every status, step name, sentence and source note from
 * the shared functions the app itself calls (quoteStory, lineDetail,
 * sourceForBusiness, certaintySentence). As in the app, money and dates are
 * the text face with tabular figures, not the mono face (system.md, Type).
 *
 *   AppPhone        the phone frame they sit in (the site's one device frame)
 *   AppListScreen   the Quotes tab: what needs the business first
 *   AppQuoteScreen  one quote: the price, its lines, Progress, "Approve & send"
 *   RoomScanCard    the room scan card of a new quote
 *   ChatScreen      a customer asking for a price in a WhatsApp chat, and the
 *                   assistant's own reply (lib/whatsapp-assistant-rules.ts).
 *                   Our own bubbles: no look-alike of WhatsApp's design.
 *
 * Each is a picture: wrap it in <Picture>. None fetches anything.
 */

const A = SCREEN_WORDS.app
/** The app's figures: the text face, every digit the same width */
const FIG = 'tabular-nums'

export function AppPhone({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`phone-frame mx-auto shadow-warm-lg ${className}`} data-testid="app-phone">
      <span className="phone-frame-island" aria-hidden="true" />
      <div className="phone-frame-screen flex h-full flex-col bg-background pt-9">{children}</div>
    </div>
  )
}

function Pill({ label, tone }: { label: string; tone: QuoteTurnTone }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_TONE[tone]}`}>
      {tone === 'attention' ? <NeedsYouDot className="mr-1.5" /> : null}
      {label}
    </span>
  )
}

/** The app's tab bar: Quotes, the round "New quote" button, Account */
function TabBar({ current }: { current: 'quotes' | 'new' }) {
  const tab = (label: string, on: boolean) => <span className={`flex-1 pb-1 text-center text-xs ${on ? 'font-semibold text-primary' : 'text-text-muted'}`}>{label}</span>
  return (
    <div className="mt-auto flex items-end border-t border-border bg-white px-2 pb-3 pt-2">
      {tab(A.tabs.quotes, current === 'quotes')}
      <span className="flex flex-1 flex-col items-center gap-1 text-xs text-text-secondary">
        <span className="-mt-6 flex h-12 w-12 items-center justify-center rounded-full bg-primary text-2xl leading-none text-white shadow-warm-md" aria-hidden="true">
          +
        </span>
        {A.tabs.newQuote}
      </span>
      {tab(A.tabs.account, false)}
    </div>
  )
}

export interface AppListRow {
  customer: string
  service: string
  total: number
  /** The quote's status, as the shared wording names it */
  status: 'pending_review' | 'sent' | 'viewed' | 'accepted'
  when: string
}

/** The Quotes tab: "Needs you" first, with its count on the strong yellow, then who is waiting for a customer */
export function AppListScreen({ rows, currency = 'USD', locale = 'en-US' }: { rows: AppListRow[]; currency?: string; locale?: string }) {
  const stories = rows.map((row) => ({ row, turn: quoteStory({ status: row.status, total: row.total, customerName: row.customer, hasEmail: true }).turn }))
  const groups = (['needs_you', 'waiting', 'accepted'] as const)
    .map((key) => ({ key, title: QUOTE_TURN_COPY.tabs[key], items: stories.filter((s) => s.turn.group === key) }))
    .filter((g) => g.items.length > 0)
  const needsYou = groups.find((g) => g.key === 'needs_you')?.items.length ?? 0
  return (
    <>
      <div className="px-4 pb-3">
        <p className="font-display text-2xl font-extrabold text-text-primary">{A.listTitle}</p>
        <p className="text-sm text-text-secondary">{needsYou === 1 ? '1 needs you' : `${needsYou} need you`}</p>
        <p className="mt-3 flex min-h-[44px] items-center rounded-lg border border-field bg-white px-3 text-sm text-text-muted">{A.search}</p>
      </div>
      <div className="flex-1 space-y-4 px-4 pb-4">
        {groups.map((group) => (
          <div key={group.key}>
            <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-text-secondary">
              {group.title}
              {group.key === 'needs_you' ? (
                <span className={`inline-flex items-center rounded-full bg-accent px-2 py-0.5 text-on-accent ${FIG}`}>
                  <NeedsYouDot className="mr-1" />
                  {group.items.length}
                </span>
              ) : (
                <span className={`text-text-muted ${FIG}`}>{group.items.length}</span>
              )}
            </p>
            <ul className="mt-2 space-y-2">
              {group.items.map(({ row, turn }) => (
                <li key={row.customer} className="rounded-xl border border-border bg-white p-3">
                  <div className="flex items-start justify-between gap-3">
                    <p className="min-w-0 text-sm font-semibold text-text-primary">{row.customer}</p>
                    <p className={`shrink-0 text-sm font-semibold text-text-primary ${FIG}`}>{formatMoney(row.total, currency, locale)}</p>
                  </div>
                  <p className="text-xs text-text-secondary">{row.service}</p>
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <Pill label={turn.label} tone={turn.tone} />
                    <span className={`text-xs text-text-muted ${FIG}`}>{row.when}</span>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <TabBar current="quotes" />
    </>
  )
}

/** One quote the business made on site, waiting for its approval */
export function AppQuoteScreen({
  customer,
  service,
  lines,
  total,
  receivedOn,
  currency = 'USD',
  locale = 'en-US',
}: {
  customer: string
  service: string
  /** A line priced by quantity carries its rate, quantity and the business's unit; a fixed one only its amount */
  lines: Array<{ name: string; amount: number; rate?: number; quantity?: number; unit?: string }>
  total: number
  /** "19 Nov": when the request was made, as the Progress card shows it */
  receivedOn: string
  currency?: string
  locale?: string
}) {
  const money = (n: number) => formatMoney(n, currency, locale)
  // the same story the app draws: the status, its sentence, Progress and the main button together
  const story = quoteStory({ status: 'pending_review', total, customerName: customer, hasEmail: false, madeByBusiness: true })
  const own = { madeByBusiness: true }
  return (
    <>
      <div className="flex-1 space-y-3 px-3 pb-3">
        <div className="rounded-xl border border-border bg-white p-4">
          <p className="font-display text-xl font-extrabold leading-tight text-text-primary">{customer}</p>
          <p className="text-sm text-text-secondary">{service}</p>
          <div className="mt-3">
            <Pill label={story.turn.label} tone={story.turn.tone} />
          </div>
          <p className={`mt-2 text-3xl font-bold text-text-primary ${FIG}`}>{money(total)}</p>
          <p className="mt-1 text-xs text-text-muted">{certaintySentence({ grade: 'A', reasons: [] })}</p>
        </div>

        <div className="rounded-xl border border-border bg-white p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-text-secondary">{A.priceTitle}</p>
          <ul className="mt-2 space-y-2">
            {lines.map((line) => {
              const detail = line.rate !== undefined && line.quantity !== undefined ? lineDetail(formatMoney(line.rate, currency, locale, { decimals: 0 }), line.quantity, line.unit) : null
              const source = sourceForBusiness({ source: detail ? 'answer' : 'fixed' }, own)
              return (
                <li key={line.name} className="flex items-start justify-between gap-3">
                  <span className="min-w-0">
                    <span className="block text-sm text-text-primary">{line.name}</span>
                    {/* the app's own note: the detail, a dot, where the quantity came from; each part stays whole */}
                    <span className={`block text-xs text-text-muted ${FIG}`}>
                      {detail ? <span className="whitespace-nowrap">{detail}</span> : null}
                      {detail && source ? ' · ' : null}
                      {source ? <span className="whitespace-nowrap">{source}</span> : null}
                    </span>
                  </span>
                  <span className={`shrink-0 text-sm text-text-primary ${FIG}`}>{money(line.amount)}</span>
                </li>
              )
            })}
          </ul>
        </div>

        <div className="rounded-xl border border-border bg-white p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-text-secondary">{QUOTE_TURN_COPY.tracker.title}</p>
          <ol className="mt-2 space-y-1.5">
            {story.steps.map((step, i) => (
              <Step key={step.key} step={step} date={i === 0 ? receivedOn : null} />
            ))}
          </ol>
        </div>
      </div>
      <div className="border-t border-border bg-white px-3 pb-4 pt-3">
        <div className="flex min-h-[48px] items-center justify-center rounded-lg bg-primary text-sm font-semibold text-white">{QUOTE_TURN_COPY.pageButtons.approve}</div>
      </div>
    </>
  )
}

function Step({ step, date }: { step: QuoteStep; date: string | null }) {
  const done = step.state === 'done'
  const current = step.state === 'current'
  return (
    <li className={`flex items-center gap-2.5 rounded-md px-1.5 py-1 ${current ? 'bg-mint' : ''}`}>
      <span
        aria-hidden="true"
        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs ${done ? 'bg-secondary text-white' : current ? 'border-2 border-primary bg-white' : 'border border-border-strong bg-white'}`}
      >
        {done ? '✓' : current ? <span className="h-2 w-2 rounded-full bg-primary" /> : null}
      </span>
      <span className={`flex-1 text-sm ${current ? 'font-bold text-text-primary' : done ? 'font-semibold text-text-primary' : 'text-text-muted'}`}>
        {step.name}
        {current && step.note ? <span className="ml-2 text-xs font-normal text-text-secondary">{step.note}</span> : null}
      </span>
      {date ? <span className={`text-xs text-text-secondary ${FIG}`}>{date}</span> : null}
    </li>
  )
}

/** The room scan card a new quote shows for a service whose sizes a scan can fill */
export function RoomScanCard({ className = '' }: { className?: string }) {
  return (
    <div className={`rounded-2xl border border-border bg-white p-5 text-left shadow-warm-md ${className}`} data-testid="room-scan-card">
      <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-text-secondary">
        {/* the scan mark: four corners of a frame */}
        <svg className="h-5 w-5 text-primary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M4 8V5a1 1 0 011-1h3M16 4h3a1 1 0 011 1v3M20 16v3a1 1 0 01-1 1h-3M8 20H5a1 1 0 01-1-1v-3M8 12h8" />
        </svg>
        {A.scanTitle}
      </p>
      <p className="mt-2 text-sm text-text-secondary">{A.scanLead}</p>
      <div className="mt-4 flex min-h-[48px] items-center justify-center rounded-lg border border-field bg-background text-sm font-semibold text-text-primary">{A.scanButton}</div>
    </div>
  )
}

/**
 * A customer asking for a price in the business's WhatsApp chat, and what the
 * assistant answers: its own first reply when the message already says what
 * the job is (`say.openingWithLink`), word for word.
 */
export function ChatScreen({ businessName, serviceName, customerName, message, link }: { businessName: string; serviceName: string; customerName: string; message: string; link: string }) {
  const reply = say.openingWithLink({ businessName, serviceName, customerName, postalCodeNoun: '', minPhotos: 0 }, link)
  return (
    <>
      <div className="border-b border-border bg-white px-4 pb-3">
        <p className="font-display text-base font-bold leading-tight text-text-primary">{businessName}</p>
      </div>
      <div className="flex flex-1 flex-col gap-3 bg-surface px-3 py-4 text-sm" data-testid="chat-bubbles">
        <p className="ml-8 self-end rounded-2xl rounded-br-xs bg-mint px-3.5 py-2.5 text-text-primary" data-testid="chat-customer">
          {message}
        </p>
        <p className="mr-8 self-start break-words rounded-2xl rounded-bl-xs bg-white px-3.5 py-2.5 text-text-primary shadow-warm" data-testid="chat-reply">
          {reply}
        </p>
      </div>
    </>
  )
}
