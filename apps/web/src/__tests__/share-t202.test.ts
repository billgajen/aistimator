/**
 * T-202 item 5: "Share your quote link" on Home's checklist.
 *   - opening the link ticks nothing (a visit cannot tell the owner from a customer)
 *   - pressing Copy or Share ticks it (dashboard or phone app), and so does the first real request
 *   - a business ticked by a visit before T-202 stays ticked
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { buildChecklist, quoteLinkShared } from '@/lib/setup-checklist'

const ROOT = path.resolve(__dirname, '../../../..')
const read = (file: string) => readFileSync(path.join(ROOT, file), 'utf8')
const none = { hasService: true, pricesCheckedAt: null, quoteLinkCopiedAt: null, quoteLinkFirstVisitAt: null, hasRealRequest: false }
const share = (input: typeof none | Record<string, unknown>) => buildChecklist(input as Parameters<typeof buildChecklist>[0]).steps.find((s) => s.id === 'share')!

describe('T-202: when "Share your quote link" is ticked', () => {
  it('not for a new business, whoever opened its link', () => {
    expect(share(none).completed).toBe(false)
    expect(quoteLinkShared(none)).toBe(false)
  })

  it('when the business pressed Copy or Share', () => {
    expect(share({ ...none, quoteLinkCopiedAt: '2026-11-25T10:00:00Z' }).completed).toBe(true)
  })

  it('when its first real customer request arrived, though nobody pressed Copy', () => {
    const steps = buildChecklist({ ...none, hasRealRequest: true }).steps
    expect(steps.find((s) => s.id === 'share')!.completed).toBe(true)
    expect(steps.find((s) => s.id === 'first_request')!.completed).toBe(true)
  })

  it('a business ticked by a visit before T-202 stays ticked', () => {
    expect(share({ ...none, quoteLinkFirstVisitAt: '2026-11-10T10:00:00Z' }).completed).toBe(true)
  })

  it('the step still leads to the Quote link page', () => {
    expect(share(none)).toMatchObject({ label: 'Share your quote link', href: '/app/quote-link' })
  })
})

describe('T-202: nothing records a visit any more', () => {
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const file = path.join(dir, name)
      if (statSync(file).isDirectory()) return name === '__tests__' || name === 'node_modules' ? [] : walk(file)
      return /\.(ts|tsx)$/.test(name) ? [file] : []
    })
  const sources = [...walk(path.join(ROOT, 'apps/web/src')), ...walk(path.join(ROOT, 'apps/worker/src'))]

  it('no code writes tenants.quote_link_first_visit_at', () => {
    const writers = sources.filter((file) => /quote_link_first_visit_at:\s*(new Date|now|[a-z]+\.toISOString)/.test(readFileSync(file, 'utf8')))
    expect(writers.map((f) => path.relative(ROOT, f))).toEqual([])
  })

  it('the public quote page looks at nobody and writes nothing', () => {
    const page = read('apps/web/src/app/quote/[slug]/page.tsx')
    expect(page).not.toMatch(/currentTenant|\.update\(|markFirstVisit|searchParams/)
  })

  it('the "own visit" mark of T-201 is gone: "Open" opens the plain link', () => {
    for (const file of sources) expect(readFileSync(file, 'utf8'), path.relative(ROOT, file)).not.toMatch(/ownVisitUrl|OWN_VISIT_PARAM|OwnVisitMark/)
    expect(read('apps/web/src/components/home/HomeQuoteLink.tsx')).toContain('href={link}')
    expect(read('apps/web/src/components/share/QuoteLinkCard.tsx')).toContain('href={main}')
  })
})

describe('T-202: Copy and Share tell the server; a visitor cannot', () => {
  const route = read('apps/web/src/app/api/tenant/share-event/route.ts')

  it('the route is for a signed-in business only (cookie or the app’s bearer sign-in), and takes "copied", "shared" or "qr"', () => {
    expect(route).toContain('const auth = await currentTenant()')
    expect(route).toContain("if (body?.event !== 'copied' && body?.event !== 'shared' && body?.event !== 'qr')")
    expect(route).toContain(".is('quote_link_copied_at', null)")
    // currentTenant reads the dashboard's cookie or the app's bearer token
    expect(read('apps/web/src/lib/supabase/server.ts')).toMatch(/const bearer = bearerToken\(/)
  })

  it('every Copy of the quote link reports it; copying the website code does not', () => {
    expect(read('apps/web/src/components/share/useCopy.ts')).toMatch(/\{ shareEvent = true \}/)
    for (const file of ['components/home/HomeQuoteLink.tsx', 'components/share/QuoteLinkCard.tsx', 'components/onboarding/TestQuoteStep.tsx', 'components/share/WhereToPutIt.tsx', 'components/share/UseItOnWhatsApp.tsx']) {
      const source = read(`apps/web/src/${file}`)
      expect(source, file).toMatch(/copy\(/)
      expect(source, file).not.toContain('shareEvent: false')
    }
    expect(read('apps/web/src/components/share/EmbedCodeCard.tsx')).toContain("copy('embed', code, { shareEvent: false })")
  })

  it('"Send on WhatsApp" reports a share', () => {
    expect(read('apps/web/src/components/share/UseItOnWhatsApp.tsx')).toContain("body: JSON.stringify({ event: 'shared' })")
  })

  it('downloading the QR code reports a share (owner, 25 Nov 2026), after the picture is saved', () => {
    const qr = read('apps/web/src/components/share/QrCode.tsx')
    expect(qr).toContain("body: JSON.stringify({ event: 'qr' })")
    expect(qr.indexOf('a.click()')).toBeGreaterThan(-1)
    expect(qr.indexOf("event: 'qr'")).toBeGreaterThan(qr.indexOf('a.click()'))
    // drawing the code tells the server nothing: the only report is where a file is saved
    // (T-204: `save`, which "Download PNG" and "Download SVG" both go through)
    expect(qr.match(/share-event/g)).toHaveLength(1)
    expect(qr.indexOf('share-event')).toBeGreaterThan(qr.indexOf('function save('))
    expect(qr.indexOf('share-event')).toBeLessThan(qr.indexOf('function download()'))
    expect(qr.slice(qr.indexOf('useEffect('), qr.indexOf('function save('))).not.toContain('fetch(')
  })

  it('the help assistant’s "link shared" follows the same rule as the checklist', () => {
    const state = read('apps/web/src/lib/help/state.ts')
    expect(state).toContain('state.linkShared = quoteLinkShared({')
    expect(read('apps/web/src/lib/setup-checklist.ts')).toContain('completed: quoteLinkShared(input),')
  })
})
