import { QrSvg } from '@/components/marketing/QrSvg'
import { ShortLink, shortLink } from '@/components/marketing/ShortLink'
import { Soon } from '@/components/marketing/Soon'
import { AppListScreen, AppPhone, ChatScreen, type AppListRow } from '@/components/marketing/screens/AppScreens'
import { UPCOMING, type NotLiveYet } from '@/lib/marketing/plan-claims'
import { VAN_PHOTO } from '@/lib/marketing/photos'
import { RequestFormScreen } from './RequestFormScreen'

/**
 * "Add it anywhere", shown instead of told (T-165; redrawn in T-170; five
 * ways since T-187). Each way has its title above a picture of one size
 * (5:8), all in one style:
 *
 *   1 the QR code on the side of a van. The van is a scene photograph
 *     (Docs/design/photos.md); the code is our real one for the example
 *     business's quote page, placed on the van's flat panel in code, with
 *     the business's name beside it. The image model drew no code and no
 *     lettering.
 *   2 that quote page on a phone: a phone-shaped frame wide enough for the
 *     business's name on one line, with the link, short, in its address bar.
 *   3 the same form sitting on the business's own web page.
 *   4 a price asked for in the business's own WhatsApp chat      (not live)
 *   5 the on-site app                                             (not live)
 *
 * The last two are not live. Their titles and their "Coming soon" mark come
 * from lib/marketing/plan-claims.ts; the mark goes when the flag is set.
 *
 * Layout (globals.css, "Add it anywhere"): from 1024 px three in a row, then
 * the other two in a second row of the same columns, so every picture is one
 * size and each row's pictures start on one line. From 640 px each is a row
 * of words and picture; on a phone they stack. Never five across.
 *
 * There is no caption under a picture.
 */
export function AddItAnywhere({
  shown,
  screenLabels,
  quoteLink,
  form,
  chat,
  appRows,
}: {
  shown: { qr: { title: string; text: string }; page: { title: string; text: string }; site: { title: string; text: string } }
  screenLabels: { van: string; sign: string; page: string; site: string }
  quoteLink: string
  form: { businessName: string; logoUrl: string; primaryColor: string; serviceName: string; question: string; answer: string }
  /** The WhatsApp picture: who asks, and for which of the example business's services */
  chat: { serviceName: string; customerName: string; link: string }
  /** The app picture: the rows of its quotes list */
  appRows: AppListRow[]
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

      {/* 4. A price asked for in the business's own WhatsApp chat (not live: plan-claims) */}
      <div className="add-it-item add-it-next" data-testid="add-it-item" data-upcoming="whatsapp">
        <Title title={UPCOMING.whatsapp.name} text={UPCOMING.whatsapp.lines[0]} soon="whatsapp" />
        <div className="add-it-picture" role="img" aria-label={UPCOMING.whatsapp.screen} {...({ inert: '' } as object)} data-testid="add-it-chat">
          <AppPhone className="h-full">
            <ChatScreen businessName={form.businessName} serviceName={chat.serviceName} customerName={chat.customerName} message={UPCOMING.whatsapp.customerMessage} link={chat.link} />
          </AppPhone>
        </div>
      </div>

      {/* 5. The on-site app (not live: plan-claims) */}
      <div className="add-it-item add-it-next" data-testid="add-it-item" data-upcoming="app">
        <Title title={UPCOMING.app.name} text={UPCOMING.app.lines[1]} soon="app" />
        <div className="add-it-picture" role="img" aria-label={UPCOMING.app.screens.list} {...({ inert: '' } as object)} data-testid="add-it-app">
          <AppPhone className="h-full">
            <AppListScreen rows={appRows} />
          </AppPhone>
        </div>
      </div>
    </div>
  )
}

function Title({ title, text, soon }: { title: string; text: string; soon?: NotLiveYet }) {
  return (
    <div>
      <h3 className="flex flex-wrap items-center gap-x-2 gap-y-1 font-display text-lg font-bold text-text-primary">
        {title}
        {soon ? <Soon of={soon} className="font-sans" /> : null}
      </h3>
      <p className="mt-1 text-sm text-text-secondary">{text}</p>
    </div>
  )
}
