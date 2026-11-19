import { Soon } from '@/components/marketing/Soon'
import { Picture } from '@/components/marketing/screens/ProductScreens'
import { AppListScreen, AppPhone, AppQuoteScreen, RoomScanCard, type AppListRow } from '@/components/marketing/screens/AppScreens'
import { storeLinks } from '@/lib/marketing/app-stores'
import { UPCOMING, appAvailability } from '@/lib/marketing/plan-claims'

/**
 * T-187: the on-site app, on Home: "Price a job while you are standing in
 * it". Words on the left (what it does in three short lines, when it comes,
 * the room scan card); two of the app's screens on the right, in phones: the
 * quotes list and one quote.
 *
 * The app is not live. Every word about it, and "Coming soon to iPhone", come
 * from lib/marketing/plan-claims.ts beside its one flag; nothing here says a
 * business can have it today, and nothing says Android.
 *
 * Store badges: a slot per store, behind config (lib/marketing/app-stores.ts:
 * APP_STORE_URL, PLAY_STORE_URL). A slot shows only when its address is set,
 * so today none shows. It is a plain link: a store's badge artwork is the
 * store's own and is added with the address.
 */
export function AppSection({
  listRows,
  quote,
}: {
  listRows: AppListRow[]
  quote: { customer: string; service: string; total: number; receivedOn: string; lines: Array<{ name: string; amount: number; rate?: number; quantity?: number; unit?: string }> }
}) {
  const app = UPCOMING.app
  const scan = UPCOMING.roomScan
  const stores = storeLinks()
  return (
    <div className="grid items-start gap-12 lg:grid-cols-[minmax(0,22rem)_1fr] lg:gap-14" data-testid="app-section">
      <div>
        <h2 className="font-display text-3xl font-extrabold tracking-tight text-text-primary sm:text-4xl">{app.heading}</h2>
        <ul className="mt-5 space-y-3 text-text-primary" data-testid="app-lines">
          {app.lines.map((line) => (
            <li key={line} className="flex gap-3">
              <span aria-hidden="true" className="mt-2.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
              {line}
            </li>
          ))}
        </ul>
        <p className="mt-6 font-display text-lg font-bold text-text-primary" data-testid="app-availability">
          {appAvailability()}
        </p>
        {stores.length > 0 ? (
          <p className="mt-3 flex flex-wrap gap-3" data-testid="store-badges">
            {stores.map((store) => (
              <a
                key={store.store}
                href={store.url}
                className="motion-press inline-flex min-h-[48px] items-center rounded-lg border border-ink bg-ink px-5 text-sm font-semibold text-white"
                data-testid="store-badge"
                data-store={store.store}
              >
                {store.label}
              </a>
            ))}
          </p>
        ) : null}

        <div className="mt-8" data-testid="app-room-scan">
          <p className="mb-3 flex flex-wrap items-center gap-2 text-sm font-semibold text-text-primary">
            {scan.name}
            <Soon of="roomScan" />
          </p>
          <Picture label={scan.screen}>
            <RoomScanCard />
          </Picture>
          <p className="mt-3 text-sm text-text-secondary">{scan.lines[2]}</p>
        </div>
      </div>

      <div className="grid gap-8 sm:grid-cols-2 sm:gap-6" data-testid="app-screens">
        <Picture label={app.screens.list} testId="app-screen">
          <AppPhone>
            <AppListScreen rows={listRows} />
          </AppPhone>
        </Picture>
        <Picture label={app.screens.quote} testId="app-screen">
          <AppPhone>
            <AppQuoteScreen customer={quote.customer} service={quote.service} lines={quote.lines} total={quote.total} receivedOn={quote.receivedOn} />
          </AppPhone>
        </Picture>
      </div>
    </div>
  )
}
