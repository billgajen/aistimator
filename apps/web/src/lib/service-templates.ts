/**
 * T-189: "Add from a template" on the services page (pure).
 *
 * Setup offers the trade templates once (the vertical packs). After setup a
 * business had no way back to them: an HVAC company that later takes on water
 * heaters had to build that service by hand. This lists the same packs setup
 * shows (the business's own region), each service with a starting price read
 * from the template's own price list, and says which ones the business
 * already has.
 *
 * Nothing here is typed: names, prices and units are the pack's data. A
 * template's rates are editable defaults, so adding one opens the new service
 * for the business to check.
 *
 * "Already has" is by name, ignoring case and spacing. A business that has
 * renamed a template's service can add the template again; that is a second
 * service of theirs, not a fault.
 */
import type { RegionCode } from '@qolumns/shared'
import { toPriceList, unitWords } from '@/lib/price-list'
import { servicePayload, type DraftService } from '@/lib/onboarding-service'
import { listPacks, type VerticalPackService } from '@/lib/vertical-packs'

export interface TemplateChoice {
  /** `<pack id>:<index>`: stable while the pack is */
  key: string
  name: string
  description: string
  /** "$375 per room", "From $150", or '' when the template sets no price */
  price: string
  /** The business already has a service of this name */
  owned: boolean
}

export interface TemplateGroup {
  packId: string
  packName: string
  services: TemplateChoice[]
}

const sameName = (name: string): string => name.trim().replace(/\s+/g, ' ').toLowerCase()

const draftOf = (svc: VerticalPackService): Omit<DraftService, 'selected'> => ({
  name: svc.name,
  description: svc.description,
  draft: svc.draft,
  addons: svc.addons || [],
  multipliers: svc.multipliers || [],
})

/**
 * A template's starting price, in the template's own numbers: its first price
 * that every job pays (a line with no condition), else its base fee, else its
 * minimum charge, else the lowest of its prices that depend on an answer.
 * `money` formats an amount in the business's currency.
 */
export function startingPrice(svc: VerticalPackService, money: (n: number) => string): string {
  const list = toPriceList(draftOf(svc), money)
  const first = list.items.find((item) => item.amount > 0 && !item.note && (item.unit === 'each' || item.unit === 'per_unit' || item.unit === 'per_hour'))
  if (first) {
    const words = unitWords(first)
    return first.unit === 'each' ? `From ${money(first.amount)}` : `${money(first.amount)} ${words}`
  }
  if (list.baseFee > 0) return `From ${money(list.baseFee)}`
  if (list.minimumCharge > 0) return `From ${money(list.minimumCharge)}`
  // every price depends on an answer: the lowest of them is where the price starts
  const amounts = list.items.filter((item) => item.amount > 0 && item.unit !== 'percent' && item.unit !== 'credit').map((item) => item.amount)
  return amounts.length > 0 ? `From ${money(Math.min(...amounts))}` : ''
}

/** The templates setup offers this business, with what it already has marked */
export function templateGroups(region: RegionCode, ownedNames: readonly string[], money: (n: number) => string): TemplateGroup[] {
  const owned = new Set(ownedNames.map(sameName))
  return listPacks(region)
    .filter((pack) => pack.region === region)
    .map((pack) => ({
      packId: pack.id,
      packName: pack.name,
      services: pack.services.map((svc, index) => ({
        key: `${pack.id}:${index}`,
        name: svc.name,
        description: svc.description,
        price: startingPrice(svc, money),
        owned: owned.has(sameName(svc.name)),
      })),
    }))
}

/**
 * The request that adds a template's service: the same body setup sends
 * (`servicePayload`), so a service added here is the one setup would have
 * made, except that it starts switched off (T-201). Null for a key that names
 * no template, or one the business has.
 */
export function templatePayload(region: RegionCode, key: string, ownedNames: readonly string[]): (ReturnType<typeof servicePayload> & { active: false }) | null {
  const [packId, at] = [key.slice(0, key.lastIndexOf(':')), Number(key.slice(key.lastIndexOf(':') + 1))]
  const pack = listPacks(region).find((p) => p.id === packId && p.region === region)
  const svc = pack?.services[at]
  if (!svc || ownedNames.map(sameName).includes(sameName(svc.name))) return null
  // T-201: added switched off. Its prices are the template's examples, so no customer is quoted from
  // them until the business has checked them and pressed "Enable".
  return { ...servicePayload(draftOf(svc)), active: false }
}
