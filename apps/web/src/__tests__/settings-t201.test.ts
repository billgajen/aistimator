/**
 * T-201, Settings and the pages beside it (items 14, 21, 26 and 30):
 *   14. "Change password" in Settings: current password, new password, the new one again
 *   21. the WhatsApp page says "Coming soon" to a business that cannot connect yet
 *   26. a switch for sharing rates in the benchmarks, on for a new business, with one sentence on what is shared
 *   30. the Branding page names the plan that removes the badge from the plans on offer
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { BENCHMARK_SHARING_COPY, PRODUCT_NAME, getPlan, noBadgeLine, offeredPlans, planIncludesCapability } from '@qolumns/shared'
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, passwordProblem } from '@/lib/auth-flow'
import { CHANGE_PASSWORD_COPY, NEW_PASSWORD_MIN_LENGTH, changePasswordProblem } from '@/lib/change-password'
import { COMING_SOON, isLive } from '@/lib/marketing/plan-claims'
import { WHATSAPP_SOON_COPY, whatsappConnectOpenFor } from '@/lib/whatsapp-open'

const ROOT = path.resolve(__dirname, '../../../..')
const read = (file: string) => readFileSync(path.join(ROOT, file), 'utf8')

describe('T-201 item 14: change password', () => {
  const C = CHANGE_PASSWORD_COPY
  const problem = (input: Parameters<typeof changePasswordProblem>[0]) => changePasswordProblem(input, passwordProblem)
  const good = { currentPassword: 'old-password-1', newPassword: 'new-password-22', confirmPassword: 'new-password-22' }

  it('all three filled in properly: nothing wrong', () => {
    expect(problem(good)).toBeNull()
  })

  it('the current password must be given', () => {
    expect(problem({ ...good, currentPassword: '' })).toBe(C.needCurrent)
    expect(problem({ ...good, currentPassword: undefined })).toBe(C.needCurrent)
    expect(problem(null)).toBe(C.needCurrent)
  })

  it('the new password follows sign-up’s rules', () => {
    expect(problem({ ...good, newPassword: 'short', confirmPassword: 'short' })).toBe(`Choose a password of at least ${PASSWORD_MIN_LENGTH} characters.`)
    const long = 'x'.repeat(PASSWORD_MAX_LENGTH + 1)
    expect(problem({ ...good, newPassword: long, confirmPassword: long })).toBe(`Choose a password of at most ${PASSWORD_MAX_LENGTH} characters.`)
    expect(NEW_PASSWORD_MIN_LENGTH).toBe(PASSWORD_MIN_LENGTH)
  })

  it('the two new passwords must match, and differ from the current one', () => {
    expect(problem({ ...good, confirmPassword: 'new-password-23' })).toBe(C.mismatch)
    expect(problem({ ...good, newPassword: good.currentPassword, confirmPassword: good.currentPassword })).toBe(C.same)
  })

  it('the route: signed in only, limited like log-in before the check, the current password checked on the server, then changed', () => {
    const route = read('apps/web/src/app/api/auth/change-password/route.ts')
    const at = (text: string) => {
      const index = route.indexOf(text)
      expect(index, text).toBeGreaterThan(0)
      return index
    }
    const signedIn = at('supabase.auth.getUser()')
    const limited = at("checkRateLimit('login'")
    const validated = at('changePasswordProblem(body, passwordProblem)')
    const checked = at('checker.auth.signInWithPassword({ email: user.email, password: currentPassword })')
    const changed = at('supabase.auth.updateUser({ password: newPassword })')
    expect([signedIn, limited, validated, checked, changed]).toEqual([...[signedIn, limited, validated, checked, changed]].sort((a, b) => a - b))
    // the check uses a client that keeps no session, so the caller's cookies are untouched
    expect(route).toContain('persistSession: false')
    // a wrong current password is refused before anything changes
    expect(route.slice(checked, changed)).toContain("authError(400, 'WRONG_PASSWORD', C.wrongCurrent)")
    // no password is logged, and the email is not changed
    expect(route).not.toMatch(/console\.\w+\([^)]*[Pp]assword\b(?! (?:check|change) failed)[^)]*\$\{(?:currentPassword|newPassword)/)
    expect(route).not.toMatch(/updateUser\(\{[^}]*email/)
  })

  it('Settings shows the card, with the three fields named as the ticket asks', () => {
    expect(read('apps/web/src/app/(dashboard)/app/settings/page.tsx')).toContain('<ChangePassword />')
    const card = read('apps/web/src/components/settings/ChangePassword.tsx')
    expect(card).toContain("postAuth('/api/auth/change-password', { currentPassword: current, newPassword: next, confirmPassword: confirm })")
    expect(card.match(/type="password"/g)).toHaveLength(3)
    expect(card).toContain('autoComplete="current-password"')
    expect(C.title).toBe('Change password')
    expect([C.current, C.next, C.confirm]).toEqual(['Current password', 'New password', 'New password again'])
  })
})

describe('T-201 item 21: the WhatsApp page, before connecting is open', () => {
  const closed = { live: false, openFor: undefined, standIn: false }

  it('today WhatsApp quoting is not live, so a business that is not named cannot connect', () => {
    expect(isLive('whatsapp')).toBe(false)
    expect(whatsappConnectOpenFor('tnt_a', closed)).toBe(false)
  })

  it('the day the one flag is set, every business can', () => {
    expect(whatsappConnectOpenFor('tnt_a', { ...closed, live: true })).toBe(true)
  })

  it('before that day, a business named in WHATSAPP_CONNECT_OPEN can, and no other', () => {
    const named = { ...closed, openFor: ' tnt_a, tnt_b ' }
    expect(whatsappConnectOpenFor('tnt_a', named)).toBe(true)
    expect(whatsappConnectOpenFor('tnt_b', named)).toBe(true)
    expect(whatsappConnectOpenFor('tnt_c', named)).toBe(false)
    expect(whatsappConnectOpenFor('tnt_c', { ...closed, openFor: 'all' })).toBe(true)
    expect(whatsappConnectOpenFor('tnt_c', { ...closed, openFor: '' })).toBe(false)
  })

  it('where Meta is stood in for (the checks), the connect flow is open', () => {
    expect(whatsappConnectOpenFor('tnt_a', { ...closed, standIn: true })).toBe(true)
  })

  it('the words: the site’s own "Coming soon", and the way to the quote link', () => {
    expect(WHATSAPP_SOON_COPY.mark).toBe(COMING_SOON)
    expect(WHATSAPP_SOON_COPY.text).toContain('not open yet')
    expect(WHATSAPP_SOON_COPY.link).toBe('Open Quote link')
  })

  it('the page shows it only to a business that is not connected, before anything that could connect', () => {
    const page = read('apps/web/src/app/(dashboard)/app/whatsapp/page.tsx')
    const soon = page.indexOf('if (!config && data.connect.open === false) {')
    expect(soon).toBeGreaterThan(0)
    // asked before the plan line and before the connect button
    expect(soon).toBeLessThan(page.indexOf("if (!access.allowed && access.why === 'plan')"))
    expect(soon).toBeLessThan(page.indexOf('<ConnectWhatsApp settings={data.connect}'))
    const block = page.slice(soon, page.indexOf("if (!access.allowed && access.why === 'plan')"))
    expect(block).toContain('data-testid="whatsapp-coming-soon"')
    expect(block).toContain('href="/app/quote-link"')
    expect(block).not.toContain('<ConnectWhatsApp')
    expect(block).not.toContain('<ManualConnect')
    // the mark is never typed on the page
    expect(block).toContain('{S?.mark}')
    expect(block).not.toMatch(/>\s*Coming soon\s*</)
    expect(read('apps/web/src/app/api/whatsapp/config/route.ts')).toContain('open: whatsappConnectOpen(auth.tenantId)')
  })
})

describe('T-201 item 26: sharing rates in the benchmarks is a switch in Settings', () => {
  it('one plain sentence says what is shared', () => {
    const sentence = BENCHMARK_SHARING_COPY.whatIsShared
    expect(sentence.match(/[.!?](\s|$)/g)).toHaveLength(1)
    expect(sentence).toContain('without your name')
    expect(sentence).toContain('rates')
  })

  it('Settings shows the switch, and it saves through the tenant route', () => {
    expect(read('apps/web/src/app/(dashboard)/app/settings/page.tsx')).toContain('<BenchmarkSharing initial=')
    const card = read('apps/web/src/components/settings/BenchmarkSharing.tsx')
    expect(card).toContain('role="switch"')
    expect(card).toContain('JSON.stringify({ benchmarksOptIn: next })')
    const route = read('apps/web/src/app/api/tenant/route.ts')
    expect(route.match(/benchmarksOptIn: tenant\.benchmarks_opt_in === true/g)).toHaveLength(2)
    expect(route).toContain('updates.benchmarks_opt_in = Boolean(benchmarksOptIn)')
  })

  it('on for a new business: the column’s default, with no existing row changed', () => {
    const migration = read('supabase/migrations/00000000000050_t201.sql')
    expect(migration).toMatch(/ALTER TABLE tenants\s+ALTER COLUMN benchmarks_opt_in SET DEFAULT true;/)
    expect(migration).not.toMatch(/UPDATE tenants[^;]*benchmarks_opt_in/i)
  })

  it('the calculations respect it: a business that is off sees none and is in nobody’s', () => {
    const route = read('apps/web/src/app/api/learning/benchmarks/route.ts')
    expect(route).toContain('if (!tenant?.benchmarks_opt_in) {')
    expect(route).toContain(".eq('benchmarks_opt_in', true)")
  })

  it('Analytics says where the switch is', () => {
    const page = read('apps/web/src/app/(dashboard)/app/analytics/page.tsx')
    expect(page).toContain('{BENCHMARK_SHARING_COPY.offLine}')
    expect(page).toContain('data-testid="benchmark-sharing-line"')
    expect(page).toContain('href="/app/settings"')
  })
})

describe('T-201 item 30: the Branding page names the plan that removes the badge', () => {
  it('today that is Pro alone, read from the plans on offer', () => {
    const withIt = offeredPlans().filter((plan) => planIncludesCapability(plan, 'no_badge'))
    expect(withIt.map((p) => p.name)).toEqual([getPlan('plan_us_pro')?.name])
    expect(noBadgeLine()).toBe(`Only ${withIt[0]!.name} removes the “Prepared with ${PRODUCT_NAME}” badge. Your estimates then carry only your brand.`)
  })

  it('the line follows the plans: two plans read "remove", none says every estimate carries it', () => {
    const [starter, pro] = [getPlan('plan_us_starter')!, getPlan('plan_us_pro')!]
    expect(noBadgeLine([starter])).toBe(`Every estimate carries the “Prepared with ${PRODUCT_NAME}” badge.`)
    const both = [pro, { ...pro, id: 'plan_other', name: 'Other' }]
    expect(noBadgeLine(both)).toContain(`Only ${pro.name} and Other remove the`)
  })

  it('the page types no plan name: the old ones are gone', () => {
    const page = read('apps/web/src/app/(dashboard)/app/settings/branding/page.tsx')
    // T-204: the line is this business's own (the route sends it); the general one stands in while loading
    expect(page).toContain('{preview?.badgeLine ?? noBadgeLine()}')
    expect(page).not.toMatch(/Growth|Starter|\bPro\b plans?/)
  })
})
