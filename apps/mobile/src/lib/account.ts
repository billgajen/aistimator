/**
 * The Account tab's words (T-184). Pure.
 *
 * The plan's name and how many quotes are used, and nothing about money: no
 * price, no "upgrade", no link to billing. An app may not point at a
 * purchase outside it.
 */
import { DATA_DELETION_PATH, type AppAccountResponse } from '@qolumns/shared'

/** "Pro" or "Free quotes" */
export function planLine(account: Pick<AppAccountResponse, 'planName'>): string {
  return account.planName ?? 'Free quotes'
}

/** "37 of 200 quotes used this month" · "8 of 10 free quotes used" · "37 quotes this month" */
export function usageLine(account: Pick<AppAccountResponse, 'usage' | 'planName'>): string {
  const { used, limit, unlimited, per } = account.usage
  const quotes = (n: number) => (n === 1 ? 'quote' : 'quotes')
  if (unlimited || limit <= 0) return per === 'month' ? `${used} ${quotes(used)} this month` : `${used} ${quotes(used)} so far`
  if (per === 'total') return `${used} of ${limit} ${account.planName ? '' : 'free '}quotes used`
  return `${used} of ${limit} quotes used this month`
}

/** How full the allowance is, 0 to 1; null when there is no limit */
export function usageFraction(account: Pick<AppAccountResponse, 'usage'>): number | null {
  const { used, limit, unlimited } = account.usage
  if (unlimited || limit <= 0) return null
  return Math.max(0, Math.min(1, used / limit))
}

/** The link without its scheme ("the-site/quote/your-business"), as it is read out or typed */
/**
 * T-191: where "Delete your account" goes. The app only signs in (accounts are made on the web), so Apple's rule
 * 5.1.1(v) is met by a clear link to the web page that closes an account.
 */
export function deleteAccountUrl(webUrl: string): string {
  return `${webUrl.replace(/\/+$/, '')}${DATA_DELETION_PATH}`
}

export function shortLink(url: string): string {
  return url.replace(/^https?:\/\//, '').replace(/\/+$/, '')
}
