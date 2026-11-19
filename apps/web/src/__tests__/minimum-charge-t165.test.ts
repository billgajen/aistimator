/**
 * T-165: the minimum charge is a floor, not an item (web).
 *
 * The shared rule (packages/shared/src/minimum-charge.ts), every renderer
 * (customer quote page, PDF, dashboard quote page, pricing trace, demo,
 * setup's test quote), the quote editor and its save rule.
 *
 * Three quotes are used throughout, for a made-up business:
 *   below  — one room, $375, minimum $400: lines + a marked $25 entry = $400
 *   above  — two rooms and heavy prep, $1,000, minimum $400: no entry
 *   stored — the same as `below` as it was stored before this change: the
 *            top-up is an ordinary line "Minimum charge applied", and the
 *            sentence is repeated among the notes
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  MINIMUM_ENTRY_LABEL,
  crossServiceLine,
  editedBreakdown,
  isMinimumEntry,
  isMinimumNote,
  minimumChargeNote,
  minimumEntry,
  minimumTopUp,
  splitMinimum,
  withoutMinimumNote,
} from '@qolumns/shared'
import type { QuoteContent, QuotePricing, QuoteViewResponse, TenantBranding, TenantTemplate } from '@qolumns/shared'
import { generateQuotePdfHtml } from '@/lib/pdf-template'
import { MinimumNote } from '@/components/quote/MinimumNote'
import { toDemoEstimate } from '@/components/demo/DemoExperience'
import QuoteEditor from '@/components/quote-editor/QuoteEditor'
import { EXAMPLE_TRADES, marketingExample } from '@/lib/marketing/examples'

const SRC = join(__dirname, '..')
const code = (rel: string) => readFileSync(join(SRC, rel), 'utf8')
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/\s+/g, ' ')

const pricing = (breakdown: QuotePricing['breakdown'], notes?: string[]): QuotePricing => {
  const subtotal = Math.round(breakdown.reduce((sum, item) => sum + item.amount, 0) * 100) / 100
  return { currency: 'USD', subtotal, taxAmount: 0, total: subtotal, breakdown, ...(notes ? { notes } : {}) }
}
const ROOM = { label: 'Rooms  $375 x 1(Room)', amount: 375 }
const below = pricing([ROOM, { label: MINIMUM_ENTRY_LABEL, amount: 25, kind: 'minimum', minimumCharge: 400 }])
const above = pricing([{ label: 'Rooms  $375 x 2(Room)', amount: 750 }, { label: 'Heavy prep', amount: 250 }])
const equal = pricing([{ label: 'Rooms  $200 x 2(Room)', amount: 400 }])
const stored = pricing([ROOM, { label: 'Minimum charge applied', amount: 25 }], ['Minimum charge of $400.00 applied', 'Paint is included.'])

describe('T-165: the shared rule', () => {
  it('the top-up: the difference below the minimum, nothing at it or above it', () => {
    expect(minimumTopUp(375, 400)).toBe(25)
    expect(minimumTopUp(399.99, 400)).toBe(0.01)
    expect(minimumTopUp(400, 400)).toBe(0)
    expect(minimumTopUp(400.01, 400)).toBe(0)
    expect(minimumTopUp(1000, 400)).toBe(0)
    // no minimum set
    expect(minimumTopUp(0, 0)).toBe(0)
    expect(minimumTopUp(10, 0)).toBe(0)
    // floats: 622.8 + 127.7 is the minimum, not a hair under it
    expect(minimumTopUp(18 * 34.6, 750.5)).toBe(127.7)
    expect(minimumTopUp(0.1 + 0.2, 0.3)).toBe(0)
  })

  it('the entry is marked and carries the minimum it tops up to', () => {
    expect(minimumEntry(25, 400)).toEqual({ label: 'Minimum charge applied', amount: 25, kind: 'minimum', minimumCharge: 400 })
    expect(isMinimumEntry(minimumEntry(25, 400))).toBe(true)
    expect(isMinimumEntry(ROOM)).toBe(false)
    expect(isMinimumEntry(null)).toBe(false)
  })

  it('a quote below the minimum reads as its real lines and the minimum that applied', () => {
    expect(splitMinimum(below.breakdown)).toEqual({ lines: [ROOM], minimum: { topUp: 25, minimumCharge: 400 } })
  })

  it('a quote at or above the minimum reads as its lines and no minimum', () => {
    expect(splitMinimum(equal.breakdown)).toEqual({ lines: equal.breakdown, minimum: null })
    expect(splitMinimum(above.breakdown)).toEqual({ lines: above.breakdown, minimum: null })
    expect(splitMinimum([])).toEqual({ lines: [], minimum: null })
    expect(splitMinimum(null)).toEqual({ lines: [], minimum: null })
    // an entry that adds nothing is not a minimum that applied
    expect(splitMinimum([ROOM, minimumEntry(0, 375)]).minimum).toBeNull()
  })

  it('quotes stored before the marker read the same way, with no data migration', () => {
    // the top-up as an ordinary line: the minimum is what the lines and the top-up add up to
    expect(splitMinimum(stored.breakdown)).toEqual({ lines: [ROOM], minimum: { topUp: 25, minimumCharge: 400 } })
    // the older shape: one line "Minimum charge" in place of every line
    expect(splitMinimum([{ label: 'Minimum charge', amount: 400 }])).toEqual({ lines: [], minimum: { topUp: 400, minimumCharge: 400 } })
    // a line the business named something else is a line
    expect(splitMinimum([{ label: 'Minimum charge for call-out', amount: 80 }]).minimum).toBeNull()
  })

  it('the sentence, and the stored copies of it that are no longer shown twice', () => {
    expect(minimumChargeNote('$400.00')).toBe('Minimum charge of $400.00 applied')
    expect(minimumChargeNote('£120.00')).toBe('Minimum charge of £120.00 applied')
    expect(isMinimumNote('Minimum charge of $400.00 applied')).toBe(true)
    expect(isMinimumNote('Paint is included.')).toBe(false)
    expect(withoutMinimumNote(stored.notes)).toEqual(['Paint is included.'])
    expect(withoutMinimumNote(undefined)).toEqual([])
    // a stored cross-service line that replaced every line reads as the same note
    expect(crossServiceLine('Minimum charge: $400.00')).toBe('Minimum charge of $400.00 applied')
    expect(crossServiceLine('10 windows × $20.00')).toBe('10 windows × $20.00')
  })

  it('the sentence is written in one place', () => {
    const offenders: string[] = []
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name)
        if (statSync(full).isDirectory()) {
          if (name !== '__tests__' && name !== 'node_modules') walk(full)
        } else if (/\.(ts|tsx)$/.test(name) && /Minimum charge of|minimum charge applied/i.test(readFileSync(full, 'utf8').replace(/^\s*(\/\/|\*|\/\*).*$/gm, ''))) {
          offenders.push(full.replace(join(SRC, '..', '..', '..'), ''))
        }
      }
    }
    walk(SRC)
    walk(join(SRC, '../../worker/src'))
    walk(join(SRC, '../../../packages/shared/src'))
    expect(offenders).toEqual(['/packages/shared/src/minimum-charge.ts'])
  })
})

describe('T-165: the note every page shows', () => {
  const note = (minimumCharge: number | null | undefined, currency = 'USD', locale?: string) =>
    renderToStaticMarkup(createElement(MinimumNote, { minimumCharge, currency, locale }))

  it('says the minimum charge, in the quote’s own currency', () => {
    expect(text(note(400))).toContain('Minimum charge of $400.00 applied')
    expect(note(400)).toContain('data-testid="minimum-note"')
    expect(text(note(120, 'GBP', 'en-GB'))).toContain('Minimum charge of £120.00 applied')
  })

  it('renders nothing when no minimum applied', () => {
    expect(note(null)).toBe('')
    expect(note(undefined)).toBe('')
    expect(note(0)).toBe('')
  })

  it('the customer quote page: real lines, the note above the total, no minimum row, no second copy among the notes or the takeoff', () => {
    const page = code('app/q/[quoteId]/page.tsx')
    expect(page).toContain('splitMinimum(pricing.breakdown)')
    expect(page).not.toMatch(/pricing\.breakdown(\s*\|\|\s*\[\])?\)?\.map\(/)
    expect(page).not.toMatch(/pricing\.notes(\?)?\.map\(/)
    expect(page).toContain('withoutMinimumNote(pricing.notes)')
    // T-171: the takeoff's rows are no longer drawn on this page (only what was read or measured, as
    // sentences from the server), so there is no row a minimum could appear in
    expect(page).not.toMatch(/takeoffRows|entry\.item/)
    expect(page).toContain('const readLines = quote.read ?? []')
    expect(page).toContain('crossServiceLine(line)')
    // the note sits at the top of the totals block, before Subtotal
    const noteAt = page.indexOf('<MinimumNote minimumCharge={minimumApplied?.minimumCharge}')
    expect(noteAt).toBeGreaterThan(page.indexOf('priceLines.map('))
    expect(page.indexOf('Subtotal', noteAt)).toBeGreaterThan(noteAt)
    expect(page.slice(noteAt, page.indexOf('Subtotal', noteAt)).length).toBeLessThan(400)
  })

  it('the dashboard quote page: real lines, then the note above the subtotal', () => {
    const page = code('app/(dashboard)/app/quotes/[quoteId]/page.tsx')
    expect(page).toContain('splitMinimum(pricing.breakdown)')
    expect(page).not.toContain('pricing.breakdown.map(')
    const noteAt = page.indexOf('<MinimumNote minimumCharge={minimumApplied?.minimumCharge}')
    expect(noteAt).toBeGreaterThan(page.indexOf('priceLines.map('))
    expect(page.indexOf('Subtotal', noteAt) - noteAt).toBeLessThan(300)
  })

  it('the pricing trace: the step and the summary show the same sentence', () => {
    const page = code('app/(dashboard)/app/quotes/[quoteId]/trace/page.tsx')
    expect(page).toContain("step.type === 'minimum' ? minimumChargeNote(formatCurrency(step.runningTotal)) : step.description")
    expect(page).toContain("trace?.trace.find((step) => step.type === 'minimum' && step.amount > 0)")
    expect(page).not.toContain("return 'Minimum Charge'")
  })

  it('setup’s test quote: the route sends the lines and the minimum apart; the step shows the note', () => {
    const route = code('app/api/onboarding/test-quote/route.ts')
    expect(route).toContain('splitMinimum(')
    expect(route).toContain('minimumCharge: minimum?.minimumCharge ?? null')
    expect(code('components/onboarding/TestQuoteStep.tsx')).toContain('<MinimumNote')
  })

  it('the demo estimate: real lines and the minimum apart', () => {
    const view = (p: QuotePricing) => ({ business: { name: 'Fernhill Painting' }, pricing: p, status: 'sent', locale: 'en-US' }) as unknown as QuoteViewResponse
    const belowEstimate = toDemoEstimate(view(below), null, 'Interior painting')
    expect(belowEstimate.lines).toEqual([ROOM])
    expect(belowEstimate.minimumCharge).toBe(400)
    expect(belowEstimate.total).toBe(400)
    const aboveEstimate = toDemoEstimate(view(above), null, 'Interior painting')
    expect(aboveEstimate.lines).toHaveLength(2)
    expect(aboveEstimate.minimumCharge).toBeNull()
    expect(toDemoEstimate(view(stored), null, null).minimumCharge).toBe(400)
    expect(code('components/demo/DemoExperience.tsx')).toContain('<MinimumNote')
  })

  it('the service editor’s price preview: no "Minimum Charge Adjustment" line; the note above the total', () => {
    const page = code('app/(dashboard)/app/services/page.tsx')
    expect(page).not.toContain('Minimum Charge Adjustment')
    expect(page).not.toMatch(/subtotal < formData\.minimumCharge/)
    // T-189: the preview's maths moved to lib/sample-price; the floor is the same shared rule
    expect(code('lib/sample-price.ts')).toContain('minimumTopUp(subtotal, service.minimumCharge) > 0')
    expect(page).toContain('minimumChargeNote(currencySymbol + simulatorResult.minimumCharge.toFixed(2))')
  })

  it('the marketing examples never rely on a minimum: their lines add up to their total', () => {
    for (const trade of EXAMPLE_TRADES) {
      const example = marketingExample(trade)
      expect(example.lines.reduce((sum, line) => sum + line.amount, 0), trade).toBe(example.total)
    }
  })
})

describe('T-165: the PDF', () => {
  const branding = { logoAssetId: null, primaryColor: '#205E56', footerNotes: null } as TenantBranding
  const template: TenantTemplate = { showLineItems: true, includeAssumptions: true, includeExclusions: true, validityDays: 30 }
  const pdf = (p: QuotePricing) =>
    text(
      generateQuotePdfHtml({
        quoteId: 'q_test',
        businessName: 'Fernhill Painting',
        branding,
        template,
        customer: { name: 'Marisol Okafor', email: 'marisol@example.test' },
        pricing: p,
        content: { scopeSummary: 'Paint one room.' } as QuoteContent,
        createdAt: '2026-11-15T10:00:00Z',
        locale: 'en-US',
      })
    )

  it('below the minimum: the real line, then the note, then the total; no minimum row', () => {
    const out = pdf(below)
    expect(out).toContain('Rooms')
    expect(out).toContain('$375.00')
    expect(out).toContain('Minimum charge of $400.00 applied')
    expect(out).not.toContain('Minimum charge applied')
    expect(out).not.toContain('$25.00')
    expect(out.indexOf('Minimum charge of $400.00 applied')).toBeGreaterThan(out.indexOf('$375.00'))
    expect(out.lastIndexOf('$400.00')).toBeGreaterThan(out.indexOf('Minimum charge of $400.00 applied'))
  })

  it('at or above the minimum: nothing about a minimum', () => {
    expect(pdf(above)).not.toMatch(/minimum/i)
    expect(pdf(equal)).not.toMatch(/minimum/i)
  })

  it('a quote stored before this change renders as the note too', () => {
    const out = pdf(stored)
    expect(out).toContain('Minimum charge of $400.00 applied')
    expect(out).not.toContain('Minimum charge applied')
    expect(out).not.toContain('$25.00')
  })
})

describe('T-165: the quote editor', () => {
  const editor = (p: QuotePricing) =>
    renderToStaticMarkup(
      createElement(QuoteEditor, {
        quoteId: 'q_test',
        initialPricing: p,
        initialContent: { scopeSummary: 'Paint one room.' } as QuoteContent,
        businessNotes: null,
        version: 1,
        currency: 'USD',
        onSave: async () => undefined,
        onCancel: () => undefined,
      })
    )
  const lineLabels = (html: string) => [...html.matchAll(/placeholder="Line item label"[^>]*value="([^"]*)"|value="([^"]*)"[^>]*placeholder="Line item label"/g)].map((m) => m[1] ?? m[2])

  it('a quote that carries a minimum: its lines are editable, the minimum is the note with its amount and a Remove control', () => {
    const html = editor(below)
    expect(lineLabels(html)).toEqual(['Rooms  $375 x 1(Room)'])
    const shown = text(html)
    expect(shown).toContain('Minimum charge of $400.00 applied')
    expect(html).toContain('data-testid="editor-minimum-remove"')
    // the running figures: what the lines come to, what the minimum adds, and the subtotal it holds
    expect(html).toMatch(/data-testid="editor-lines-total">\$375\.00</)
    expect(html).toMatch(/data-testid="editor-minimum-amount">\+ \$25\.00</)
    expect(shown).toMatch(/Subtotal \$400\.00/)
    expect(shown).toMatch(/Total \$400\.00/)
  })

  it('a quote stored before this change opens the same way', () => {
    const html = editor(stored)
    expect(lineLabels(html)).toEqual(['Rooms  $375 x 1(Room)'])
    expect(text(html)).toContain('Minimum charge of $400.00 applied')
    expect(html).toMatch(/data-testid="editor-minimum-amount">\+ \$25\.00</)
    // the stored copy of the sentence is not offered back as a pricing note
    expect(html).not.toContain('value="Minimum charge of $400.00 applied"')
    expect(html).toContain('Paint is included.')
  })

  it('a quote without a minimum shows nothing about one', () => {
    for (const p of [above, equal]) {
      const html = editor(p)
      expect(html).not.toContain('editor-minimum')
      expect(text(html)).not.toMatch(/minimum/i)
    }
  })

  it('the floor follows the edits, can be removed, and stays removed', () => {
    const hook = code('components/quote-editor/useQuotePricing.ts')
    // the top-up is worked out from the lines as they are now
    expect(hook).toContain('const topUp = floor === null ? 0 : minimumTopUp(linesTotal, floor)')
    expect(hook).toContain('const subtotal = roundMoney(linesTotal + topUp)')
    // Remove sets the floor aside; nothing but Undo brings it back (editing lines never does)
    expect(hook).toContain('const removeMinimum = useCallback(() => setFloor(null), [])')
    expect(hook.match(/setFloor\(/g)).toHaveLength(2)
    // saved as its own marked entry, only while it applies
    expect(hook).toContain('...(floor !== null && topUp > 0 ? [minimumEntry(topUp, floor)] : [])')
  })
})

describe('T-165: saving an edited quote (editedBreakdown)', () => {
  const marked = (amount: number, minimumCharge = 400) => minimumEntry(amount, minimumCharge)
  const sum = (lines: Array<{ amount: number }>) => Math.round(lines.reduce((s, l) => s + l.amount, 0) * 100) / 100

  it('lines edited but still below the minimum: the top-up is worked out again, the subtotal stays at the minimum', () => {
    const saved = editedBreakdown(below.breakdown, [{ label: 'Rooms', amount: 300 }, { label: 'Touch-ups', amount: 40 }, marked(25)])
    expect(saved).toEqual([{ label: 'Rooms', amount: 300 }, { label: 'Touch-ups', amount: 40 }, marked(60)])
    expect(sum(saved)).toBe(400)
  })

  it('the amount and the minimum a client sends are never trusted', () => {
    const saved = editedBreakdown(below.breakdown, [ROOM, { label: 'Minimum charge applied', amount: 9000, kind: 'minimum', minimumCharge: 9375 }])
    expect(saved).toEqual([ROOM, marked(25)])
  })

  it('lines edited up to the minimum or above it: no entry is stored', () => {
    expect(editedBreakdown(below.breakdown, [{ label: 'Rooms', amount: 400 }, marked(25)])).toEqual([{ label: 'Rooms', amount: 400 }])
    expect(editedBreakdown(below.breakdown, [{ label: 'Rooms', amount: 750 }, marked(25)])).toEqual([{ label: 'Rooms', amount: 750 }])
  })

  it('the business removed the minimum: only the lines are stored, and it stays removed on the next edit', () => {
    const waived = editedBreakdown(below.breakdown, [ROOM])
    expect(waived).toEqual([ROOM])
    expect(splitMinimum(waived).minimum).toBeNull()
    // the next edit starts from a quote with no minimum: lowering a line does not bring it back,
    // and a marked entry sent for it is dropped
    expect(editedBreakdown(waived, [{ label: 'Rooms', amount: 200 }])).toEqual([{ label: 'Rooms', amount: 200 }])
    expect(editedBreakdown(waived, [{ label: 'Rooms', amount: 200 }, marked(200)])).toEqual([{ label: 'Rooms', amount: 200 }])
  })

  it('a quote that never carried a minimum never gets one', () => {
    expect(editedBreakdown(above.breakdown, [{ label: 'Rooms', amount: 100 }, marked(300)])).toEqual([{ label: 'Rooms', amount: 100 }])
    expect(editedBreakdown([], [{ label: 'Rooms', amount: 100 }, marked(300)])).toEqual([{ label: 'Rooms', amount: 100 }])
    expect(editedBreakdown(null, [{ label: 'Rooms', amount: 100 }])).toEqual([{ label: 'Rooms', amount: 100 }])
  })

  it('a quote stored before this change keeps its minimum through an edit, now marked', () => {
    const saved = editedBreakdown(stored.breakdown, [{ label: 'Rooms', amount: 380 }, marked(25)])
    expect(saved).toEqual([{ label: 'Rooms', amount: 380 }, marked(20)])
  })

  it('a line the business typed is theirs, whatever it says; only the marker counts', () => {
    const typed = [{ label: 'Minimum charge', amount: 80 }, { label: 'Rooms', amount: 100 }]
    expect(editedBreakdown(above.breakdown, typed)).toEqual(typed)
  })

  it('the save route uses it, and the subtotal is still the sum of what is stored', () => {
    const route = code('app/api/quotes/[quoteId]/route.ts')
    expect(route).toContain('pricing.breakdown = editedBreakdown(')
    expect(route).toContain('pricing.subtotal = roundMoney(pricing.breakdown.reduce((sum, item) => sum + item.amount, 0))')
    expect(route.indexOf('pricing.subtotal = roundMoney(')).toBeGreaterThan(route.indexOf('pricing.breakdown = editedBreakdown('))
  })
})
