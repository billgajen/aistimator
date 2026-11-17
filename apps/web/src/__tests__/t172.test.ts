/**
 * T-172: small photo copies and the request form's step count.
 * (The colour tokens are held in design-tokens.test.ts, the checker's
 * settings and the AI timeouts in the worker's checker-t172.test.ts.)
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  SMALL_PHOTO_MAX_BYTES,
  SMALL_PHOTO_MAX_EDGE,
  smallPhotoBytesOk,
  smallPhotoDeclarationOk,
  smallPhotoKey,
  smallPhotoSize,
  smallSizeUrl,
} from '@/lib/small-photo'
import { forgetCheckedSmallPhotos, photoKeyToServe, photoSizeOf } from '@/lib/small-photo-server'
import { photosInOrder } from '@/lib/quote-photos'
import { questionsSpread, serviceAsksQuestions, type StepCountData } from '@/components/embed/step-count'

const ROOT = join(__dirname, '..', '..', '..', '..')
const read = (file: string) => readFileSync(join(ROOT, file), 'utf8')

const WEBP = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0x10, 0x20, 0, 0, 0x57, 0x45, 0x42, 0x50])
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1])
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d])
const HTML = new TextEncoder().encode('<!doctype html><script>')

describe('T-172: the small copy of a photo: the rules', () => {
  it('lives beside the original, in the same tenant folder', () => {
    expect(smallPhotoKey('tnt_1/1731770000000-front.jpg')).toBe('tnt_1/1731770000000-front.jpg.small')
    expect(smallPhotoKey('tnt_1/x.jpg').startsWith('tnt_1/')).toBe(true)
  })

  it('what the browser offers is accepted only as a WebP or JPEG within the limit', () => {
    expect(smallPhotoDeclarationOk({ contentType: 'image/webp', sizeBytes: 30_000 })).toBe(true)
    expect(smallPhotoDeclarationOk({ contentType: 'image/jpeg', sizeBytes: SMALL_PHOTO_MAX_BYTES })).toBe(true)
    expect(smallPhotoDeclarationOk({ contentType: 'image/jpeg', sizeBytes: SMALL_PHOTO_MAX_BYTES + 1 })).toBe(false)
    for (const bad of [
      undefined,
      null,
      'image/webp',
      {},
      { contentType: 'image/png', sizeBytes: 100 },
      { contentType: 'image/svg+xml', sizeBytes: 100 },
      { contentType: 'text/html', sizeBytes: 100 },
      { contentType: 'application/pdf', sizeBytes: 100 },
      { contentType: 'image/webp', sizeBytes: 0 },
      { contentType: 'image/webp', sizeBytes: -5 },
      { contentType: 'image/webp', sizeBytes: 12.5 },
      { contentType: 'image/webp', sizeBytes: '300' },
      { contentType: 'image/webp' },
    ]) {
      expect(smallPhotoDeclarationOk(bad), JSON.stringify(bad)).toBe(false)
    }
  })

  it('what is in storage is read from its bytes and its size, not from a header', () => {
    expect(smallPhotoBytesOk(WEBP, 30_000)).toBe(true)
    expect(smallPhotoBytesOk(JPEG, 30_000)).toBe(true)
    expect(smallPhotoBytesOk(PNG, 30_000)).toBe(false)
    expect(smallPhotoBytesOk(HTML, 30_000)).toBe(false)
    expect(smallPhotoBytesOk(new Uint8Array(0), 30_000)).toBe(false)
    expect(smallPhotoBytesOk(WEBP.slice(0, 8), 30_000)).toBe(false)
    // a real image that is too big is refused as well
    expect(smallPhotoBytesOk(WEBP, SMALL_PHOTO_MAX_BYTES)).toBe(true)
    expect(smallPhotoBytesOk(WEBP, SMALL_PHOTO_MAX_BYTES + 1)).toBe(false)
    expect(smallPhotoBytesOk(JPEG, 340 * 1024)).toBe(false)
    expect(smallPhotoBytesOk(WEBP, 0)).toBe(false)
  })

  it('scales down to the longest side, never up', () => {
    expect(SMALL_PHOTO_MAX_EDGE).toBe(480)
    expect(smallPhotoSize(4032, 3024)).toEqual({ width: 480, height: 360 })
    expect(smallPhotoSize(3024, 4032)).toEqual({ width: 360, height: 480 })
    expect(smallPhotoSize(300, 200)).toEqual({ width: 300, height: 200 })
    expect(smallPhotoSize(4000, 2)).toEqual({ width: 480, height: 1 })
    expect(smallPhotoSize(0, 0)).toEqual({ width: 0, height: 0 })
  })

  it('the small size is the same address with size=small', () => {
    expect(smallSizeUrl('/api/quotes/qte_1/photos/ast_1')).toBe('/api/quotes/qte_1/photos/ast_1?size=small')
    expect(smallSizeUrl('https://x.test/api/public/assets/ast_1?token=abc')).toBe('https://x.test/api/public/assets/ast_1?token=abc&size=small')
    expect(photoSizeOf('small')).toBe('small')
    for (const other of [null, undefined, '', 'SMALL', 'large', 'full', '1']) expect(photoSizeOf(other)).toBe('full')
    expect(photosInOrder('qte_1', ['ast_1', 'doc_1'], new Set(['ast_1']))).toEqual([
      { id: 'ast_1', url: '/api/quotes/qte_1/photos/ast_1', smallUrl: '/api/quotes/qte_1/photos/ast_1?size=small' },
    ])
  })
})

describe('T-172: which stored object is served', () => {
  beforeEach(() => forgetCheckedSmallPhotos())
  const KEY = 'tnt_1/171-front.jpg'
  const reader = (answer: { head: Uint8Array; sizeBytes: number } | null | Error) => {
    const asked: string[] = []
    const read = async (key: string) => {
      asked.push(key)
      if (answer instanceof Error) throw answer
      return answer
    }
    return { read, asked }
  }

  it('the full size is always the original, and storage is not read for it', async () => {
    const r = reader({ head: WEBP, sizeBytes: 30_000 })
    expect(await photoKeyToServe(KEY, 'full', r.read)).toBe(KEY)
    expect(r.asked).toEqual([])
  })

  it('the small size is the small copy once the server has checked it in storage', async () => {
    const r = reader({ head: WEBP, sizeBytes: 30_000 })
    expect(await photoKeyToServe(KEY, 'small', r.read)).toBe(`${KEY}.small`)
    expect(r.asked).toEqual([`${KEY}.small`])
    // a copy that passed is not read again
    expect(await photoKeyToServe(KEY, 'small', r.read)).toBe(`${KEY}.small`)
    expect(r.asked).toHaveLength(1)
  })

  it('a photo with no small copy (uploaded before this change) falls back to the original, and is looked for again next time', async () => {
    const r = reader(null)
    expect(await photoKeyToServe(KEY, 'small', r.read)).toBe(KEY)
    expect(await photoKeyToServe(KEY, 'small', r.read)).toBe(KEY)
    expect(r.asked).toHaveLength(2)
  })

  it('a small copy that is not an image, or is too big, is never served', async () => {
    expect(await photoKeyToServe(KEY, 'small', reader({ head: HTML, sizeBytes: 300 }).read)).toBe(KEY)
    expect(await photoKeyToServe(KEY, 'small', reader({ head: PNG, sizeBytes: 300 }).read)).toBe(KEY)
    expect(await photoKeyToServe(KEY, 'small', reader({ head: JPEG, sizeBytes: SMALL_PHOTO_MAX_BYTES + 1 }).read)).toBe(KEY)
  })

  it('trouble reading storage means the original, never an error', async () => {
    expect(await photoKeyToServe(KEY, 'small', reader(new Error('storage down')).read)).toBe(KEY)
  })
})

describe('T-172: small copies in the code', () => {
  const init = read('apps/web/src/app/api/public/uploads/init/route.ts')
  const dashboard = read('apps/web/src/app/api/quotes/[quoteId]/photos/[assetId]/route.ts')
  const customer = read('apps/web/src/app/api/public/assets/[assetId]/route.ts')

  it('the upload route gives a small copy its own signed address only for a photo, only when the declaration passes, and limits are unchanged', () => {
    expect(init).toContain("if (assetType === 'image' && isR2Configured() && smallPhotoDeclarationOk(file.small))")
    // T-173: the address is good for exactly the declared size and type
    expect(init).toContain('generateUploadUrl(smallPhotoKey(r2Key), file.small.contentType, 3600, file.small.sizeBytes)')
    expect(init).toContain('const MAX_IMAGE_SIZE = 10 * 1024 * 1024')
    expect(init).toContain('const MAX_DOC_SIZE = 25 * 1024 * 1024')
    expect(init).toContain('const MAX_FILES_PER_REQUEST = 10')
    expect(init).toContain("const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']")
    // the small copy is not an asset: one row is inserted per file, as before
    expect(init.match(/\.from\('assets'\)\s*\.insert\(/g)).toHaveLength(1)
    // the rate limit still runs before anything is signed
    expect(init.indexOf("checkPublicRateLimit('uploads'")).toBeLessThan(init.indexOf('generateUploadUrl('))
  })

  it('both photo routes choose the object after their checks, and sign whatever is chosen', () => {
    // the dashboard: sign-in, tenant and "this quote's photo" come first
    expect(dashboard.indexOf(".eq('tenant_id', profile.tenant_id)")).toBeLessThan(dashboard.indexOf('photoKeyToServe('))
    expect(dashboard.indexOf('.includes(assetId)) return notFound()')).toBeLessThan(dashboard.indexOf('photoKeyToServe('))
    expect(dashboard).toContain('generateDownloadUrl(key, DASHBOARD_PHOTO_URL_SECONDS)')
    // the customer's page: the token check comes first
    expect(customer.indexOf("{ code: 'UNAUTHORIZED', message: 'Invalid token for this asset' }")).toBeLessThan(customer.indexOf('photoKeyToServe('))
    expect(customer).toContain("asset.type === 'image' ? photoSizeOf(url.searchParams.get('size')) : 'full'")
    // storage stays private: neither route answers with a public address
    for (const src of [dashboard, customer]) expect(src).not.toContain('getPublicUrl')
  })

  it('small pictures ask for the small size; the larger view and the link keep the original', () => {
    const photos = read('apps/web/src/components/quotes/CustomerPhotos.tsx')
    expect(photos).toContain('src={photo.smallUrl ?? photo.url}')
    expect(photos).toContain('src={current.url}')
    const page = read('apps/web/src/app/q/[quoteId]/page.tsx')
    expect(page).toContain('href={asset.viewUrl}')
    expect(page).toContain('src={asset.smallUrl ?? asset.viewUrl}')
    expect(read('apps/web/src/lib/quote-photos.ts')).toContain('out.set(row.quoteId, first.smallUrl ?? first.url)')
    expect(read('apps/web/src/app/api/public/quotes/[quoteId]/route.ts')).toContain('&size=small')
  })

  it('the browser makes the copy with no library, and a failed copy never fails the upload', () => {
    const client = read('apps/web/src/lib/small-photo-client.ts')
    expect(client).toContain('createImageBitmap(file)')
    expect(client).toContain("canvas.toBlob(resolve, type, quality)")
    expect(client.match(/^import .*$/gm)).toEqual(["import { isSmallPhotoType, SMALL_PHOTO_MAX_BYTES, smallPhotoSize } from './small-photo'"])
    const widget = read('apps/web/src/components/embed/EstimateWidget.tsx')
    expect(widget.match(/await makeSmallPhoto\(file\)/g)).toHaveLength(2)
    expect(widget.match(/uploadSmallPhoto\(small, smallUploadUrl\)/g)).toHaveLength(2)
    // the original is still sent whole
    expect(widget.match(/method: 'PUT',?\s*body: file/g)).toHaveLength(2)
    const pkg = JSON.parse(read('apps/web/package.json')) as { dependencies: Record<string, string> }
    for (const heavy of ['sharp', 'jimp', 'browser-image-compression', 'pica']) expect(pkg.dependencies[heavy]).toBeUndefined()
  })

  it('the AI still reads the original: the worker knows nothing of small copies', () => {
    const worker = read('apps/worker/src/quote-processor.ts')
    expect(worker).not.toMatch(/\.small\b|smallPhoto|size=small/)
  })

  it('a demo photo’s small copy is deleted with it', () => {
    expect(read('apps/web/src/lib/demo/demo-cleanup.ts')).toContain('await opts.deleteObjects(keys.map(smallPhotoKey))')
  })
})

describe('T-172: the request form says how many steps only when it knows', () => {
  const svc = (id: string, asks = false) => ({ id, measurementModel: asks ? { type: 'per_unit', askCustomerForQuantity: true } : null })
  const data = (over: Partial<StepCountData>): StepCountData => ({ services: [svc('a'), svc('b')], globalFields: [], serviceFields: {}, ...over })

  it('every service has questions: the total is known on the first step', () => {
    expect(questionsSpread(data({ serviceFields: { a: [{}], b: [{}, {}] } }))).toBe('every')
    // a question the business asks for every service counts for each of them
    expect(questionsSpread(data({ globalFields: [{}] }))).toBe('every')
    expect(questionsSpread(data({ fields: [{}], globalFields: undefined }))).toBe('every')
    // so does a service that asks for its quantity
    expect(questionsSpread(data({ services: [svc('a', true), svc('b')], serviceFields: { b: [{}] } }))).toBe('every')
  })

  it('no service has questions: the total is known on the first step', () => {
    expect(questionsSpread(data({}))).toBe('none')
    expect(questionsSpread(data({ serviceFields: { a: [], zzz: [{}] } }))).toBe('none')
    expect(questionsSpread(data({ services: [{ id: 'a', measurementModel: { type: 'per_unit', askCustomerForQuantity: false } }, { id: 'b', measurementModel: { type: 'fixed', askCustomerForQuantity: true } }] }))).toBe('none')
  })

  it('some do and some do not: it depends on the choice', () => {
    expect(questionsSpread(data({ serviceFields: { a: [{}] } }))).toBe('some')
    expect(questionsSpread(data({ services: [svc('a', true), svc('b')] }))).toBe('some')
    expect(serviceAsksQuestions(data({ serviceFields: { a: [{}] } }), svc('a'))).toBe(true)
    expect(serviceAsksQuestions(data({ serviceFields: { a: [{}] } }), svc('b'))).toBe(false)
  })

  it('the form counts Questions before a choice only when every service has them, and shows the name alone when it depends', () => {
    const widget = read('apps/web/src/components/embed/EstimateWidget.tsx')
    expect(widget).toMatch(/const hasQuestionsStep = selectedService\s*\? serviceQuestions\.length > 0 \|\| Boolean\(asksQuantity\)\s*: spread === 'every'/)
    expect(widget).toContain("const countUnknown = hasServiceStep && step === 'service' && spread === 'some'")
    expect(widget).toContain('nameOnly={countUnknown}')
    // with the name alone there is no total anywhere: no "Step N of M", no bar parts, no numbered row
    const nameOnly = widget.slice(widget.indexOf('if (nameOnly) {'), widget.indexOf('return (', widget.indexOf('if (nameOnly) {') + 60) + 400)
    expect(nameOnly).toContain('data-count="unknown"')
    expect(nameOnly).toContain('data-testid="step-name"')
    const block = widget.slice(widget.indexOf('if (nameOnly) {'), widget.indexOf('data-testid="step-bar-compact"'))
    expect(block).not.toContain('step-count')
    expect(block).not.toContain('steps.map')
  })
})
