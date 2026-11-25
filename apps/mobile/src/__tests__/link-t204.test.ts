/**
 * T-204 in the phone app:
 *   26  "Your quote link" draws its QR code at once from the link the phone already holds;
 *       the server is still asked, quietly
 *   23  a final invoice under half or over double the quote is asked about before it is saved
 * The screens are read as source (no phone runs here); the memory's rules are run.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const store = new Map<string, string>()
const reads = vi.fn(async (key: string) => store.get(key) ?? null)
const writes = vi.fn(async (key: string, value: string) => void store.set(key, value))
vi.mock('expo-secure-store', () => ({ getItemAsync: (key: string) => reads(key), setItemAsync: (key: string, value: string) => writes(key, value) }))

import { forgetLinkInMemory, linkInMemory, loadSavedLink, readSavedLink, rememberLink } from '../lib/link-memory'

const root = path.resolve(__dirname, '../..')
const read = (file: string) => readFileSync(path.join(root, file), 'utf8')
const account = { businessName: 'Northgate Heating & Air', quoteLink: 'https://qolumns.com/quote/northgate-heating-air' }

beforeEach(() => {
  store.clear()
  reads.mockClear()
  writes.mockClear()
  forgetLinkInMemory()
})

describe('T-204 item 26: the quote link is kept on the phone', () => {
  it('once the Account tab has read it, it is in memory: no read of any kind is needed to draw the code', async () => {
    expect(linkInMemory('user_a')).toBeNull()
    await rememberLink('user_a', account)
    expect(linkInMemory('user_a')).toEqual({ userId: 'user_a', ...account })
    expect(reads).not.toHaveBeenCalled()
  })

  it('it is saved on the phone too, so the next start of the app draws it with no signal', async () => {
    await rememberLink('user_a', account)
    forgetLinkInMemory() // the app was closed
    expect(linkInMemory('user_a')).toBeNull()
    expect(await loadSavedLink('user_a')).toEqual({ userId: 'user_a', ...account })
    // and from then on it is in memory again
    expect(linkInMemory('user_a')?.quoteLink).toBe(account.quoteLink)
  })

  it('another account on the same phone never sees it, in memory or saved', async () => {
    await rememberLink('user_a', account)
    expect(linkInMemory('user_b')).toBeNull()
    forgetLinkInMemory()
    expect(await loadSavedLink('user_b')).toBeNull()
    expect(await loadSavedLink(null)).toBeNull()
  })

  it('the same answer again writes nothing; a changed link replaces the saved one', async () => {
    await rememberLink('user_a', account)
    await rememberLink('user_a', account)
    expect(writes).toHaveBeenCalledTimes(1)
    await rememberLink('user_a', { ...account, quoteLink: 'https://northgate.qolumns.com' })
    expect(writes).toHaveBeenCalledTimes(2)
    expect(linkInMemory('user_a')?.quoteLink).toBe('https://northgate.qolumns.com')
  })

  it('a phone that cannot save still shows the code for this run, and nothing throws', async () => {
    writes.mockRejectedValueOnce(new Error('no keychain'))
    await expect(rememberLink('user_a', account)).resolves.toBeUndefined()
    expect(linkInMemory('user_a')?.quoteLink).toBe(account.quoteLink)
    reads.mockRejectedValueOnce(new Error('no keychain'))
    forgetLinkInMemory()
    await expect(loadSavedLink('user_a')).resolves.toBeNull()
  })

  it('what is stored is read with care: only this user’s, only a web address', () => {
    const saved = JSON.stringify({ userId: 'user_a', ...account })
    expect(readSavedLink(saved, 'user_a')?.quoteLink).toBe(account.quoteLink)
    expect(readSavedLink(saved, 'user_b')).toBeNull()
    expect(readSavedLink('not json', 'user_a')).toBeNull()
    expect(readSavedLink(null, 'user_a')).toBeNull()
    expect(readSavedLink(JSON.stringify({ userId: 'user_a', businessName: 'N', quoteLink: 'javascript:alert(1)' }), 'user_a')?.quoteLink).toBeNull()
    // a business with no link yet is remembered as that
    expect(readSavedLink(JSON.stringify({ userId: 'user_a', businessName: 'N', quoteLink: null }), 'user_a')).toEqual({ userId: 'user_a', businessName: 'N', quoteLink: null })
  })

  it('the screen starts from what is held, asks the server quietly, and a failed ask says nothing over a code on screen', () => {
    const screen = read('app/link.tsx')
    // the first frame: no network, no stored read
    expect(screen).toContain('useState<Pick<SavedLink, \'businessName\' | \'quoteLink\'> | null>(() => linkInMemory(currentUserId()))')
    expect(screen).toContain('void loadSavedLink(userId).then((saved) => {')
    // the server corrects it, and its answer is remembered for the next time
    expect(screen).toMatch(/api\.account\(\)\.then\(\s+\(a\) => \{\s+void rememberLink\(userId, a\)/)
    // the code is not drawn again when nothing changed
    expect(screen).toContain('now && now.quoteLink === a.quoteLink && now.businessName === a.businessName ? now : a')
    expect(screen).toContain("(e) => alive && !shown && setError(plainError(e, 'Your quote link could not be loaded. Try again.'))")
    // the grey square is only for a phone that holds nothing yet
    expect(screen).toContain('{!account && !error ? <Skeleton')
  })

  it('the Account tab remembers the link every time it reads the account', () => {
    const tab = read('app/(tabs)/account.tsx')
    expect(tab).toMatch(/const read = await api\.account\(\)\s+setAccount\(read\)[\s\S]{0,200}void rememberLink\(currentUserId\(\), read\)/)
  })
})

describe('T-204 item 23: the phone app asks before saving a final invoice far from the quote', () => {
  const screen = read('app/quote/[id].tsx')

  it('under half or over double: it asks, in the dashboard’s words, and saves only on "Yes"', () => {
    expect(screen).toContain('if (!finalInvoiceLooksOff(amount, quoted)) return void recordInvoice(amount)')
    expect(screen).toMatch(/Alert\.alert\(\s+FINAL_INVOICE_ASK,/)
    expect(screen).toContain("{ text: 'Change the amount', style: 'cancel' }")
    expect(screen).toContain("{ text: 'Yes, save it', onPress: () => void recordInvoice(amount) }")
  })

  it('the amount compared against is the quote’s own total', () => {
    expect(screen).toContain('const quoted = quote.pricing.total')
  })
})
