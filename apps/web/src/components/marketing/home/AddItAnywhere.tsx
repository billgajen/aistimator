import { QrSvg } from '@/components/marketing/QrSvg'
import { ShortLink, shortLink } from '@/components/marketing/ShortLink'
import { VAN_PHOTO } from '@/lib/marketing/photos'
import { RequestFormScreen } from './RequestFormScreen'

/**
 * "Add it anywhere", shown instead of told (T-165; redrawn in T-170): three
 * columns of one height, aligned at the top, each with a picture of the same
 * size, stacked on a phone (globals.css, "Add it anywhere").
 *
 *   1 the QR code on the side of a van. The van is a scene photograph
 *     (Docs/design/photos.md); the code is our real one for the example
 *     business's quote page, placed on the van's flat panel in code, with
 *     the business's name beside it. The image model drew no code and no
 *     lettering.
 *   2 that quote page on a phone: a phone-shaped frame wide enough for the
 *     business's name on one line, with the link, short, in its address bar.
 *   3 the same form sitting on the business's own web page.
 *
 * Each has its title above it; there is no caption under a picture.
 */
export function AddItAnywhere({
  shown,
  screenLabels,
  quoteLink,
  form,
}: {
  shown: { qr: { title: string; text: string }; page: { title: string; text: string }; site: { title: string; text: string } }
  screenLabels: { van: string; sign: string; page: string; site: string }
  quoteLink: string
  form: { businessName: string; logoUrl: string; primaryColor: string; serviceName: string; question: string; answer: string }
}) {
  return (
    <div className="add-it mt-10" data-testid="add-it">
      {/* 1. The QR code, on a van */}
      <div className="add-it-item" data-testid="add-it-item">
        <Title {...shown.qr} />
        <div className="add-it-picture relative overflow-hidden rounded-2xl bg-surface shadow-warm-md" data-testid="add-it-van">
          {/* eslint-disable-next-line @next/next/no-img-element -- our own WebP file in two sizes, served as it is */}
          <img
            src={VAN_PHOTO.src}
            srcSet={`${VAN_PHOTO.srcSmall} ${VAN_PHOTO.smallWidth}w, ${VAN_PHOTO.src} ${VAN_PHOTO.width}w`}
            sizes="(min-width: 1024px) 23rem, 20rem"
            width={VAN_PHOTO.width}
            height={VAN_PHOTO.height}
            alt={VAN_PHOTO.alt}
            loading="lazy"
            decoding="async"
            className="block h-full w-full object-cover"
          />
          {/* the sign on the van's side: ours, drawn here. `mix-blend-multiply` lets the van's own paint and
              shading show through it, as a printed sign would */}
          <div className="van-sign absolute flex items-center gap-[4%]" style={VAN_PHOTO.sign} data-testid="van-sign">
            <QrSvg value={quoteLink} label={`${screenLabels.sign} ${shortLink(quoteLink)}`} className="h-full w-auto shrink-0 text-ink mix-blend-multiply" />
            <p className="min-w-0 font-display font-extrabold leading-tight text-ink">
              <span className="van-sign-name block">{form.businessName}</span>
              <span className="van-sign-line mt-1 block font-sans font-semibold">{screenLabels.van}</span>
            </p>
          </div>
        </div>
      </div>

      {/* 2. The quote page on a phone */}
      <div className="add-it-item" data-testid="add-it-item">
        <Title {...shown.page} />
        <div className="add-it-picture" role="img" aria-label={screenLabels.page} {...({ inert: '' } as object)} data-testid="add-it-phone">
          <div className="phone-frame mx-auto h-full shadow-warm-lg">
            <span className="phone-frame-island" aria-hidden="true" />
            <div className="phone-frame-screen flex h-full flex-col bg-background">
              <p className="figure mx-3 mt-9 rounded-lg bg-surface px-3 py-1.5 text-center text-xs leading-snug text-text-secondary" data-testid="phone-address">
                <ShortLink url={quoteLink} />
              </p>
              <RequestFormScreen {...form} page className="mt-2" />
            </div>
          </div>
        </div>
      </div>

      {/* 3. The same form on the business's own website */}
      <div className="add-it-item" data-testid="add-it-item">
        <Title {...shown.site} />
        <div className="add-it-picture overflow-hidden rounded-2xl border border-border bg-white shadow-warm-md" role="img" aria-label={screenLabels.site} {...({ inert: '' } as object)} data-testid="add-it-site">
          <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
            {/* the name is never cut: where the picture is narrow the menu gives way (globals.css) */}
            <p className="whitespace-nowrap font-display text-sm font-bold text-text-primary" data-testid="site-business-name">{form.businessName}</p>
            <p className="flex min-w-0 shrink gap-3 text-xs font-medium text-text-secondary">
              <span className="site-menu-extra">Services</span>
              <span>Contact</span>
            </p>
          </div>
          <div className="p-4">
            <p className="font-display text-lg font-bold text-text-primary">Get an estimate</p>
            <p className="mt-1 text-sm text-text-secondary">Tell us about the job. You’ll see an estimate from our prices straight away.</p>
            <RequestFormScreen {...form} logoUrl={null} className="mt-3 p-4 shadow-warm" />
          </div>
        </div>
      </div>
    </div>
  )
}

function Title({ title, text }: { title: string; text: string }) {
  return (
    <div>
      <h3 className="font-display text-lg font-bold text-text-primary">{title}</h3>
      <p className="mt-1 text-sm text-text-secondary">{text}</p>
    </div>
  )
}
