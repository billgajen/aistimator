/**
 * T-185: polish from the owner's phone test. The rules that are plain
 * functions; how it looks on a phone is the owner's test.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import type { QuoteListItem } from '@qolumns/shared'
import { lastChanged, rowWords } from '../lib/quote-list'

const read = (path: string) => readFileSync(join(__dirname, '../..', path), 'utf8')
const NOW = new Date('2026-11-19T12:00:00Z')
const item = (over: Partial<QuoteListItem>): QuoteListItem => ({
  quoteId: 'qte_1',
  serviceName: 'Service A',
  customerName: 'Megan Grant',
  customerEmail: '',
  status: 'sent',
  createdAt: '2026-11-16T09:00:00Z',
  sentAt: null,
  viewedAt: null,
  acceptedAt: null,
  paidAt: null,
  total: 250,
  currency: 'USD',
  ...over,
})

describe('T-185: a quote row shows one time, when it last changed', () => {
  it('the latest of arrived, sent, opened, accepted, paid, declined', () => {
    expect(lastChanged(item({}))).toBe('2026-11-16T09:00:00Z')
    expect(lastChanged(item({ sentAt: '2026-11-17T09:00:00Z', viewedAt: '2026-11-19T10:00:00Z' }))).toBe('2026-11-19T10:00:00Z')
    expect(lastChanged(item({ sentAt: '2026-11-18T09:00:00Z', acceptedAt: '2026-11-17T09:00:00Z' }))).toBe('2026-11-18T09:00:00Z')
    expect(lastChanged(item({ declinedAt: '2026-11-19T11:00:00Z', sentAt: '2026-11-17T09:00:00Z' }))).toBe('2026-11-19T11:00:00Z')
  })

  it('a sent quote opened two hours ago says "2 hours ago" once, and no second time', () => {
    const words = rowWords(item({ status: 'viewed', sentAt: '2026-11-17T09:00:00Z', viewedAt: '2026-11-19T10:00:00Z' }), { now: NOW })
    expect(words.when).toMatch(/2 hours ago/)
    expect(words.detail).toBeNull()
    // the spoken line holds one time too
    expect(words.spoken.match(/ago|yesterday|today/gi) ?? []).toHaveLength(1)
  })

  it('a reason is still said where there is one, and it is never a time', () => {
    const held = rowWords(item({ status: 'pending_review', held: true, total: 0 }), { now: NOW })
    expect(held.detail).toBe('Your plan limit was reached')
    const noPrice = rowWords(item({ status: 'pending_review', total: 0 }), { now: NOW })
    expect(noPrice.detail).toBe('No price yet')
    const needsApproval = rowWords(item({ status: 'pending_review' }), { now: NOW })
    // "Received 3 days ago" was the second time on the row
    expect(needsApproval.detail).toBeNull()
    expect(needsApproval.when).toBeTruthy()
  })

  it('a long name wraps and the total keeps its width', () => {
    const screen = read('app/(tabs)/index.tsx')
    expect(screen).toContain("total: { flexShrink: 0, textAlign: 'right'")
    const name = screen.slice(screen.indexOf('{words.customer}') - 260, screen.indexOf('{words.customer}'))
    expect(name).toContain('flexShrink: 1')
    expect(name).not.toContain('numberOfLines')
  })
})

describe('T-185: the quote screen', () => {
  const screen = read('app/quote/[id].tsx')

  it('the progress card draws the shared named steps: done, current, later', () => {
    // T-186: the steps come with the chip, the sentence and the main button, from the one shared story
    expect(screen).toContain('const steps = story.steps')
    for (const state of ["step.state === 'done'", "step.state === 'current'", "step.state === 'later'", "step.state === 'ended'"]) expect(screen).toContain(state)
    expect(screen).toContain('styles.stepCurrent')
    // the names are the shared code's, not typed here
    expect(screen).not.toMatch(/'Approve and send'|'Received'|'Opened'|'Accepted'/)
  })

  it('a line shows its name, then its detail and note, read by the shared code; the note is the server’s alone', () => {
    expect(screen).toContain('const { name, detail } = lineLabelParts(line.label)')
    expect(screen).toContain("const note = [detail, line.source].filter(Boolean).join(' · ')")
    expect(screen).not.toContain('line.method')
  })
})

describe('T-185: money and dates are in the text face with tabular figures', () => {
  it('the figure faces are Instrument Sans, and every use sets tabular digits', () => {
    const theme = read('src/theme.ts')
    expect(theme).toContain("figure: 'InstrumentSans_400Regular'")
    expect(theme).toContain("figureBold: 'InstrumentSans_700Bold'")
    expect(theme).not.toContain('SplineSansMono')
    expect(read('app/_layout.tsx')).not.toContain('SplineSans')
    expect(read('package.json')).not.toContain('spline-sans-mono')
    for (const file of ['src/components/ui.tsx', 'app/(tabs)/index.tsx', 'app/(tabs)/account.tsx', 'app/quote/[id].tsx', 'app/photo.tsx']) {
      const source = read(file)
      const uses = source.match(/fontFamily: fonts\.figure(Bold)?\b[^}\n]*/g) ?? []
      expect(uses.length, file).toBeGreaterThan(0)
      for (const use of uses) expect(use, file).toContain('fontVariant: tabular')
    }
  })
})

describe('T-185: "Delete this quote" is a small red text button that still asks first', () => {
  it('uses the small red text button, and the confirm is still there', () => {
    const screen = read('app/(tabs)/new.tsx')
    expect(screen).toContain('<Button title="Delete this quote" variant="dangerText" onPress={discard} />')
    expect(screen).toContain("Alert.alert('Delete this quote?'")
    const ui = read('src/components/ui.tsx')
    expect(ui).toContain("variant === 'dangerText' && styles.buttonDangerText")
    expect(ui).toMatch(/buttonDangerText: \{ minHeight: touch\.min/)
    expect(ui).toContain("variant === 'danger' || variant === 'dangerText' ? colors.danger")
  })
})
