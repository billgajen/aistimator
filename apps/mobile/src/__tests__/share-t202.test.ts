/**
 * T-202 (items 5 and 3) in the phone app:
 *   5. pressing "Copy link" or "Send the link" on the business's own quote link tells the server,
 *      which ticks "Share your quote link" on Home
 *   3. a test estimate the business made itself says "Test" on its row in the list
 * The screens are read as source (no phone runs here); the row's words are run.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import type { QuoteListItem } from '@qolumns/shared'
import { rowWords } from '../lib/quote-list'

const root = path.resolve(__dirname, '../..')
const read = (file: string) => readFileSync(path.join(root, file), 'utf8')

describe('T-202: Copy and Send on the app’s quote link screen tick "Share your quote link"', () => {
  const screen = read('app/link.tsx')
  const api = read('src/lib/api.ts')

  it('the app calls the dashboard’s route, with its own sign-in', () => {
    expect(api).toContain("request<{ ok: boolean }>('/api/tenant/share-event', { method: 'POST', body: JSON.stringify({ event }) })")
    expect(api).toContain("quoteLinkShared: (event: 'copied' | 'shared') =>")
  })

  it('both buttons report it, and neither waits for the answer or fails without a signal', () => {
    expect(screen).toContain("const noteShared = (event: 'copied' | 'shared') => void api.quoteLinkShared(event).catch(() => undefined)")
    expect(screen).toMatch(/async function copy\(\) \{\s+if \(!link\) return\s+noteShared\('copied'\)/)
    expect(screen).toMatch(/function send\(\) \{\s+if \(!link\) return\s+noteShared\('shared'\)\s+void Share\.share\(\{ message: link \}\)/)
    expect(screen).toContain('<Button title="Send the link" icon="share-outline" onPress={send} />')
    expect(screen).toContain('onPress={() => void copy()}')
  })

  it('showing the QR code alone reports nothing (a customer scanning it is seen as their request)', () => {
    expect(read('app/(tabs)/account.tsx')).not.toContain('quoteLinkShared')
  })
})

describe('T-202: a test estimate says so in the app’s list', () => {
  const item = (over: Partial<QuoteListItem> = {}): QuoteListItem =>
    ({
      quoteId: 'qte_1',
      serviceName: 'Exterior wall painting',
      customerName: 'Tess Ward',
      customerEmail: '',
      status: 'pending_review',
      createdAt: '2026-11-25T10:00:00Z',
      sentAt: null,
      viewedAt: null,
      acceptedAt: null,
      paidAt: null,
      total: 867,
      currency: 'USD',
      ...over,
    }) as QuoteListItem
  const NOW = new Date('2026-11-25T12:00:00Z')

  it('a test’s row reads "<service> · Test", on screen and for a screen reader', () => {
    const words = rowWords(item({ isTest: true }), { now: NOW })
    expect(words.service).toBe('Exterior wall painting · Test')
    expect(words.spoken).toContain('Exterior wall painting · Test')
  })

  it('a real quote’s row is unchanged', () => {
    expect(rowWords(item(), { now: NOW }).service).toBe('Exterior wall painting')
    expect(rowWords(item({ isTest: false }), { now: NOW }).service).toBe('Exterior wall painting')
  })
})
