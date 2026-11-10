import { ImageResponse } from 'next/og'
import { PRODUCT_NAME, freeOfferLabel } from '@estimator/shared'
import { HERO } from '@/lib/marketing/home-copy'

/** T-154: the social preview image — the home page's message, in the site's colours */
export const runtime = 'edge'
export const alt = `${PRODUCT_NAME}: ${HERO.headline}`
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', background: '#FAF9F6', padding: '72px 80px', fontFamily: 'sans-serif' }}>
        <div style={{ display: 'flex', alignItems: 'center', fontSize: 34, fontWeight: 800, color: '#1B2823' }}>{PRODUCT_NAME}</div>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ fontSize: 72, fontWeight: 800, lineHeight: 1.05, color: '#1B2823', letterSpacing: -1.5 }}>{HERO.headline}</div>
          <div style={{ marginTop: 28, fontSize: 30, lineHeight: 1.35, color: '#3D4A44', maxWidth: 980 }}>
            Customers see an estimate from your prices straight away. You get the lead, and you confirm it.
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <div style={{ display: 'flex', background: '#205E56', color: '#ffffff', fontSize: 28, fontWeight: 700, padding: '16px 28px', borderRadius: 14 }}>{freeOfferLabel()}</div>
          <div style={{ display: 'flex', marginLeft: 24, height: 8, width: 220, background: '#DCAF3E', borderRadius: 4 }} />
        </div>
      </div>
    ),
    size
  )
}
