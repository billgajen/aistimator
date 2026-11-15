import { QrSvg } from '@/components/marketing/QrSvg'
import { RequestFormScreen } from './RequestFormScreen'

/**
 * T-165: "Add it anywhere", shown instead of told: the real QR code for a
 * real quote page, that quote page on a phone, and the same form sitting
 * inline on a business's own page. Three pictures of different sizes in one
 * composition (not three equal cards). Each has its title above it; there is
 * no caption under a picture.
 */
export function AddItAnywhere({
  shown,
  screenLabels,
  quoteLink,
  form,
}: {
  shown: { qr: { title: string; text: string }; page: { title: string; text: string }; site: { title: string; text: string } }
  screenLabels: { page: string; site: string }
  quoteLink: string
  form: { businessName: string; logoUrl: string; primaryColor: string; serviceName: string; question: string; answer: string }
}) {
  return (
    <div className="mt-10 grid gap-10 lg:grid-cols-[0.8fr_1fr_1.25fr] lg:items-end lg:gap-8" data-testid="add-it">
      {/* 1. The QR code */}
      <div>
        <Title {...shown.qr} />
        <div className="mt-4 inline-block rounded-2xl bg-white p-5 shadow-warm-md">
          <QrSvg value={quoteLink} label={`A QR code that opens ${quoteLink.replace(/^https?:\/\//, '')}`} className="h-40 w-40 text-ink" />
          <p className="figure mt-3 max-w-[10rem] break-all text-xs text-text-secondary">{quoteLink.replace(/^https?:\/\//, '')}</p>
        </div>
      </div>

      {/* 2. The quote page on a phone */}
      <div>
        <Title {...shown.page} />
        <div className="mx-auto mt-4 max-w-[22rem] rounded-3xl border border-field bg-surface p-2.5 shadow-warm-lg lg:mx-0" role="img" aria-label={screenLabels.page} {...({ inert: '' } as object)} data-testid="add-it-phone">
          <div className="overflow-hidden rounded-2xl bg-background px-3 pb-6 pt-4">
            <p className="figure mb-3 truncate text-center text-[11px] text-text-muted">{quoteLink.replace(/^https?:\/\//, '')}</p>
            <RequestFormScreen {...form} className="shadow-warm-md" />
          </div>
        </div>
      </div>

      {/* 3. The same form on the business's own website */}
      <div>
        <Title {...shown.site} />
        <div className="mt-4 overflow-hidden rounded-2xl border border-border bg-white shadow-warm-md" role="img" aria-label={screenLabels.site} {...({ inert: '' } as object)} data-testid="add-it-site">
          <div className="flex items-center justify-between gap-4 border-b border-border px-5 py-3">
            <p className="truncate font-display text-base font-bold text-text-primary">{form.businessName}</p>
            <p className="hidden shrink-0 gap-4 text-xs font-medium text-text-secondary sm:flex">
              <span>Services</span>
              <span>About</span>
              <span>Contact</span>
            </p>
          </div>
          <div className="p-5">
            <p className="font-display text-xl font-bold text-text-primary">Get an estimate</p>
            <p className="mt-1 max-w-sm text-sm text-text-secondary">Tell us about the job and add a photo. You’ll see an estimate from our prices straight away.</p>
            <RequestFormScreen {...form} className="mt-4 max-w-md p-5 shadow-warm" />
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
