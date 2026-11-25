/**
 * T-162 (AD-045): the product is called Qolumns.
 *
 * People read "Qolumns" (PRODUCT_NAME). Technical identifiers are lower case:
 * the @qolumns/* scope, the embed's ids and message types, the mobile slug and
 * scheme, the reserved quote-link names. The two earlier names are gone from
 * everything but history, the infrastructure names the owner has not renamed,
 * and the reserved lists.
 *
 * The earlier names are spelled in two parts here, so a search of the repo for
 * them finds nothing in this file.
 */
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { EMBED_NAMES, PRODUCT_NAME, emailFromHeader } from '@qolumns/shared'
import { embedSnippet } from '@/lib/embed-snippet'
import { RESERVED_SLUGS, slugProblem } from '@/lib/tenant-slug'

const ROOT = join(__dirname, '..', '..', '..', '..')
const read = (file: string) => readFileSync(join(ROOT, file), 'utf8')

const SECOND_NAME = 'Aisti' + 'mator'
const FIRST_NAME = 'Esti' + 'mator'
const OLD_SCOPE = '@' + FIRST_NAME.toLowerCase() + '/'

/** Files with a hit, tracked or new, for a fixed string. `flags` as git grep takes them. */
function filesWith(flags: string, text: string): string[] {
  try {
    return execSync(`git grep --untracked -l ${flags} -F -e "${text}"`, { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean)
  } catch {
    return [] // git grep exits 1 when nothing matches
  }
}
/**
 * T-188: files with a hit for ANY of several fixed strings, in one search of the repository. The embed-names
 * test ran one search per name, eight in a row, and each is a process that walks the whole working tree: on a
 * busy machine the eight together passed the five-second limit (it failed at 5.2, 5.4 and 11.7 seconds, and
 * passed alone in 1.5). One search does the same work once, so the test no longer depends on how busy the
 * machine is. A longer limit would only have moved the line.
 */
function filesWithAny(texts: readonly string[]): string[] {
  try {
    return execSync(`git grep --untracked -l -F ${texts.map((text) => `-e "${text}"`).join(' ')}`, { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean)
  } catch {
    return [] // git grep exits 1 when nothing matches
  }
}
function linesWith(flags: string, text: string, file: string): string[] {
  try {
    return execSync(`git grep --untracked -h ${flags} -F -e "${text}" -- "${file}"`, { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean)
  } catch {
    return []
  }
}

/** History: written at the time, never rewritten */
const isHistory = (f: string) =>
  f === 'Docs/CHANGELOG.md' || f === 'OWNER-TODO.md' || f.startsWith('tickets/') || f.startsWith('Docs/design/')

describe('T-162: the name people read', () => {
  it('is Qolumns, from one constant', () => {
    expect(PRODUCT_NAME).toBe('Qolumns')
  })

  it('the email sender name carries it', () => {
    const address = 'quotes@mail.example.com'
    expect(emailFromHeader({ kind: 'customer', businessName: 'Kent Painters' }, address)).toBe(`"Kent Painters via Qolumns" <${address}>`)
    expect(emailFromHeader({ kind: 'business' }, address)).toBe(`"Qolumns" <${address}>`)
  })

  it('pages, legal pages, footer and trade titles use the constant, not a typed name', () => {
    for (const f of [
      'apps/web/src/app/pricing/page.tsx',
      'apps/web/src/app/privacy/page.tsx',
      'apps/web/src/app/terms/page.tsx',
      // T-195: the trades page's title is data now
      'apps/web/src/lib/marketing/who-its-for.ts',
      'apps/web/src/components/marketing/SiteFooter.tsx',
      'apps/web/src/lib/marketing/trades.ts',
      'apps/mobile/app/login.tsx',
    ]) {
      const src = read(f)
      expect(src, f).toContain('PRODUCT_NAME')
      expect(src, f).not.toMatch(/['"`>]\s*Qolumns\b/)
    }
    // "a Qolumns account": the article changed with the name
    expect(read('apps/web/src/app/privacy/page.tsx')).toContain('with a ${PRODUCT_NAME} account')
  })

  it('the mobile app shows Qolumns and its identifiers are lower case', () => {
    const app = JSON.parse(read('apps/mobile/app.json')).expo
    expect(app.name).toBe('Qolumns')
    expect(app.slug).toBe('qolumns')
    expect(app.scheme).toBe('qolumns')
    expect(app.ios.bundleIdentifier).toBe('com.qolumns.app')
    expect(app.android.package).toBe('com.qolumns.app')
  })
})

describe('T-162: the embed code', () => {
  it('has the new public names', () => {
    expect(EMBED_NAMES).toEqual({
      containerId: 'qolumns-widget',
      widgetGlobal: 'QolumnsWidget',
      iframeGlobal: 'QolumnsIframe',
      resizeMessage: 'qolumns-resize',
      submittedMessage: 'qolumns-submitted',
      submittedEvent: 'qolumns:submitted',
      launcherId: 'qolumns-floating-launcher',
      overlayId: 'qolumns-floating-overlay',
      consolePrefix: '[qolumns]',
    })
  })

  it('the snippet a business copies uses them', () => {
    const base = { appOrigin: 'https://example.test', tenantKey: 'tkey_alpha', experience: 'form' } as const
    const inline = embedSnippet({ ...base, placement: 'inline' })
    expect(inline).toContain('<!-- Qolumns Widget (Inline) -->')
    expect(inline).toContain('<div id="qolumns-widget"></div>')
    expect(inline).toContain('data-container="#qolumns-widget"')
    expect(inline).toContain('src="https://example.test/widget.js"')
    expect(embedSnippet({ ...base, placement: 'floating' })).toContain('<!-- Qolumns Widget (Floating) -->')
  })

  it('widget.js carries the same names as the constant', () => {
    const js = read('apps/web/public/widget.js')
    expect(js).toContain(`config.container || '#${EMBED_NAMES.containerId}'`)
    expect(js).toContain(`window.${EMBED_NAMES.widgetGlobal} = {`)
    expect(js).toContain(`data.type === '${EMBED_NAMES.resizeMessage}'`)
    expect(js).toContain(`data.type === '${EMBED_NAMES.submittedMessage}'`)
    expect(js).toContain(`new CustomEvent('${EMBED_NAMES.submittedEvent}'`)
    expect(js).toContain(`button.id = '${EMBED_NAMES.launcherId}'`)
    expect(js).toContain(`overlay.id = '${EMBED_NAMES.overlayId}'`)
    expect(js.match(/console\.error\('\[[^\]]+\]/g)).toEqual(Array(3).fill(`console.error('${EMBED_NAMES.consolePrefix}`))
  })

  it('iframe-loader.js carries the same names as the constant', () => {
    const js = read('apps/web/public/iframe-loader.js')
    expect(js).toContain(`config.container || '#${EMBED_NAMES.containerId}'`)
    expect(js).toContain(`window.${EMBED_NAMES.iframeGlobal} = {`)
    expect(js).toContain(`data.type === '${EMBED_NAMES.resizeMessage}'`)
    expect(js).toContain(`data.type === '${EMBED_NAMES.submittedMessage}'`)
    expect(js).toContain(`new CustomEvent('${EMBED_NAMES.submittedEvent}'`)
    expect(js.match(/console\.error\('\[[^\]]+\]/g)).toEqual(Array(2).fill(`console.error('${EMBED_NAMES.consolePrefix}`))
  })

  it('the embedded page posts the message types from the constant', () => {
    const widget = read('apps/web/src/components/embed/EstimateWidget.tsx')
    expect(widget).toContain('type: EMBED_NAMES.resizeMessage,')
    expect(widget).toContain('type: EMBED_NAMES.submittedMessage,')
  })

  it('the old embed names do not work any more: they are nowhere in the app', () => {
    const lower = FIRST_NAME.toLowerCase()
    const oldNames = [`${lower}-widget`, `${FIRST_NAME}Widget`, `${FIRST_NAME}Iframe`, `${lower}-resize`, `${lower}-submitted`, `${lower}:submitted`, `${lower}-floating`, `[${FIRST_NAME}]`]
    // one search for all eight (T-188). Only if it finds something is each name looked up, to say which.
    const hits = filesWithAny(oldNames).filter((f) => !isHistory(f))
    if (hits.length > 0) for (const old of oldNames) expect(filesWith('', old).filter((f) => !isHistory(f)), old).toEqual([])
    expect(hits).toEqual([])
  })

  it('the file names of the two loaders are unchanged', () => {
    expect(read('apps/web/public/widget.js')).toContain("src.indexOf('widget.js')")
    expect(read('apps/web/public/iframe-loader.js')).toContain("src.indexOf('iframe-loader.js')")
  })
})

describe('T-162: reserved quote-link names', () => {
  it('the name, its misspelling and both earlier names are reserved', () => {
    for (const word of ['qolumns', 'qolums', SECOND_NAME.toLowerCase(), FIRST_NAME.toLowerCase()]) {
      expect(RESERVED_SLUGS, word).toContain(word)
      expect(slugProblem(word), word).toBe('reserved')
    }
  })

  it('migration 40 reserves the two new words and stops if a business holds one', () => {
    const sql = read('supabase/migrations/00000000000040_reserve_qolumns.sql')
    expect(sql).toMatch(/INSERT INTO reserved_slugs \(slug\) VALUES[\s\S]*\('qolumns'\), \('qolums'\)[\s\S]*ON CONFLICT \(slug\) DO NOTHING/)
    expect(sql).toMatch(/FROM tenants WHERE slug IN \('qolumns', 'qolums'\)/)
    expect(sql).toMatch(/FROM tenant_slug_history WHERE old_slug IN \('qolumns', 'qolums'\)/)
    expect(sql).toMatch(/RAISE EXCEPTION/)
  })
})

describe('T-162: internal names', () => {
  it('every package is in the @qolumns scope and the root package is qolumns', () => {
    expect(JSON.parse(read('package.json')).name).toBe('qolumns')
    for (const [file, name] of [
      ['apps/web/package.json', '@qolumns/web'],
      ['apps/worker/package.json', '@qolumns/worker'],
      ['apps/mobile/package.json', '@qolumns/mobile'],
      ['packages/shared/package.json', '@qolumns/shared'],
    ] as const) {
      expect(JSON.parse(read(file)).name).toBe(name)
    }
    expect(filesWith('', OLD_SCOPE).filter((f) => !isHistory(f))).toEqual([])
  })

  it('the signing labels carry the new name', () => {
    // T-202: the test link's signed code is gone (lib/test-quote-token.ts was removed with it)
    expect(read('apps/web/src/lib/demo/demo-guard.ts')).toContain('`qolumns:demo-ip:v1:${ip}`')
  })
})

describe('T-162: what is left of the earlier names', () => {
  it(`"${SECOND_NAME.slice(0, 5)}…" is left only in history, migration 32, the reserved list and the storage bucket name`, () => {
    const left = filesWith('-i', SECOND_NAME).filter((f) => !isHistory(f)).sort()
    expect(left).toEqual([
      'apps/worker/wrangler.toml',
      // T-199: the reserved list moved here (one list for quote-link names and addresses)
      'packages/shared/src/own-address.ts',
      'supabase/migrations/00000000000032_quote_link.sql',
    ])
    // the reserved word, once
    expect(linesWith('-i', SECOND_NAME, 'packages/shared/src/own-address.ts')).toHaveLength(1)
    // section 5 of the ticket: the bucket keeps its name until the owner renames it
    const bucket = linesWith('-i', SECOND_NAME, 'apps/worker/wrangler.toml')
    expect(bucket).toHaveLength(2)
    for (const line of bucket) expect(line).toBe(`bucket_name = "${SECOND_NAME.toLowerCase()}-assets"`)
  })

  it(`"${FIRST_NAME.slice(0, 4)}…" as a whole word is left only in history, two applied migrations and the strategy doc`, () => {
    const left = filesWith('-w', FIRST_NAME).filter((f) => !isHistory(f)).sort()
    expect(left).toEqual([
      // "The World's Best …" (the common noun) and another company's product name
      'Docs/06-v2-strategy.md',
      'supabase/migrations/00000000000000_setup.sql',
      'supabase/migrations/00000000000002_core_schema.sql',
    ])
  })

  it('what the ticket says to leave is as it was', () => {
    const wrangler = read('apps/worker/wrangler.toml')
    expect(wrangler).toMatch(new RegExp(`^name = "${FIRST_NAME.toLowerCase()}-worker"$`, 'm'))
    expect(wrangler).toContain('queue = "quote-jobs"')
    // reported, not changed: the web app's fallback bucket name differs from wrangler.toml
    expect(read('apps/web/src/lib/r2.ts')).toContain(`process.env.R2_BUCKET_NAME || '${FIRST_NAME.toLowerCase()}-assets'`)
    // the support address waited for the domain ticket (T-174)
    expect(read('packages/shared/src/brand.ts')).toContain("export const SUPPORT_EMAIL = 'hello@qolumns.com'")
    // "estimate" is the product concept, not the brand
    expect(read('apps/web/src/components/embed/EstimateWidget.tsx')).toContain('export function EstimateWidget')
  })
})
